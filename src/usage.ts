/**
 * DeepSeek 用量与余额引擎。
 *
 * - 用量：扫描 $DSH_HOME/sessions 下的会话日志（zstd 帧解压），从
 *   `assistant/message` 事件的 `usage` 字段聚合 token（input/output/cacheRead/
 *   cacheWrite），`request/header` 事件追踪当前模型；按 DeepSeek 官方价目表
 *   （含 2026-08-17 起峰谷定价）折算金额。
 * - 余额：通过 credentials 服务解析 DeepSeek API Key，查询官方
 *   `/user/balance` 接口（带缓存）。
 *
 * 思路改编自 MIT 协议的 dsh-usage-dashboard-plus / dsh-usage-dashboard
 * （https://github.com/1HelloMan1/dsh-usage-dashboard-plus）。
 */
import { zstdDecompressSync } from 'node:zlib'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { credentialRef } from '@deepseek-ai/dsh-credentials'

// ---------- 价目表（CNY / 每 1M tokens） ----------

export interface PriceEntry {
  input: number
  cacheRead: number
  output: number
}

export interface PriceScheduleEntry {
  /** 生效起始日（本地日期 YYYY-MM-DD）。 */
  from: string
  peak: Record<string, PriceEntry>
  idle: Record<string, PriceEntry>
}

export const DEFAULT_PRICES: Record<string, PriceEntry> = {
  'deepseek-v4-flash': { input: 1, cacheRead: 0.02, output: 2 },
  'deepseek-v4-pro': { input: 3, cacheRead: 0.025, output: 6 },
}

/** 2026-08-17 起 DeepSeek 峰谷价（北京高峰 09:00-12:00 / 14:00-18:00）。 */
export const DEFAULT_PRICE_SCHEDULE: PriceScheduleEntry[] = [
  {
    from: '2026-08-17',
    peak: {
      'deepseek-v4-flash': { input: 3, cacheRead: 0.1, output: 9 },
      'deepseek-v4-pro': { input: 9, cacheRead: 0.3, output: 27 },
    },
    idle: {
      'deepseek-v4-flash': { input: 1.5, cacheRead: 0.05, output: 4.5 },
      'deepseek-v4-pro': { input: 4.5, cacheRead: 0.15, output: 13.5 },
    },
  },
]

export const FALLBACK_PRICE: PriceEntry = { input: 1, cacheRead: 0.02, output: 2 }

// ---------- 类型 ----------

export interface TokenCounts {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

export interface ModelUsage {
  model: string
  cost: number
  calls: number
  tokens: TokenCounts
}

export interface DayUsage {
  date: string
  cost: number
  calls: number
  tokens: TokenCounts
  byModel: ModelUsage[]
}

export interface UsageStats {
  today: DayUsage
  /** 近 7 天（含今天）每日费用与调用数。 */
  week: { date: string; cost: number; calls: number }[]
  /** 全部历史累计。 */
  cumulative: DayUsage
  scannedLogs: number
  pricingLabel: string
  generatedAt: number
  /** zstd 不可用时的说明（如自定义 Node 构建未编译 zstd）。 */
  decompressNote?: string
}

export interface BalanceInfo {
  available: boolean
  currency: string
  totalBalance: number
  grantedBalance: number
  toppedUpBalance: number
  fetchedAt: number
  error?: string
}

export interface UsageConfig {
  apiKeyRef: string
  balanceCacheMs: number
  usageCacheMs: number
  sessionsRoot: string
  prices: Record<string, PriceEntry>
  priceSchedule: PriceScheduleEntry[]
}

// ---------- 会话日志读取 ----------

const ZSTD_MAGIC = 0x28b52ffd

/** 当前 Node 是否支持 zstd（官方构建 v22.18+ 均支持）。 */
const ZSTD_OK = typeof zstdDecompressSync === 'function'

/** 按 zstd 魔数把数据切帧，逐帧解压（容忍末尾未写完的帧）。 */
function decodeSessionLog(data: Buffer): string {
  if (!ZSTD_OK) return ''
  const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  const starts: number[] = []
  for (let i = 0; i + 3 < bytes.length; i++) {
    if (bytes[i] === 0x28 && bytes[i + 1] === 0xb5 && bytes[i + 2] === 0x2f && bytes[i + 3] === 0xfd) {
      starts.push(i)
    }
  }
  let text = ''
  for (let i = 0; i < starts.length; i++) {
    const end = i + 1 < starts.length ? starts[i + 1] : data.length
    try {
      text += zstdDecompressSync(data.subarray(starts[i], end)).toString('utf8')
    } catch {
      // 末尾未写完的帧 —— 跳过
    }
  }
  return text
}

function collectLogs(root: string): { path: string; mtimeMs: number }[] {
  const out: { path: string; mtimeMs: number }[] = []
  const walk = (dir: string): void => {
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const entry of entries) {
      const full = join(dir, entry)
      let st
      try {
        st = statSync(full)
      } catch {
        continue
      }
      if (st.isDirectory()) {
        walk(full)
      } else if ((entry === 'session.jsonl.zstd' || entry === 'session.jsonl') && st.size > 0) {
        out.push({ path: full, mtimeMs: st.mtimeMs })
      }
    }
  }
  walk(root)
  return out
}

