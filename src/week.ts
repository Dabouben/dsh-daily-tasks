/**
 * 日期与“周”工具函数。
 *
 * “周”的周期由设置项 weeklyResetDay 决定（0=周日 … 6=周六，默认周日）：
 * 一个周期从 weeklyResetDay 那天开始，到下一天 weeklyResetDay 之前结束。
 * 周期键使用周期首日的 ISO 日期，例如 "2026-08-16"。
 */

/** 本地时区的 YYYY-MM-DD。 */
export function isoDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function todayIso(): string {
  return isoDate(new Date())
}

/** 本地时区星期几，0=周日 … 6=周六。 */
export function weekday(d: Date): number {
  return d.getDay()
}

/** 今天是否就是重置日。 */
export function isResetDay(d: Date, resetDay: number): boolean {
  return d.getDay() === resetDay
}

/** 包含日期 d 的周期首日（本地时区，时间归零）。 */
export function periodStart(d: Date, resetDay: number): Date {
  const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const diff = (copy.getDay() - resetDay + 7) % 7
  copy.setDate(copy.getDate() - diff)
  return copy
}

/** 周期键：周期首日的 ISO 日期。 */
export function weekKeyOf(d: Date, resetDay: number): string {
  return isoDate(periodStart(d, resetDay))
}

/** 当前周期键。 */
export function currentWeekKey(resetDay: number): string {
  return weekKeyOf(new Date(), resetDay)
}

/** 上一个周期键。 */
export function previousWeekKey(resetDay: number): string {
  const start = periodStart(new Date(), resetDay)
  start.setDate(start.getDate() - 7)
  return isoDate(start)
}

/** 某天的 ISO 日期属于哪个周期键。 */
export function weekKeyOfDate(dateIso: string, resetDay: number): string {
  const [y, m, d] = dateIso.split('-').map(Number)
  return weekKeyOf(new Date(y, m - 1, d), resetDay)
}

/** 人类可读周期描述，如 "8月10日 - 8月16日"。 */
export function weekRangeLabel(weekKey: string): string {
  const [y, m, d] = weekKey.split('-').map(Number)
  const start = new Date(y, m - 1, d)
  const end = new Date(start)
  end.setDate(end.getDate() + 6)
  const fmt = (x: Date) => `${x.getMonth() + 1}月${x.getDate()}日`
  return `${fmt(start)} - ${fmt(end)}`
}
