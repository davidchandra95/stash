import { useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import {
  modelLabels,
  newSession,
  readPreferences,
  running,
  savePreferences,
  useStatus,
  type ModelId,
  type Preferences,
} from './client'

export default function ModelSettings() {
  const [preferences, setPreferences] = useState(readPreferences)
  const { status, error: statusError } = useStatus()
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const session = useRef('')
  const busy = pending || running(status?.progress)
  const selected = status?.models.find((m) => m.id === preferences.model)
  const progress = status?.progress.sessionId === session.current ? status.progress : undefined
  useEffect(() => {
    if (progress) setPending(false)
  }, [progress])
  useEffect(
    () => () => {
      if (session.current)
        void invoke('dictation_cancel', { sessionId: session.current }).catch(() => {})
    },
    [],
  )
  const update = (next: Preferences) => {
    try {
      savePreferences(next)
      setPreferences(next)
      setError('')
    } catch (e) {
      setError(`Could not save dictation preferences: ${e}`)
    }
  }
  const action = async (remove: boolean) => {
    setPending(true)
    setError('')
    try {
      session.current = newSession()
      await invoke(remove ? 'dictation_delete_model' : 'dictation_download', {
        modelId: preferences.model,
        sessionId: session.current,
      })
      if (remove) setPending(false)
    } catch (e) {
      setError(String(e))
      setPending(false)
    }
  }
  const downloading = progress?.phase === 'downloading'
  return (
    <div className="dictation-settings">
      <div className="settings-row">
        <span className="settings-label">
          Speech model
          <small>
            {downloading
              ? `Downloading ${Math.round(progress.downloaded / 1e6)} / ${Math.round(progress.total / 1e6)} MB`
              : selected?.installed
                ? 'Downloaded. Works offline.'
                : 'Not downloaded. Small is more accurate; Base is lighter.'}
          </small>
        </span>
        <span className="settings-control dictation-model-control">
          <select
            className="select-native"
            aria-label="Speech model"
            disabled={busy}
            value={preferences.model}
            onChange={(e) => update({ ...preferences, model: e.target.value as ModelId })}
          >
            {(Object.keys(modelLabels) as ModelId[]).map((id) => (
              <option key={id} value={id}>
                {modelLabels[id]}
              </option>
            ))}
          </select>
          {busy && session.current ? (
            <button
              className="btn"
              onClick={() =>
                void invoke('dictation_cancel', { sessionId: session.current }).catch((e) =>
                  setError(String(e)),
                )
              }
            >
              Cancel
            </button>
          ) : (
            <button
              className="btn"
              disabled={!status || busy}
              onClick={() => void action(!!selected?.installed)}
            >
              {selected?.installed ? 'Remove' : 'Download'}
            </button>
          )}
        </span>
      </div>
      <div className="settings-row">
        <span className="settings-label">
          Language
          <small>Use one language per recording. Mixed-language speech may be missed.</small>
        </span>
        <span className="settings-control">
          <select
            className="select-native"
            aria-label="Dictation language"
            disabled={busy}
            value={preferences.language}
            onChange={(e) =>
              update({ ...preferences, language: e.target.value as Preferences['language'] })
            }
          >
            <option value="auto">Detect automatically</option>
            <option value="en">English</option>
            <option value="id">Bahasa Indonesia</option>
          </select>
        </span>
      </div>
      <p className="field-help">Audio stays on this Mac and is never uploaded or saved.</p>
      {(error || statusError || progress?.error) && (
        <p role="alert">{error || statusError || progress?.error}</p>
      )}
    </div>
  )
}