// ---------- 聚合 ----------

function localDayKey(ms: number): string {
  const d = new Date(ms)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

/** 北京时间小时（0-23），用于峰谷判定。 */
function shanghaiHour(ms: number): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Shanghai',
      hour: 'numeric',
      hour12: false,
    }).formatToParts(new Date(ms))
    const raw = parts.find(p => p.type === 'hour')?.value ?? '0'
    return Number(raw) % 24
  } catch {
    return new Date(ms).getHours()
  }
}

function isPeakHour(ms: number): boolean {
  const h = shanghaiHour(ms)
  return (h >= 9 && h < 12) || (h >= 14 && h < 18)
}

function priceFor(model: string, timeMs: number, prices: Record<string, PriceEntry>, schedule: PriceScheduleEntry[]): { price: PriceEntry; label: string } {
  const key = localDayKey(timeMs)
  let entry: PriceScheduleEntry | null = null
  for (const candidate of schedule) {
    if (candidate.from <= key) entry = candidate
  }
  if (entry) {
    const peak = isPeakHour(timeMs)
    const table = peak ? entry.peak : entry.idle
    return { price: table[model] ?? FALLBACK_PRICE, label: `${entry.from} 起 · ${peak ? '高峰' : '空闲'}` }
  }
  return { price: prices[model] ?? FALLBACK_PRICE, label: '现行价格' }
}

interface Rec {
  cost: number
  calls: number
  tokens: TokenCounts
  byModel: Map<string, { cost: number; calls: number; tokens: TokenCounts }>
}

function emptyRec(): Rec {
  return {
    cost: 0,
    calls: 0,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    byModel: new Map(),
  }
}

function accumulate(rec: Rec, model: string, u: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number }, time: number, prices: Record<string, PriceEntry>, schedule: PriceScheduleEntry[]): void {
  const input = u.inputTokens ?? 0
  const output = u.outputTokens ?? 0
  const cacheRead = u.cacheReadTokens ?? 0
  const cacheWrite = u.cacheWriteTokens ?? 0
  rec.calls += 1
  rec.tokens.input += input
  rec.tokens.output += output
  rec.tokens.cacheRead += cacheRead
  rec.tokens.cacheWrite += cacheWrite
  const { price } = priceFor(model, time, prices, schedule)
  // cacheWrite 按普通（未命中）输入计价
  const cost = ((input + cacheWrite) / 1e6) * price.input
    + (cacheRead / 1e6) * price.cacheRead
    + (output / 1e6) * price.output
  rec.cost += cost
  let m = rec.byModel.get(model)
  if (!m) {
    m = { cost: 0, calls: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }
    rec.byModel.set(model, m)
  }
  m.cost += cost
  m.calls += 1
  m.tokens.input += input
  m.tokens.output += output
  m.tokens.cacheRead += cacheRead
  m.tokens.cacheWrite += cacheWrite
}

function serializeRec(date: string, rec: Rec): DayUsage {
  return {
    date,
    cost: Math.round(rec.cost * 10000) / 10000,
    calls: rec.calls,
    tokens: { ...rec.tokens },
    byModel: [...rec.byModel.entries()]
      .sort((a, b) => b[1].cost - a[1].cost)
      .map(([model, m]) => ({
        model,
        cost: Math.round(m.cost * 10000) / 10000,
        calls: m.calls,
        tokens: { ...m.tokens },
      })),
  }
}

