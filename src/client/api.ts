/**
 * 客户端 → 宿主端 HTTP 封装。页面与宿主同源，直接相对路径 fetch。
 */
import type { BalanceInfo, Settings, StateResponse, SummaryStats, Task, TaskCategory, TaskScope, UsageStats } from '../types.js'

const BASE = '/dsh-daily-tasks'

async function request<T>(path: string, options?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(BASE + path, {
    method: options?.method ?? 'GET',
    headers: options?.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: options?.body !== undefined ? JSON.stringify(options.body) : undefined,
  })
  const data = (await res.json().catch(() => ({}))) as { error?: string }
  if (!res.ok) throw new Error(data.error || `请求失败 (${res.status})`)
  return data as T
}

export interface TaskInput {
  scope: TaskScope
  title: string
  note?: string
  category?: TaskCategory
}

export interface TaskPatch {
  title?: string
  note?: string
  category?: TaskCategory
  done?: boolean
}

export const api = {
  state: () => request<{ state: StateResponse }>('/state').then(r => r.state),
  addTask: (body: TaskInput) => request<{ task: Task }>('/tasks', { method: 'POST', body }),
  updateTask: (id: string, scope: TaskScope, patch: TaskPatch) =>
    request<{ task: Task }>('/tasks', { method: 'PATCH', body: { id, scope, patch } }),
  deleteTask: (id: string, scope: TaskScope) =>
    request<{ ok: true }>('/tasks', { method: 'DELETE', body: { id, scope } }),
  closePopup: (carryIds: string[]) =>
    request<{ ok: true }>('/popup/close', { method: 'POST', body: { carryIds } }),
  saveSettings: (s: Partial<Settings>) =>
    request<{ settings: Settings }>('/settings', { method: 'POST', body: s }),
  summaryData: (weekKey: string) =>
    request<{ stats: SummaryStats }>(`/summary/data?weekKey=${encodeURIComponent(weekKey)}`).then(r => r.stats),
  generateSummary: (weekKey: string) =>
    request<{ text: string; cached: boolean }>('/summary/generate', { method: 'POST', body: { weekKey } }),
  ackSummary: () => request<{ ok: true }>('/summary/ack', { method: 'POST' }),
  usageStats: () => request<{ usage: UsageStats }>('/usage/stats').then(r => r.usage),
  balance: () => request<{ balance: BalanceInfo }>('/usage/balance').then(r => r.balance),
}
