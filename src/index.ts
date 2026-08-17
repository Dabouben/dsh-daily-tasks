/**
 * dsh-daily-tasks 宿主端插件。
 *
 * 注册一个 HTTP 前缀路由 /dsh-daily-tasks，向浏览器端客户端插件提供：
 *   状态读取、任务增删改、延期处理、设置、周总结数据与 AI 生成。
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
// 类型增强：ctx.webServer / ctx.llm / ctx.agentDefaultModel
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { TaskStore } from './store.js'
import { DEFAULT_PRICES, DEFAULT_PRICE_SCHEDULE, computeUsage, fetchBalance } from './usage.js'
import type { BalanceInfo, PriceEntry, PriceScheduleEntry, UsageStats } from './usage.js'
import type { SummaryStats, TaskCategory, TaskScope } from './types.js'

export const name = 'dsh-daily-tasks'

export interface Config {
  dataPath: string
  // 用量/余额
  apiKeyRef: string
  balanceCacheMs: number
  usageCacheMs: number
  sessionsRoot: string
  prices: Record<string, PriceEntry>
  priceSchedule: PriceScheduleEntry[]
}

export const Config: z<Config> = z.object({
  dataPath: z.string().default('daily-tasks.json'),
  apiKeyRef: z.string().default('DEEPSEEK_API_KEY'),
  balanceCacheMs: z.natural().min(1000).default(60_000),
  usageCacheMs: z.natural().min(1000).default(30_000),
  sessionsRoot: z.string().default(''),
  prices: z.dict(z.object({
    input: z.number().min(0),
    cacheRead: z.number().min(0),
    output: z.number().min(0),
  })).default({}),
  priceSchedule: z.array(z.object({
    from: z.string(),
    peak: z.dict(z.object({ input: z.number().min(0), cacheRead: z.number().min(0), output: z.number().min(0) })),
    idle: z.dict(z.object({ input: z.number().min(0), cacheRead: z.number().min(0), output: z.number().min(0) })),
  })).default([]),
})

const ROUTE_PREFIX = '/dsh-daily-tasks'

interface JsonResponse {
  ok?: boolean
  error?: string
  [key: string]: unknown
}

function sendJson(res: import('node:http').ServerResponse, status: number, body: JsonResponse): void {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  res.end(text)
}

function readBody(req: import('node:http').IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > 2 * 1024 * 1024) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (!raw.trim()) { resolve({}); return }
      try { resolve(JSON.parse(raw)) } catch { reject(new Error('invalid json')) }
    })
    req.on('error', reject)
  })
}

function pickTaskScope(v: unknown): TaskScope {
  return v === 'weekly' ? 'weekly' : 'daily'
}

function pickCategory(v: unknown): TaskCategory {
  const s = String(v ?? '')
  return s === 'work' || s === 'study' || s === 'life' ? s : 'other'
}

export function apply(ctx: Context, config: Config): void {
  const home = resolveDshHome()
  const dataPath = path.isAbsolute(config.dataPath)
    ? config.dataPath
    : path.join(home, config.dataPath)
  const store = new TaskStore(dataPath)
  void store.load()

  // 用量/余额缓存与配置
  const prices = { ...DEFAULT_PRICES, ...(config.prices ?? {}) }
  const schedule = [...DEFAULT_PRICE_SCHEDULE, ...(config.priceSchedule ?? [])].sort((a, b) => a.from.localeCompare(b.from))
  const sessionsRoot = config.sessionsRoot !== '' && config.sessionsRoot !== undefined
    ? config.sessionsRoot
    : path.join(home, 'sessions')
  let usageCache: { at: number; value: UsageStats | null } = { at: 0, value: null }
  let balanceCache: { at: number; value: BalanceInfo | null } = { at: 0, value: null }

  ctx.inject(['webServer'], (webCtx) => {
    webCtx.webServer.register({
      kind: 'prefix',
      path: ROUTE_PREFIX,
      handler: async (req, res) => {
        try {
          const url = new URL(req.url ?? '/', 'http://localhost')
          const sub = url.pathname.slice(ROUTE_PREFIX.length) || '/'
          const method = (req.method ?? 'GET').toUpperCase()

          if (sub === '/usage/stats' && method === 'GET') {
            const now = Date.now()
            if (usageCache.value === null || now - usageCache.at > config.usageCacheMs) {
              usageCache = { at: now, value: computeUsage({ sessionsRoot, prices, priceSchedule: schedule }) }
            }
            sendJson(res, 200, { ok: true, usage: usageCache.value })
            return
          }

          if (sub === '/usage/balance' && method === 'GET') {
            const balance = await fetchBalance(webCtx, { apiKeyRef: config.apiKeyRef, balanceCacheMs: config.balanceCacheMs }, balanceCache)
            sendJson(res, 200, { ok: true, balance })
            return
          }

          if (sub === '/state' && method === 'GET') {
            sendJson(res, 200, { state: await store.snapshot() })
            return
          }

          if (sub === '/tasks' && method === 'POST') {
            const body = (await readBody(req)) as Record<string, unknown>
            const task = await store.addTask({
              scope: pickTaskScope(body.scope),
              title: String(body.title ?? ''),
              note: body.note === undefined ? '' : String(body.note),
              category: pickCategory(body.category),
            })
            sendJson(res, 200, { ok: true, task })
            return
          }

          if (sub === '/tasks' && method === 'PATCH') {
            const body = (await readBody(req)) as Record<string, unknown>
            const patch = (body.patch ?? {}) as Record<string, unknown>
            const task = await store.updateTask({
              id: String(body.id ?? ''),
              scope: pickTaskScope(body.scope),
              patch: {
                title: patch.title === undefined ? undefined : String(patch.title),
                note: patch.note === undefined ? undefined : String(patch.note),
                category: patch.category === undefined ? undefined : pickCategory(patch.category),
                done: patch.done === undefined ? undefined : Boolean(patch.done),
              },
            })
            sendJson(res, 200, { ok: true, task })
            return
          }

          if (sub === '/tasks' && method === 'DELETE') {
            const body = (await readBody(req)) as Record<string, unknown>
            await store.deleteTask({ id: String(body.id ?? ''), scope: pickTaskScope(body.scope) })
            sendJson(res, 200, { ok: true })
            return
          }

          if (sub === '/popup/close' && method === 'POST') {
            const body = (await readBody(req)) as Record<string, unknown>
            await store.closePopup({ carryIds: Array.isArray(body.carryIds) ? body.carryIds.map(String) : [] })
            sendJson(res, 200, { ok: true })
            return
          }

          if (sub === '/settings' && method === 'GET') {
            sendJson(res, 200, { settings: await store.getSettings() })
            return
          }

          if (sub === '/settings' && method === 'POST') {
            const body = (await readBody(req)) as Record<string, unknown>
            const settings = await store.saveSettings({
              weeklyResetDay: body.weeklyResetDay as number | undefined,
              scrollSpeed: body.scrollSpeed as number | undefined,
              popupEnabled: body.popupEnabled as boolean | undefined,
              marqueeEnabled: body.marqueeEnabled as boolean | undefined,
              postponeEnabled: body.postponeEnabled as boolean | undefined,
              soundEnabled: body.soundEnabled as boolean | undefined,
            })
            sendJson(res, 200, { ok: true, settings })
            return
          }

          if (sub === '/summary/data' && method === 'GET') {
            const weekKey = url.searchParams.get('weekKey')
            if (!weekKey) { sendJson(res, 400, { error: 'missing weekKey' }); return }
            sendJson(res, 200, { stats: await store.summaryStats(weekKey) })
            return
          }

          if (sub === '/summary/generate' && method === 'POST') {
            const body = (await readBody(req)) as Record<string, unknown>
            const weekKey = String(body.weekKey ?? '')
            if (!weekKey) { sendJson(res, 400, { error: 'missing weekKey' }); return }
            const cached = store.summaryCacheFor(weekKey)
            if (cached) { sendJson(res, 200, { ok: true, text: cached, cached: true }); return }
            const stats = await store.summaryStats(weekKey)
            const text = await generateSummary(webCtx, stats)
            await store.saveSummaryCache(weekKey, text)
            sendJson(res, 200, { ok: true, text, cached: false })
            return
          }

          if (sub === '/summary/ack' && method === 'POST') {
            await store.ackSummary()
            sendJson(res, 200, { ok: true })
            return
          }

          sendJson(res, 404, { error: 'not found' })
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e)
          webCtx.logger?.warn?.('[dsh-daily-tasks] %s', message)
          sendJson(res, 500, { error: message })
        }
      },
    })
  })
}

/**
 * 调用 DSH 的 LLM 服务生成周总结文字。
 * 使用默认模型（agent-default-model）；失败时返回友好提示，不抛出。
 */
