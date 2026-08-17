/**
 * 任务存储：内存态 + $DSH_HOME 下 JSON 文件原子落盘。
 *
 * 结构：
 *   daily:      { "2026-08-16": Task[] }       按日期
 *   weekly:     { "2026-08-16": Task[] }       按周期键（周期首日 ISO 日期）
 *   history:    HistoryEntry[]                 归档（完成 / 未完成未延期 / 周滚落）
 *   pendingCarry: CarryCandidate[]             昨日未完成、等待用户在弹窗里选择延期或归档
 *
 * 滚动规则：
 *   - 每日：新的一天读状态时，昨天的任务——已完成 → 归档；未完成 → 进入 pendingCarry
 *     （持久化，弹窗里用圆圈选择“延期到今天”或归档）。弹窗关闭时统一处理。
 *   - 每周：周期键变化（到了新的重置日）时，上一周期的每周任务整体归档，开始新周期。
 *   - 周日（重置日）第一次打开：弹出上周总结（数据来自 history）。
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type {
  CarryCandidate, HistoryEntry, MarqueeItem, Settings, StateResponse, SummaryStats, Task, TaskCategory, TaskScope,
} from './types.js'
import {
  currentWeekKey, previousWeekKey, todayIso, weekKeyOfDate,
} from './week.js'

export const DEFAULT_SETTINGS: Settings = {
  weeklyResetDay: 0,
  scrollSpeed: 1,
  popupEnabled: true,
  marqueeEnabled: true,
  postponeEnabled: true,
  soundEnabled: false,
}

interface FileState {
  version: 1
  settings: Settings
  daily: Record<string, Task[]>
  weekly: Record<string, Task[]>
  history: HistoryEntry[]
  pendingCarry: CarryCandidate[]
  lastPopupDate: string | null
  lastSummaryWeek: string | null
  summaryCache: { weekKey: string; text: string; at: number } | null
}

function freshState(): FileState {
  return {
    version: 1,
    settings: { ...DEFAULT_SETTINGS },
    daily: {},
    weekly: {},
    history: [],
    pendingCarry: [],
    lastPopupDate: null,
    lastSummaryWeek: null,
    summaryCache: null,
  }
}

const CATEGORIES: TaskCategory[] = ['work', 'study', 'life', 'other']

export class TaskStore {
  private state: FileState = freshState()
  private loaded = false
  private loadPromise: Promise<void> | null = null
  private writeChain: Promise<void> = Promise.resolve()

  constructor(private dataPath: string) {}

  // ---------- 持久化 ----------

  /**
   * 加载（幂等且可等待）：返回同一个进行中的加载 Promise，
   * 所有调用方 await 它，保证首次落盘（空状态）在任何变更之前完成，
   * 避免 apply 时的异步首次 load 与首个请求的写入互相覆盖。
   */
  load(): Promise<void> {
    if (this.loadPromise) return this.loadPromise
    this.loadPromise = (async () => {
      try {
        const raw = await fs.readFile(this.dataPath, 'utf8')
        const parsed = JSON.parse(raw) as Partial<FileState>
        this.state = {
          ...freshState(),
          ...parsed,
          settings: { ...DEFAULT_SETTINGS, ...(parsed.settings ?? {}) },
          daily: parsed.daily ?? {},
          weekly: parsed.weekly ?? {},
          history: parsed.history ?? [],
          pendingCarry: parsed.pendingCarry ?? [],
        }
      } catch {
        // 首次运行或文件损坏：使用默认空状态
        this.state = freshState()
        await this.persist()
      }
      this.loaded = true
    })()
    return this.loadPromise
  }

  /**
   * 原子写盘（临时文件 + rename）。
   * 临时文件名带唯一后缀：apply 时异步的首次 load() 可能与首个请求的 persist()
   * 并发，同名前缀会互相 rename 竞争（ENOENT）；唯一名保证并发写各自成功，
   * 最后完成的 rename 胜出（每次都是完整快照，最终一致）。
   */
  private async persist(): Promise<void> {
    const snapshot = JSON.stringify(this.state, null, 2)
    await fs.mkdir(path.dirname(this.dataPath), { recursive: true })
    const tmp = `${this.dataPath}.tmp-${process.pid}-${randomUUID()}`
    await fs.writeFile(tmp, snapshot, 'utf8')
    await fs.rename(tmp, this.dataPath)
  }

  /** 串行执行一个变更（读改写都排队），保证不并发破坏。 */
  private enqueue<T>(fn: () => Promise<T> | T): Promise<T> {
    const prev = this.writeChain
    let resolve!: (v: T) => void
    let reject!: (e: unknown) => void
    const out = new Promise<T>((res, rej) => { resolve = res; reject = rej })
    this.writeChain = prev.then(async () => {
      try { resolve(await fn()) } catch (e) { reject(e) }
    })
    return out
  }

  // ---------- 滚动 ----------

  /**
   * 每日滚动：把早于今天的每日任务处理掉，返回是否发生了变更。
   * 完成 → 归档；未完成 → 追加进 pendingCarry。
   */
  private rollDaily(): boolean {
    const today = todayIso()
    const resetDay = this.state.settings.weeklyResetDay
    let changed = false
    for (const date of Object.keys(this.state.daily)) {
      if (date >= today) continue
      const tasks = this.state.daily[date]
      const weekKey = weekKeyOfDate(date, resetDay)
      for (const t of tasks) {
        if (t.done) {
          this.state.history.push({
            date, weekKey, scope: t.scope, title: t.title, category: t.category,
            done: true, doneAt: t.doneAt,
          })
        } else {
          this.state.pendingCarry.push({ id: t.id, title: t.title, note: t.note, category: t.category, date })
        }
      }
      delete this.state.daily[date]
      changed = true
    }
    return changed
  }

  /** 每周滚动：周期键变化时，旧周期每周任务整体归档。返回是否变更。 */
  private rollWeekly(): boolean {
    const current = currentWeekKey(this.state.settings.weeklyResetDay)
    let changed = false
    for (const key of Object.keys(this.state.weekly)) {
      if (key === current) continue
      const tasks = this.state.weekly[key]
      for (const t of tasks) {
        this.state.history.push({
          date: key, weekKey: key, scope: t.scope, title: t.title, category: t.category,
          done: t.done, doneAt: t.doneAt,
        })
      }
      delete this.state.weekly[key]
      changed = true
    }
    return changed
  }

  /**
   * 归档一批延期候选（弹窗关闭时未勾选的）。返回归档数。
   */
  private archiveCarry(candidates: CarryCandidate[]): number {
    const resetDay = this.state.settings.weeklyResetDay
    for (const c of candidates) {
      this.state.history.push({
        date: c.date, weekKey: weekKeyOfDate(c.date, resetDay), scope: 'daily',
        title: c.title, category: c.category, done: false, carriedOver: false,
      })
    }
    return candidates.length
  }

  /** 把勾选的延期候选并入今天。 */
  private carryIntoToday(candidates: CarryCandidate[], ids: Set<string>): number {
    const today = todayIso()
    const resetDay = this.state.settings.weeklyResetDay
    const bucket = (this.state.daily[today] ??= [])
    let count = 0
    for (const c of candidates) {
      if (!ids.has(c.id)) continue
      bucket.push({
        id: c.id, scope: 'daily', title: c.title, note: c.note, category: c.category,
        done: false, createdAt: Date.now(),
      })
      this.state.history.push({
        date: c.date, weekKey: weekKeyOfDate(c.date, resetDay), scope: 'daily',
        title: c.title, category: c.category, done: false, carriedOver: true,
      })
      count++
    }
    return count
  }

  /**
   * 执行滚动并把 pendingCarry 里等待处理的候选处理掉：
   * 弹窗/延期功能关闭时，未勾选的候选直接归档；否则保留等待弹窗处理。
   */
  private settleCarry(): boolean {
    if (!this.state.settings.popupEnabled || !this.state.settings.postponeEnabled) {
      const pending = this.state.pendingCarry
      if (pending.length > 0) {
        this.archiveCarry(pending)
        this.state.pendingCarry = []
        return true
      }
    }
    return false
  }

  // ---------- 读取 ----------

  /** 读取当前状态快照（同时执行每日/每周滚动）。 */
  async snapshot(): Promise<StateResponse> {
    await this.load()
    return this.enqueue(async () => {
      const dailyChanged = this.rollDaily()
      const weeklyChanged = this.rollWeekly()
      const carryChanged = this.settleCarry()
      if (dailyChanged || weeklyChanged || carryChanged) {
        await this.persist()
      }
      const today = todayIso()
      const resetDay = this.state.settings.weeklyResetDay
      const current = currentWeekKey(resetDay)
      const isResetToday = new Date().getDay() === resetDay

      const daily = this.state.daily[today] ?? []
      const weekly = this.state.weekly[current] ?? []

      const summaryDue = isResetToday && this.state.lastSummaryWeek !== current
      const summaryWeekKey = summaryDue ? previousWeekKey(resetDay) : null

      const popupShouldShow = this.state.settings.popupEnabled &&
        (this.state.lastPopupDate !== today || this.state.pendingCarry.length > 0)

      const marqueeItems: MarqueeItem[] = [
        ...daily.map(t => ({ id: t.id, scope: 'daily' as const, title: t.title, category: t.category, done: t.done })),
        ...weekly.map(t => ({ id: t.id, scope: 'weekly' as const, title: t.title, category: t.category, done: t.done })),
      ]

      const response: StateResponse = {
        today,
        currentWeekKey: current,
        daily,
        weekly,
        settings: { ...this.state.settings },
        pendingCarry: this.state.pendingCarry.map(c => ({ ...c })),
        popup: { shouldShow: popupShouldShow },
        summary: { due: summaryDue, weekKey: summaryWeekKey },
        marquee: { visible: this.state.settings.marqueeEnabled, items: marqueeItems },
      }
      return response
    })
  }

  // ---------- 任务变更 ----------

  private bucket(scope: TaskScope, key: string): Task[] {
    if (scope === 'daily') return (this.state.daily[key] ??= [])
    return (this.state.weekly[key] ??= [])
  }

  private findTask(scope: TaskScope, key: string, id: string): Task | undefined {
    return this.bucket(scope, key).find(t => t.id === id)
  }

  async addTask(input: { scope: TaskScope; title: string; note?: string; category?: TaskCategory }): Promise<Task> {
    await this.load()
    return this.enqueue(async () => {
      const title = (input.title ?? '').trim()
      if (!title) throw new Error('任务标题不能为空')
      const scope = input.scope === 'weekly' ? 'weekly' : 'daily'
      const category: TaskCategory = CATEGORIES.includes(input.category as TaskCategory)
        ? (input.category as TaskCategory) : 'other'
      const key = scope === 'daily' ? todayIso() : currentWeekKey(this.state.settings.weeklyResetDay)
      const task: Task = {
        id: randomUUID(),
        scope,
        title,
        note: (input.note ?? '').trim(),
        category,
        done: false,
        createdAt: Date.now(),
      }
      this.bucket(scope, key).push(task)
      await this.persist()
      return task
    })
  }

  async updateTask(input: { id: string; scope: TaskScope; patch: Partial<Pick<Task, 'title' | 'note' | 'category' | 'done'>> }): Promise<Task> {
    await this.load()
    return this.enqueue(async () => {
      const key = input.scope === 'daily' ? todayIso() : currentWeekKey(this.state.settings.weeklyResetDay)
      const task = this.findTask(input.scope, key, input.id)
      if (!task) throw new Error('任务不存在')
      if (input.patch.title !== undefined) {
        const title = input.patch.title.trim()
        if (!title) throw new Error('任务标题不能为空')
        task.title = title
      }
      if (input.patch.note !== undefined) task.note = input.patch.note
      if (input.patch.category !== undefined && CATEGORIES.includes(input.patch.category)) {
        task.category = input.patch.category
      }
      if (input.patch.done !== undefined && input.patch.done !== task.done) {
        task.done = input.patch.done
        task.doneAt = input.patch.done ? Date.now() : undefined
      }
      await this.persist()
      return task
    })
  }

  async deleteTask(input: { id: string; scope: TaskScope }): Promise<void> {
    await this.load()
    return this.enqueue(async () => {
      const key = input.scope === 'daily' ? todayIso() : currentWeekKey(this.state.settings.weeklyResetDay)
      const bucket = this.bucket(input.scope, key)
      const idx = bucket.findIndex(t => t.id === input.id)
      if (idx >= 0) bucket.splice(idx, 1)
      await this.persist()
    })
  }

  /**
   * 弹窗关闭：处理 pendingCarry（勾选 → 延期至今天；未勾选 → 归档），并记录今天已看过弹窗。
   */
  async closePopup(input: { carryIds: string[] }): Promise<void> {
    await this.load()
    return this.enqueue(async () => {
      const candidates = this.state.pendingCarry
      const ids = new Set(Array.isArray(input.carryIds) ? input.carryIds : [])
      this.carryIntoToday(candidates, ids)
      const rest = candidates.filter(c => !ids.has(c.id))
      this.archiveCarry(rest)
      this.state.pendingCarry = []
      this.state.lastPopupDate = todayIso()
      await this.persist()
    })
  }

  // ---------- 设置 ----------

  async getSettings(): Promise<Settings> {
    await this.load()
    return { ...this.state.settings }
  }

  async saveSettings(next: Partial<Settings>): Promise<Settings> {
    await this.load()
    return this.enqueue(async () => {
      const s = this.state.settings
      if (typeof next.weeklyResetDay === 'number') {
        s.weeklyResetDay = Math.max(0, Math.min(6, Math.floor(next.weeklyResetDay)))
      }
      if (typeof next.scrollSpeed === 'number') {
        s.scrollSpeed = Math.max(0.5, Math.min(2, next.scrollSpeed))
      }
      if (typeof next.popupEnabled === 'boolean') s.popupEnabled = next.popupEnabled
      if (typeof next.marqueeEnabled === 'boolean') s.marqueeEnabled = next.marqueeEnabled
      if (typeof next.postponeEnabled === 'boolean') s.postponeEnabled = next.postponeEnabled
      if (typeof next.soundEnabled === 'boolean') s.soundEnabled = next.soundEnabled
      await this.persist()
      return { ...s }
    })
  }

  // ---------- 周总结 ----------

  async summaryStats(weekKey: string): Promise<SummaryStats> {
    await this.load()
    const items = this.state.history.filter(h => h.weekKey === weekKey)
    const completed = items.filter(h => h.done).length
    const undone = items.filter(h => !h.done && !h.carriedOver).length
    const carried = items.filter(h => !h.done && h.carriedOver).length
    const total = completed + undone
    const byCategory = CATEGORIES.map(category => ({
      category,
      count: items.filter(h => h.done && h.category === category).length,
    })).filter(x => x.count > 0)
    return {
      weekKey,
      completed,
      undone,
      carried,
      total,
      rate: total > 0 ? Math.round((completed / total) * 100) : 0,
      byCategory,
      items,
    }
  }

  /** 读取缓存的上周 AI 总结（如有）。 */
  summaryCacheFor(weekKey: string): string | null {
    const c = this.state.summaryCache
    return c && c.weekKey === weekKey ? c.text : null
  }

  /** 保存生成的 AI 总结。 */
  async saveSummaryCache(weekKey: string, text: string): Promise<void> {
    await this.load()
    return this.enqueue(async () => {
      this.state.summaryCache = { weekKey, text, at: Date.now() }
      await this.persist()
    })
  }

  /** 标记当前周期的总结已展示。 */
  async ackSummary(): Promise<void> {
    await this.load()
    return this.enqueue(async () => {
      this.state.lastSummaryWeek = currentWeekKey(this.state.settings.weeklyResetDay)
      await this.persist()
    })
  }
}
