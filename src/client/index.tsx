/**
 * dsh-daily-tasks 客户端插件入口。
 *
 * 注册到会话输入栏上方的 conversation.input.dock 插槽（列表插槽，order 10，
 * 位于 TodoDock 与 QueueDock 之间），渲染横屏滚动条；弹窗与大卡片通过
 * createPortal 挂到 document.body。
 */
import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { StateResponse, Task } from '../types.js'
import { CATEGORY_LABELS } from '../types.js'
import { api } from './api.js'
import { useTaskState } from './state.js'
import { injectStyles } from './styles.js'
import { SettingsModal, SummaryModal, TaskCard, TaskPopup } from './modals.js'
import { UsageWidget } from './UsageWidget.js'

export const name = 'dsh-daily-tasks'
export const inject = ['slots']

// ---------- 横屏滚动条 ----------

function Marquee(): ReactNode {
  const { state, error, reload, mutate } = useTaskState()
  const [cardId, setCardId] = useState<string | null>(null)
  const [popupOpen, setPopupOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [summaryOpen, setSummaryOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [paused, setPaused] = useState(false)
  const [previewSpeed, setPreviewSpeed] = useState<number | null>(null)
  const popupHandled = useRef(false)
  const summaryHandledWeek = useRef<string | null>(null)
  // 跑马灯测量：一组任务宽度 + 按容器宽度重复的组数
  const setRef = useRef<HTMLDivElement | null>(null)
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const [setWidth, setSetWidth] = useState(0)
  const [reps, setReps] = useState(2)

  // 首次加载后：需要弹填写窗则弹；周日需要总结则弹总结（每个周期只自动弹一次）
  useEffect(() => {
    if (!state) return
    if (state.popup.shouldShow && !popupHandled.current) {
      popupHandled.current = true
      setPopupOpen(true)
    }
    if (state.summary.due && state.summary.weekKey && summaryHandledWeek.current !== state.summary.weekKey) {
      summaryHandledWeek.current = state.summary.weekKey
      setSummaryOpen(true)
    }
  }, [state])

  const items = state?.marquee.items ?? []
  const itemCount = items.length

  // 测量一组任务的宽度，并按容器宽度计算需要重复几组：
  // 保证整条轨道永远被任务填满，动画每次只平移“一组”宽度，实现无缝循环
  useEffect(() => {
    if (itemCount === 0) return
    const measure = (): void => {
      const viewport = viewportRef.current
      const setEl = setRef.current
      if (!viewport || !setEl) return
      const w = setEl.offsetWidth
      const vw = viewport.clientWidth
      if (w > 0) {
        setSetWidth(w)
        setReps(Math.max(2, Math.ceil(vw / w) + 2))
      }
    }
    measure()
    const ro = new ResizeObserver(measure)
    if (viewportRef.current) ro.observe(viewportRef.current)
    return () => ro.disconnect()
    // items 引用每次状态更新都会变化（编辑、增删、轮询），借此及时重新测量
  }, [items])

  if (!state) {
    if (error) {
      return (
        <div className="dt-marquee">
          <div className="dt-marquee-empty">每日任务插件连接失败：{error}</div>
        </div>
      )
    }
    return null
  }

  const showAnything = state.settings.marqueeEnabled || popupOpen || summaryOpen || settingsOpen
  if (!showAnything) return null

  // 滚动速度：预览值优先（设置弹窗拖动时实时生效），否则用已保存的值
  const speed = previewSpeed ?? state.settings.scrollSpeed
  // 一组任务全部滚过的时间：速度恒定（50px/s × 速度倍率），与任务数量无关
  const duration = setWidth > 0 ? Math.max(3, setWidth / (50 * speed)) : 12

  // 从最新状态里取卡片对应任务，保证完成后状态同步
  const card: Task | null = cardId
    ? [...state.daily, ...state.weekly].find(t => t.id === cardId) ?? null
    : null

  const closePopup = async (carryIds: string[]): Promise<void> => {
    setPopupOpen(false)
    setAddOpen(false)
    await mutate(() => api.closePopup(carryIds))
  }

  return (
    <>
      <div
        className={`dt-marquee${paused ? ' paused' : ''}`}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
      >
        {items.length === 0 ? (
          <div className="dt-marquee-empty">今日与本周暂无任务 —— 点击右侧 + 添加</div>
        ) : (
          <div className="dt-marquee-viewport" ref={viewportRef}>
            {/* key=速度：速度变化时重挂载轨道，强制动画按新时长从 0 重播，保证调整立即可见 */}
            <div
              key={speed}
              className="dt-marquee-track"
              style={{ '--dt-set-w': `${setWidth}px`, animationDuration: `${duration}s` } as CSSProperties}
            >
              {Array.from({ length: reps }).map((_, r) => (
                <div key={r} className="dt-marquee-set" ref={r === 0 ? setRef : undefined}>
                  {items.map(it => (
                    <span
                      key={`${it.id}-${r}`}
                      className={`dt-marquee-item dt-scope-${it.scope}${it.done ? ' dt-done' : ''}`}
                      onClick={() => setCardId(it.id)}
                    >
                      <span className="dt-dot" />
                      <span className="dt-badge">{it.scope === 'daily' ? '今日' : '本周'}</span>
                      <span className="dt-title">{it.title}</span>
                      <span className="dt-cat">{CATEGORY_LABELS[it.category]}</span>
                    </span>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
        <button type="button" className="dt-marquee-add" title="添加任务" onClick={() => setAddOpen(true)}>＋</button>
        <button type="button" className="dt-marquee-gear" title="每日任务设置" onClick={() => setSettingsOpen(true)}>⚙</button>
      </div>

      {card && <TaskCard task={card} onClose={() => setCardId(null)} onChanged={reload} />}
      {(popupOpen || addOpen) && state && <TaskPopup state={state} onClose={carryIds => void closePopup(carryIds)} onChanged={reload} />}
      {summaryOpen && state.summary.weekKey && (
        <SummaryModal weekKey={state.summary.weekKey} onClose={() => setSummaryOpen(false)} onChanged={reload} />
      )}
      {settingsOpen && (
        <SettingsModal
          settings={state.settings}
          onClose={() => { setSettingsOpen(false); setPreviewSpeed(null) }}
          onSaved={reload}
          onPreviewSpeed={setPreviewSpeed}
        />
      )}
    </>
  )
}

// ---------- 插件挂载 ----------

interface SlotsLike {
  inject(name: string, callback: () => unknown): () => void
  register(options: { name: string; id: string; order?: number }, component: unknown): () => void
}

export async function apply(ctx: { slots: SlotsLike }): Promise<() => void> {
  injectStyles()
  const disposers: (() => void)[] = []
  // 输入栏上方的任务滚动条
  disposers.push(ctx.slots.inject('conversation.input.dock', () =>
    ctx.slots.register(
      { name: 'conversation.input.dock', id: 'dsh-daily-tasks.marquee', order: 10 },
      Marquee as never,
    ),
  ))
  // 侧边栏底部（设置上方）的 API 用量小部件
  disposers.push(ctx.slots.inject('sidebar.footer.action', () =>
    ctx.slots.register(
      { name: 'sidebar.footer.action', id: 'dsh-daily-tasks.usage', order: 10 },
      UsageWidget as never,
    ),
  ))
  return () => { for (const d of disposers) d() }
}

export type { StateResponse }