async function generateSummary(ctx: Context, stats: SummaryStats): Promise<string> {
  // 用 ctx.get 可选读取服务（不声明 inject 也不会抛 “cannot get ... without inject”）
  const llm = ctx.get('llm') as { stream: (o: unknown) => AsyncIterable<unknown> } | undefined
  const agentDefault = ctx.get('agentDefaultModel') as { currentSelection(): { provider: string; model: string } } | undefined
  if (!llm || !agentDefault) {
    return '（当前环境未配置可用模型，无法生成 AI 总结。已为你统计上周任务数据：完成 '
      + `${stats.completed} 项，未完成 ${stats.undone} 项，完成率 ${stats.rate}%。）`
  }
  const sel = agentDefault.currentSelection()
  const prompt = storePrompt(stats)
  try {
    const stream = llm.stream({
      provider: sel.provider,
      model: sel.model,
      messages: [{
        id: randomUUID(),
        role: 'user',
        content: [{ type: 'text', text: prompt }],
        source: { kind: 'plugin', plugin: 'dsh-daily-tasks' },
      }],
      maxTokens: 800,
      temperature: 0.7,
    })
    let text = ''
    for await (const chunk of stream) {
      const c = chunk as { type?: string; text?: string }
      if (c.type === 'text-delta' && typeof c.text === 'string') text += c.text
    }
    const trimmed = text.trim()
    return trimmed || '（模型未返回内容。已为你统计上周任务数据：完成 '
      + `${stats.completed} 项，未完成 ${stats.undone} 项，完成率 ${stats.rate}%。）`
  } catch (e) {
    return '（AI 总结生成失败：' + (e instanceof Error ? e.message : String(e))
      + '。已为你统计上周任务数据：完成 ' + `${stats.completed} 项，未完成 ${stats.undone} 项，完成率 ${stats.rate}%。）`
  }
}