export function computeUsage(config: Pick<UsageConfig, 'sessionsRoot' | 'prices' | 'priceSchedule'>): UsageStats {
  const now = Date.now()
  const todayKey = localDayKey(now)
  const days = new Map<string, Rec>()
  const cumulative = emptyRec()
  const logs = collectLogs(config.sessionsRoot || join(resolveDshHome(), 'sessions'))
  let events = 0

  for (const { path } of logs) {
    let data: Buffer
    try {
      data = readFileSync(path)
    } catch {
      continue
    }
    let text: string
    try {
      text = decodeSessionLog(data)
    } catch {
      continue
    }
    let currentModel = '(unknown)'
    for (const line of text.split('\n')) {
      if (line === '') continue
      let ev: { type?: string; time?: number; data?: { header?: { config?: { model?: string } }; usage?: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number } } }
      try {
        ev = JSON.parse(line)
      } catch {
        continue
      }
      if (ev.type === 'request/header' && ev.data?.header?.config?.model) {
        currentModel = ev.data.header.config.model
        continue
      }
      if (ev.type !== 'assistant/message' || ev.data?.usage == null) continue
      const time = typeof ev.time === 'number' ? ev.time : now
      const key = localDayKey(time)
      let day = days.get(key)
      if (!day) {
        day = emptyRec()
        days.set(key, day)
      }
      accumulate(day, currentModel, ev.data.usage, time, config.prices, config.priceSchedule)
      accumulate(cumulative, currentModel, ev.data.usage, time, config.prices, config.priceSchedule)
      events += 1
    }
  }

  const today = serializeRec(todayKey, days.get(todayKey) ?? emptyRec())
  const weekKeys = [...days.keys()].sort().slice(-7)
  const week = weekKeys.map(key => {
    const rec = days.get(key) ?? emptyRec()
    return { date: key, cost: Math.round(rec.cost * 10000) / 10000, calls: rec.calls }
  })

  return {
    today,
    week,
    cumulative: serializeRec('all', cumulative),
    scannedLogs: logs.length,
    pricingLabel: 'DeepSeek 官方价目表（2026-08-17 起峰谷定价）',
    generatedAt: now,
    ...(ZSTD_OK ? {} : { decompressNote: '当前 Node 未编译 zstd，无法解析会话日志（需官方 Node ≥ 22.18，Windows/macOS 均支持）' }),
  }
}

// ---------- 余额查询 ----------

export async function fetchBalance(ctx: Context, config: Pick<UsageConfig, 'apiKeyRef' | 'balanceCacheMs'>, cache: { at: number; value: BalanceInfo | null }): Promise<BalanceInfo> {
  const now = Date.now()
  if (cache.value !== null && now - cache.at < config.balanceCacheMs) return cache.value

  const credentials = ctx.get('credentials') as { resolve: (ref: string) => Promise<{ value?: string } | undefined> } | undefined
  let key: string | undefined
  if (credentials) {
    try {
      const hit = await credentials.resolve(credentialRef(config.apiKeyRef))
      if (hit && typeof hit.value === 'string' && hit.value.trim() !== '') key = hit.value.trim()
    } catch { /* 忽略，尝试环境变量 */ }
  }
  if (!key) {
    const ambient = process.env[config.apiKeyRef]
    if (ambient && ambient.trim() !== '') key = ambient.trim()
  }
  if (!key) {
    // 兜底：直接读凭证文件（~/.dsh/.credentials.yaml 的 `KEY: value` 行）
    try {
      const file = join(resolveDshHome(), '.credentials.yaml')
      const text = readFileSync(file, 'utf8')
      const line = text.split('\n').find(l => l.trim().startsWith(`${config.apiKeyRef}:`))
      if (line) {
        const value = line.slice(line.indexOf(':') + 1).trim().replace(/^["']|["']$/g, '')
        if (value.startsWith('sk-')) key = value
      }
    } catch { /* 忽略 */ }
  }
  if (!key) {
    const value: BalanceInfo = { available: false, currency: 'CNY', totalBalance: 0, grantedBalance: 0, toppedUpBalance: 0, fetchedAt: now, error: `未配置 API Key（${config.apiKeyRef}）` }
    cache.at = now
    cache.value = value
    return value
  }

  const base = (process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com').replace(/\/+$/, '')
  try {
    const res = await fetch(`${base}/user/balance`, {
      headers: { authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) {
      let detail = ''
      try { detail = (await res.text()).slice(0, 200) } catch { /* ignore */ }
      const value: BalanceInfo = { available: false, currency: 'CNY', totalBalance: 0, grantedBalance: 0, toppedUpBalance: 0, fetchedAt: now, error: `balance API ${res.status}: ${detail}` }
      return value
    }
    const data = await res.json() as { is_available?: boolean; balance_infos?: { currency?: string; total_balance?: string; granted_balance?: string; topped_up_balance?: string }[] }
    const info = Array.isArray(data.balance_infos) ? data.balance_infos[0] : undefined
    const value: BalanceInfo = {
      available: data.is_available === true,
      currency: info?.currency ?? 'CNY',
      totalBalance: Number(info?.total_balance) || 0,
      grantedBalance: Number(info?.granted_balance) || 0,
      toppedUpBalance: Number(info?.topped_up_balance) || 0,
      fetchedAt: now,
    }
    return value
  } catch (error) {
    return {
      available: false,
      currency: 'CNY',
      totalBalance: 0,
      grantedBalance: 0,
      toppedUpBalance: 0,
      fetchedAt: now,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
