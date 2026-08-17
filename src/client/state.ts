/**
 * 任务状态 Hook：定时拉取宿主端状态，变更后重载。
 */
import { useCallback, useEffect, useState } from 'react'
import type { StateResponse } from '../types.js'
import { api } from './api.js'

export interface TaskState {
  state: StateResponse | null
  error: string | null
  reload: () => Promise<void>
  /** 执行一个变更请求，成功后重载状态。 */
  mutate: (fn: () => Promise<unknown>) => Promise<void>
}

export function useTaskState(pollMs = 30_000): TaskState {
  const [state, setState] = useState<StateResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    try {
      setState(await api.state())
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    void reload()
    const timer = setInterval(() => void reload(), pollMs)
    return () => clearInterval(timer)
  }, [reload, pollMs])

  const mutate = useCallback(async (fn: () => Promise<unknown>) => {
    await fn()
    await reload()
  }, [reload])

  return { state, error, reload, mutate }
}