function storePrompt(stats: SummaryStats): string {
  const lines: string[] = []
  lines.push('你是一位简洁、温暖的中文个人效率总结助手。')
  lines.push('根据用户上周的任务完成情况，写一段 100~200 字的中文周总结，要求：')
  lines.push('- 先一句话概括上周整体完成情况（完成率）；')
  lines.push('- 再按分类概括完成了哪些事（工作/学习/生活）；')
  lines.push('- 最后温和地提一句未完成或顺延的部分，给出简短鼓励；')
  lines.push('- 输出纯文字段落，不要列表，不要标题，不要客套开头。')
  lines.push('')
  lines.push(buildDataText(stats))
  return lines.join('\n')
}

function buildDataText(stats: SummaryStats): string {
  const lines: string[] = []
  lines.push(`上周（${stats.weekKey}）任务数据：完成 ${stats.completed} 项，未完成 ${stats.undone} 项，顺延 ${stats.carried} 项，完成率 ${stats.rate}%。`)
  const done = stats.items.filter(h => h.done)
  if (done.length > 0) {
    lines.push('已完成任务：')
    for (const h of done) lines.push(`- ${h.title}（${categoryLabel(h.category)}）`)
  }
  const undone = stats.items.filter(h => !h.done && !h.carriedOver)
  if (undone.length > 0) {
    lines.push('未完成任务：')
    for (const h of undone) lines.push(`- ${h.title}`)
  }
  return lines.join('\n')
}

function categoryLabel(c: string): string {
  return { work: '工作', study: '学习', life: '生活', other: '其他' }[c] ?? c
}
