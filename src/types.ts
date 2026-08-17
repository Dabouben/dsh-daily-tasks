/**
 * 宿主端与客户端共享的数据类型。
 * 客户端只以 `import type` 引用本文件（编译期擦除，不进 bundle）。
 */

export type TaskScope = 'daily' | 'weekly'
export type TaskCategory = 'work' | 'study' | 'life' | 'other'

export interface Task {
  id: string
  scope: TaskScope
  title: string
  note: string
  category: TaskCategory
  done: boolean
  createdAt: number
  doneAt?: number
}

export interface Settings {
  /** 每周任务重置日，0=周日 … 6=周六，默认 0。 */
  weeklyResetDay: number
  /** 滚动速度倍率 0.5 - 2，默认 1。 */
  scrollSpeed: number
  /** 每天第一次打开时弹任务填写窗。 */
  popupEnabled: boolean
  /** 显示输入栏上方的横屏滚动条。 */
  marqueeEnabled: boolean
  /** 弹窗关闭时提示“是否延期至第二天”的圆圈选择。 */
  postponeEnabled: boolean
  /** 弹窗出现时播放提示音。 */
  soundEnabled: boolean
}

export interface HistoryEntry {
  /** 任务所属日期（每日任务）或周期首日（每周任务）。 */
  date: string
  /** 周期键。 */
  weekKey: string
  scope: TaskScope
  title: string
  category: TaskCategory
  done: boolean
  doneAt?: number
  /** 顺延到下一周期的任务。 */
  carriedOver?: boolean
}

export interface CarryCandidate {
  id: string
  title: string
  note: string
  category: TaskCategory
  /** 原属日期。 */
  date: string
}

export interface SummaryStats {
  weekKey: string
  completed: number
  undone: number
  carried: number
  total: number
  rate: number
  byCategory: { category: TaskCategory; count: number }[]
  items: HistoryEntry[]
}

export interface MarqueeItem {
  id: string
  scope: TaskScope
  title: string
  category: TaskCategory
  done: boolean
}

export interface StateResponse {
  today: string
  currentWeekKey: string
  daily: Task[]
  weekly: Task[]
  settings: Settings
  pendingCarry: CarryCandidate[]
  popup: { shouldShow: boolean }
  summary: {
    due: boolean
    weekKey: string | null
  }
  marquee: {
    visible: boolean
    items: MarqueeItem[]
  }
}

export const CATEGORY_LABELS: Record<TaskCategory, string> = {
  work: '工作',
  study: '学习',
  life: '生活',
  other: '其他',
}

// ---------- 用量/余额（与宿主端 usage.ts 对应） ----------

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
  week: { date: string; cost: number; calls: number }[]
  cumulative: DayUsage
  scannedLogs: number
  pricingLabel: string
  generatedAt: number
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
