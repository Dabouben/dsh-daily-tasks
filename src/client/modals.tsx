/**
 * 插件弹窗组件：每日/每周任务填写弹窗、周日周总结、任务大卡片、设置。
 */
import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { Settings, StateResponse, SummaryStats, Task, TaskCategory, TaskScope } from '../types.js'
import { CATEGORY_LABELS } from '../types.js'
import { api, type TaskPatch } from './api.js'

// ---------- 基础组件 ----------

export function Modal(props: { title: string; onClose: () => void; children: ReactNode; width?: number }): ReactNode {
  const { title, onClose, children, width } = props
  return createPortal(
    <div className="dt-modal-mask" onMouseDown={onClose}>
      <div
        className="dt-modal"
        style={width ? { width } : undefined}
        onMouseDown={e => e.stopPropagation()}
      >
        <div className="dt-modal-head">
          <span>{title}</span>
          <button type="button" className="dt-modal-x" onClick={onClose} aria-label="关闭">✕</button>
        </div>
        <div className="dt-modal-body">{children}</div>
      </div>
    </div>,
    document.body,
  )
}

function Circle(props: { checked: boolean; big?: boolean; onClick: () => void; title?: string }): ReactNode {
  return (
    <button
      type="button"
      className={`dt-circle${props.checked ? ' dt-checked' : ''}${props.big ? ' dt-big' : ''}`}
      onClick={e => { e.stopPropagation(); props.onClick() }}
      title={props.title ?? (props.checked ? '已完成，点击取消' : '点击完成')}
      aria-label={props.title ?? '完成'}
    >
      ✓
    </button>
  )
}

function playBeep(): void {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return
    const ctx = new Ctor()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.frequency.value = 880
    gain.gain.setValueAtTime(0.12, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4)
    osc.start()
    osc.stop(ctx.currentTime + 0.4)
    void ctx.close().catch(() => {})
  } catch { /* 忽略音频错误 */ }
}

// ---------- 任务填写弹窗 ----------

