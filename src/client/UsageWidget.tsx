/**
 * 侧边栏 API 用量小部件。
 * 默认（折叠态）显示余额 + 今日/累计费用与模型明细；
 * 点击后弹出大卡片：余额卡片（总额/赠送/充值）、近 7 日迷你柱状图、按模型明细、刷新。
 * 仿照 DeepSeek 官方 API 使用页面布局。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { BalanceInfo, DayUsage, UsageStats } from '../types.js'
import { api } from './api.js'
import { Modal } from './modals.js'

function fmtMoney(n: number | undefined): string {
  const v = n ?? 0
  return v.toFixed(2)
}

function fmtTokens(n: number | undefined): string {
  const v = n ?? 0
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`
  return String(v)
}

function totalTokens(d: DayUsage): number {
  return d.tokens.input + d.tokens.output + d.tokens.cacheRead + d.tokens.cacheWrite
}

function shortModel(m: string): string {
  return m.split('/').pop() ?? m
}

function usageLine(d: DayUsage): string {
  return `¥${fmtMoney(d.cost)} · ${fmtTokens(totalTokens(d))} tokens · ${d.calls} 次`
}

/** 近 7 日费用迷你柱状图（纯 CSS）。 */
function MiniBars(props: { week: UsageStats['week'] }): ReactNode {
  const { week } = props
  const max = Math.max(0.0001, ...week.map(w => w.cost))
  return (
    <div className="dt-bars">
      {week.map(w => (
        <div key={w.date} className="dt-bar-col" title={`${w.date} ¥${fmtMoney(w.cost)}（${w.calls} 次）`}>
          <div className="dt-bar" style={{ height: `${Math.max(4, (w.cost / max) * 60)}px` }} />
          <div className="dt-bar-label">{w.date.slice(5)}</div>
        </div>
      ))}
    </div>
  )
}

function BalanceCard(props: { balance: BalanceInfo | null }): ReactNode {
  const { balance } = props
  if (!balance) return <div className="dt-hint">余额加载中…</div>
  if (balance.error) {
    return (
      <div className="dt-balance-card">
        <div className="dt-balance-title">DeepSeek 余额</div>
        <div className="dt-error">{balance.error}</div>
      </div>
    )
  }
  return (
    <div className="dt-balance-card">
      <div className="dt-balance-title">DeepSeek 账户余额 {balance.currency}</div>
      <div className="dt-balance-total">¥ {fmtMoney(balance.totalBalance)}</div>
      <div className={`dt-balance-status${balance.available ? ' dt-ok' : ' dt-bad'}`}>
        {balance.available ? '● 可用' : '● 不可用'}
      </div>
      <div className="dt-balance-row">
        <div><div className="dt-num-sm">¥ {fmtMoney(balance.grantedBalance)}</div><div className="dt-label">赠送余额</div></div>
        <div><div className="dt-num-sm">¥ {fmtMoney(balance.toppedUpBalance)}</div><div className="dt-label">充值余额</div></div>
      </div>
    </div>
  )
}

export function UsageWidget(): ReactNode {
  const [stats, setStats] = useState<UsageStats | null>(null)
  const [balance, setBalance] = useState<BalanceInfo | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    try {
      const [u, b] = await Promise.all([api.usageStats(), api.balance()])
      setStats(u)
      setBalance(b)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    void load()
    const timer = setInterval(() => void load(), 60_000)
    return () => clearInterval(timer)
  }, [load])

  const refresh = async (): Promise<void> => {
    setRefreshing(true)
    try {
      const [u, b] = await Promise.all([api.usageStats(), api.balance()])
      setStats(u)
      setBalance(b)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRefreshing(false)
    }
  }

  const topModels = useMemo(() => (stats?.cumulative.byModel ?? []).slice(0, 3), [stats])

  return (
    <>
      <div className="dt-usage">
        <button type="button" className="dt-usage-head" onClick={() => setExpanded(true)} title="查看 API 用量与余额">
          <span className="dt-usage-icon">⚡</span>
          <span className="dt-usage-title">API 用量</span>
          {balance && !balance.error && <span className="dt-usage-balance">¥{fmtMoney(balance.totalBalance)}</span>}
        </button>
        {stats && (
          <div className="dt-usage-compact">
            <div className="dt-usage-row"><span>今日</span><span>{usageLine(stats.today)}</span></div>
            <div className="dt-usage-row"><span>累计</span><span>{usageLine(stats.cumulative)}</span></div>
            {topModels.map(m => (
              <div key={m.model} className="dt-usage-row dt-usage-model">
                <span title={m.model}>{shortModel(m.model)}</span>
                <span>¥{fmtMoney(m.cost)} · {m.calls} 次</span>
              </div>
            ))}
          </div>
        )}
        {error && <div className="dt-error" style={{ fontSize: 11 }}>{error}</div>}
      </div>

      {expanded && (
        <Modal title="DeepSeek API 用量" onClose={() => setExpanded(false)} width={520}>
          <BalanceCard balance={balance} />

          {stats && (
            <>
              <div className="dt-section-title">用量概览</div>
              <div className="dt-stat-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
                <div className="dt-stat"><div className="dt-num">¥{fmtMoney(stats.today.cost)}</div><div className="dt-label">今日</div></div>
                <div className="dt-stat"><div className="dt-num">¥{fmtMoney(stats.cumulative.cost)}</div><div className="dt-label">累计费用</div></div>
                <div className="dt-stat"><div className="dt-num">{fmtTokens(totalTokens(stats.cumulative))}</div><div className="dt-label">累计 tokens</div></div>
              </div>

              <div className="dt-section-title">近 7 日（费用估算）</div>
              <MiniBars week={stats.week} />

              <div className="dt-section-title">按模型明细（累计）</div>
              {stats.cumulative.byModel.length === 0 && <div className="dt-hint">暂无用量记录</div>}
              {stats.cumulative.byModel.map(m => (
                <div key={m.model} className="dt-row">
                  <span className="dt-tag" style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis' }}>{shortModel(m.model)}</span>
                  <span className="dt-task-title" style={{ fontSize: 12 }}>¥{fmtMoney(m.cost)} · {m.calls} 次 · {fmtTokens(totalTokens(m))} tokens</span>
                </div>
              ))}
              <div className="dt-hint">
                {stats.pricingLabel} · 已扫描 {stats.scannedLogs} 个会话日志 · 金额为按官方价目表的估算值
                {stats.decompressNote ? ` · ${stats.decompressNote}` : ''}
              </div>
            </>
          )}

          <div className="dt-modal-foot">
            <button type="button" className="dt-btn" disabled={refreshing} onClick={() => void refresh()}>
              {refreshing ? '刷新中…' : '刷新'}
            </button>
            <button type="button" className="dt-btn dt-btn-primary" onClick={() => setExpanded(false)}>关闭</button>
          </div>
        </Modal>
      )}
    </>
  )
}
