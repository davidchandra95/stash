import { invoke, isTauri } from '@tauri-apps/api/core'
import { platform } from '../platform'
import { useEffect, useState } from 'react'
import { listen } from '@tauri-apps/api/event'

export type ModelId = 'small' | 'base'
export type Language = 'auto' | 'en' | 'id'
export type Preferences = { model: ModelId; language: Language }
export type Progress = {
  sessionId: string
  phase:
    | 'idle'
    | 'downloading'
    | 'preparing'
    | 'recording'
    | 'transcribing'
    | 'review'
    | 'cancelled'
    | 'error'
  seconds: number
  downloaded: number
  total: number
  transcript: string | null
  error: string | null
}
export type Status = {
  supported: boolean
  models: { id: ModelId; bytes: number; installed: boolean }[]
  progress: Progress
}
export const supported = () => isTauri() && platform.platform === 'macos'
export const running = (p?: Progress) =>
  !!p && ['downloading', 'preparing', 'recording', 'transcribing'].includes(p.phase)
export const modelLabels: Record<ModelId, string> = {
  small: 'Small (488 MB)',
  base: 'Base (148 MB)',
}
const key = 'stash.dictation.v1'
export function readPreferences(): Preferences {
  try {
    const p = JSON.parse(localStorage.getItem(key) ?? '{}')
    return {
      model: p.model === 'base' ? 'base' : 'small',
      language: ['en', 'id'].includes(p.language) ? p.language : 'auto',
    }
  } catch {
    return { model: 'small', language: 'auto' }
  }
}
export function savePreferences(p: Preferences) {
  localStorage.setItem(key, JSON.stringify(p))
}
export function useStatus() {
  const [status, setStatus] = useState<Status>()
  const [error, setError] = useState('')
  useEffect(() => {
    let disposed = false
    let pending = false
    const refresh = async () => {
      if (pending || disposed) return
      pending = true
      try {
        const next = await invoke<Status>('dictation_status')
        if (!disposed) {
          setStatus(next)
          setError('')
        }
      } catch (e) {
        if (!disposed) setError(String(e))
      } finally {
        pending = false
      }
    }
    void refresh()
    // Polling also recovers completion missed while mounting or after a listener error.
    const timer = window.setInterval(() => void refresh(), 500)
    const listener = listen<Progress>('dictation-progress', () => void refresh())
    void listener.catch(() => {})
    return () => {
      disposed = true
      clearInterval(timer)
      void listener.then((off) => off()).catch(() => {})
    }
  }, [])
  return { status, error }
}
export const newSession = () => crypto.randomUUID()