export function TaskPopup(props: {
  state: StateResponse
  onClose: (carryIds: string[]) => void
  onChanged: () => Promise<void>
}): ReactNode {
  const { state, onClose, onChanged } = props
  const [tab, setTab] = useState<TaskScope>('daily')
  const [carrySel, setCarrySel] = useState<Set<string>>(new Set())
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState<TaskCategory>('work')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (state.settings.soundEnabled) playBeep()
  }, [state.settings.soundEnabled])

  const toggleCarry = (id: string): void => {
    setCarrySel(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const add = async (scope: TaskScope): Promise<void> => {
    const text = title.trim()
    if (!text) return
    setBusy(true)
    setError(null)
    try {
      await api.addTask({ scope, title: text, category })
      setTitle('')
      await onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const toggleDone = async (t: Task): Promise<void> => {
    try {
      await api.updateTask(t.id, t.scope, { done: !t.done })
      await onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const list = tab === 'daily' ? state.daily : state.weekly

  return (
    <Modal title={tab === 'daily' ? '今日任务' : '本周任务'} onClose={() => { if (!busy) onClose([...carrySel]) }} width={560}>
      {state.pendingCarry.length > 0 && (
        <div>
          <div className="dt-section-title">
            昨天有 {state.pendingCarry.length} 项未完成 —— 勾选圆圈可延期到今天，未勾选的将归档：
          </div>
          <div className="dt-carry-list">
            {state.pendingCarry.map(c => (
              <div key={c.id} className="dt-row">
                <Circle checked={carrySel.has(c.id)} onClick={() => toggleCarry(c.id)} title={carrySel.has(c.id) ? '已选：延期到今天' : '未选：归档'} />
                <span className="dt-task-title">{c.title}</span>
                <span className="dt-tag">{CATEGORY_LABELS[c.category]}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="dt-tabs">
        <button type="button" className="dt-tab" aria-current={tab === 'daily' ? 'page' : undefined} onClick={() => setTab('daily')}>今日</button>
        <button type="button" className="dt-tab" aria-current={tab === 'weekly' ? 'page' : undefined} onClick={() => setTab('weekly')}>本周</button>
      </div>

      <div>
        <div className="dt-section-title">{tab === 'daily' ? '今天的任务' : '本周的任务'}</div>
        {list.length === 0 && <div className="dt-hint">还没有任务，添加一个吧。</div>}
        {list.map(t => (
          <div key={t.id} className="dt-row">
            <Circle checked={t.done} onClick={() => void toggleDone(t)} />
            <span className={`dt-task-title${t.done ? ' dt-done' : ''}`}>{t.title}</span>
            <span className="dt-tag">{CATEGORY_LABELS[t.category]}</span>
          </div>
        ))}
      </div>

      <div className="dt-add-row">
        <input
          type="text"
          value={title}
          placeholder={tab === 'daily' ? '添加今日任务…' : '添加本周任务…'}
          onChange={e => setTitle(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') void add(tab) }}
        />
        <select className="dt-select" value={category} onChange={e => setCategory(e.target.value as TaskCategory)}>
          {(Object.keys(CATEGORY_LABELS) as TaskCategory[]).map(c => (
            <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
          ))}
        </select>
        <button type="button" className="dt-btn dt-btn-primary" disabled={busy || !title.trim()} onClick={() => void add(tab)}>添加</button>
      </div>

      {error && <div className="dt-error">{error}</div>}
      <div className="dt-hint">关闭窗口时，昨天未完成的任务会按圆圈选择延期或归档。</div>

      <div className="dt-modal-foot">
        <button type="button" className="dt-btn dt-btn-primary" disabled={busy} onClick={() => onClose([...carrySel])}>
          保存并关闭
        </button>
      </div>
    </Modal>
  )
}

// ---------- 周日周总结 ----------

export function SummaryModal(props: { weekKey: string; onClose: () => void; onChanged: () => Promise<void> }): ReactNode {
  const { weekKey, onClose, onChanged } = props
  const [stats, setStats] = useState<SummaryStats | null>(null)
  const [text, setText] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [closing, setClosing] = useState(false)

  useEffect(() => {
    let cancelled = false
    const run = async (): Promise<void> => {
      setLoading(true)
      setError(null)
      try {
        const s = await api.summaryData(weekKey)
        if (cancelled) return
        setStats(s)
        const g = await api.generateSummary(weekKey)
        if (cancelled) return
        setText(g.text)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void run()
    return () => { cancelled = true }
  }, [weekKey])

  const close = async (): Promise<void> => {
    if (closing) return
    setClosing(true)
    try { await api.ackSummary(); await onChanged() } catch { /* 忽略 */ }
    onClose()
  }

  return (
    <Modal title="上周总结" onClose={() => void close()} width={560}>
      {stats && (
        <div className="dt-stat-grid">
          <div className="dt-stat"><div className="dt-num">{stats.completed}</div><div className="dt-label">完成</div></div>
          <div className="dt-stat"><div className="dt-num">{stats.undone}</div><div className="dt-label">未完成</div></div>
          <div className="dt-stat"><div className="dt-num">{stats.carried}</div><div className="dt-label">顺延</div></div>
          <div className="dt-stat"><div className="dt-num">{stats.rate}%</div><div className="dt-label">完成率</div></div>
        </div>
      )}
      {stats && stats.byCategory.length > 0 && (
        <div className="dt-row" style={{ flexWrap: 'wrap' }}>
          {stats.byCategory.map(b => (
            <span key={b.category} className="dt-tag">{CATEGORY_LABELS[b.category]} × {b.count}</span>
          ))}
        </div>
      )}
      <div className="dt-section-title">AI 总结（由 DeepSeek 生成）</div>
      {loading && !text && <div><span className="dt-spinner" /> 正在生成上周总结…</div>}
      {text && (
        <div className="dt-summary-text">
          {text}
          <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="dt-btn"
              onClick={() => { void navigator.clipboard?.writeText(text).catch(() => {}) }}
            >复制总结</button>
          </div>
        </div>
      )}
      {error && (
        <div className="dt-error">
          {error}
          <div style={{ marginTop: 6 }}>
            <button type="button" className="dt-btn" onClick={() => { setText(null); setLoading(true); setError(null); void (async () => {
              try { setText((await api.generateSummary(weekKey)).text) } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setLoading(false) }
            })() }}>重试</button>
          </div>
        </div>
      )}
      <div className="dt-modal-foot">
        <button type="button" className="dt-btn dt-btn-primary" disabled={closing} onClick={() => void close()}>知道了</button>
      </div>
    </Modal>
  )
}

// ---------- 任务大卡片 ----------

export function TaskCard(props: { task: Task; onClose: () => void; onChanged: () => Promise<void> }): ReactNode {
  const { task, onClose, onChanged } = props
  const [title, setTitle] = useState(task.title)
  const [note, setNote] = useState(task.note)
  const [category, setCategory] = useState<TaskCategory>(task.category)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async (patch: TaskPatch): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await api.updateTask(task.id, task.scope, patch)
      await onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const doDelete = async (): Promise<void> => {
    if (!confirmDelete) { setConfirmDelete(true); return }
    setBusy(true)
    try {
      await api.deleteTask(task.id, task.scope)
      await onChanged()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  const created = useMemo(() => {
    const d = new Date(task.createdAt)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }, [task.createdAt])

  return (
    <Modal title={task.scope === 'daily' ? '每日任务' : '每周任务'} onClose={onClose} width={440}>
      <div className="dt-row" style={{ padding: 0 }}>
        <Circle big checked={task.done} onClick={() => void save({ done: !task.done })} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <input
            type="text"
            className="dt-task-title"
            style={{ width: '100%', border: 'none', background: 'transparent', color: 'inherit', outline: 'none', fontSize: 16, fontWeight: 600 }}
            value={title}
            onChange={e => setTitle(e.target.value)}
            onBlur={() => { if (title.trim() && title !== task.title) void save({ title: title.trim() }) }}
          />
          <div className="dt-row" style={{ padding: 0, gap: 6 }}>
            <span className="dt-tag">{task.scope === 'daily' ? '每日' : '每周'}</span>
            <select className="dt-select" value={category} onChange={e => setCategory(e.target.value as TaskCategory)} onBlur={() => { if (category !== task.category) void save({ category }) }}>
              {(Object.keys(CATEGORY_LABELS) as TaskCategory[]).map(c => (
                <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
              ))}
            </select>
            <span className="dt-hint">创建于 {created}</span>
          </div>
        </div>
      </div>

      <div className="dt-section-title">备注</div>
      <textarea
        rows={4}
        style={{ width: '100%', boxSizing: 'border-box', padding: 8, borderRadius: 8, border: '1px solid rgba(128,128,128,0.4)', background: 'var(--dt-input-bg, #fff)', color: 'var(--dt-text, #222)', fontSize: 13, resize: 'vertical', outline: 'none' }}
        value={note}
        placeholder="写点备注…"
        onChange={e => setNote(e.target.value)}
        onBlur={() => { if (note !== task.note) void save({ note }) }}
      />

      {task.done && task.doneAt && <div className="dt-hint">完成于 {new Date(task.doneAt).toLocaleString()}</div>}
      {error && <div className="dt-error">{error}</div>}

      <div className="dt-modal-foot">
        <button type="button" className={`dt-btn ${confirmDelete ? 'dt-btn-danger' : ''}`} disabled={busy} onClick={() => void doDelete()}>
          {confirmDelete ? '确认删除？' : '删除'}
        </button>
        <button type="button" className="dt-btn" disabled={busy} onClick={onClose}>关闭</button>
      </div>
    </Modal>
  )
}

// ---------- 设置 ----------

export function SettingsModal(props: { settings: Settings; onClose: () => void; onSaved: () => Promise<void>; onPreviewSpeed?: (speed: number) => void }): ReactNode {
  const { settings, onClose, onSaved, onPreviewSpeed } = props
  const [draft, setDraft] = useState<Settings>({ ...settings })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await api.saveSettings(draft)
      await onSaved()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  const toggle = (key: 'popupEnabled' | 'marqueeEnabled' | 'postponeEnabled' | 'soundEnabled'): void => {
    setDraft(prev => ({ ...prev, [key]: !prev[key] }))
  }

  const WEEKS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

  return (
    <Modal title="每日任务 · 设置" onClose={onClose} width={460}>
      <div className="dt-setting-row">
        <span className="dt-label">每天第一次打开时弹出任务填写窗</span>
        <button type="button" className={`dt-switch${draft.popupEnabled ? ' dt-on' : ''}`} onClick={() => toggle('popupEnabled')} aria-label="弹窗提醒" />
      </div>
      <div className="dt-setting-row">
        <span className="dt-label">显示对话栏上方的横屏滚动条</span>
        <button type="button" className={`dt-switch${draft.marqueeEnabled ? ' dt-on' : ''}`} onClick={() => toggle('marqueeEnabled')} aria-label="滚动条" />
      </div>
      <div className="dt-setting-row">
        <span className="dt-label">关闭弹窗时提示“是否延期至第二天”</span>
        <button type="button" className={`dt-switch${draft.postponeEnabled ? ' dt-on' : ''}`} onClick={() => toggle('postponeEnabled')} aria-label="延期提醒" />
      </div>
      <div className="dt-setting-row">
        <span className="dt-label">弹窗出现时播放提示音</span>
        <button type="button" className={`dt-switch${draft.soundEnabled ? ' dt-on' : ''}`} onClick={() => toggle('soundEnabled')} aria-label="提示音" />
      </div>
      <div className="dt-setting-row">
        <span className="dt-label">每周任务重置日</span>
        <select className="dt-select" value={draft.weeklyResetDay} onChange={e => setDraft(prev => ({ ...prev, weeklyResetDay: Number(e.target.value) }))}>
          {WEEKS.map((w, i) => <option key={i} value={i}>{w}</option>)}
        </select>
      </div>
      <div className="dt-setting-row">
        <span className="dt-label">滚动速度</span>
        <input
          type="range" className="dt-range" min={0.5} max={2} step={0.1}
          value={draft.scrollSpeed}
          onChange={e => {
            const v = Number(e.target.value)
            setDraft(prev => ({ ...prev, scrollSpeed: v }))
            onPreviewSpeed?.(v) // 拖动时实时预览
          }}
        />
        <span className="dt-tag">{draft.scrollSpeed.toFixed(1)}×</span>
      </div>
      <div className="dt-hint">拖动速度滑块可实时预览滚动效果；保存后永久生效。任务数据保存在 DSH 数据目录下的 daily-tasks.json，重启不丢失。</div>
      {error && <div className="dt-error">{error}</div>}
      <div className="dt-modal-foot">
        <button type="button" className="dt-btn" disabled={busy} onClick={onClose}>取消</button>
        <button type="button" className="dt-btn dt-btn-primary" disabled={busy} onClick={() => void save()}>保存</button>
      </div>
    </Modal>
  )
}
