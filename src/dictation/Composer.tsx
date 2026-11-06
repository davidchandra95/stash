import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from 'react'
import { invoke } from '@tauri-apps/api/core'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import AppTooltip from '../components/AppTooltip'
import { ArrowUp, Check, Copy, Mic, Square, X } from '../icons'
import { library } from '../storage/useLibrary'
import { insertTranscript } from './insertion'
import { noteAvailable, type Target } from './useDictation'
import { modelLabels, newSession, readPreferences, running, useStatus } from './client'
import Waveform from './Waveform'
import './dictation.css'

function IconButton({
  label,
  className = '',
  ...props
}: { label: string; children: ReactNode } & ComponentProps<'button'>) {
  return (
    <AppTooltip instant side="top" label={label}>
      <button className={`icon-btn ${className}`} aria-label={label} {...props} />
    </AppTooltip>
  )
}

/** The recording and review bar, docked where the formatting toolbar docks. */
export default function DictationComposer({
  target,
  stopRequest,
  activeNoteId,
  onClose,
}: {
  target: Target
  stopRequest: number
  activeNoteId?: string
  onClose: () => void
}) {
  const { status, error: statusError } = useStatus()
  const [transcript, setTranscript] = useState('')
  const [review, setReview] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [invalid, setInvalid] = useState(false)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [copied, setCopied] = useState(false)
  const [session, setSession] = useState('')
  const root = useRef<HTMLDivElement>(null)
  const textbox = useRef<HTMLTextAreaElement>(null)
  const started = useRef(false)
  const consumed = useRef('')
  const closing = useRef(false)
  const insertWhenReady = useRef(false)
  const recordAfterDownload = useRef(false)
  const liveSession = useRef('')
  liveSession.current = session
  const progress = session && status?.progress.sessionId === session ? status.progress : undefined
  const phase = progress?.phase
  const model = status?.models.find((m) => m.id === readPreferences().model)
  const problem = error || statusError || progress?.error || ''
  const view = review
    ? 'review'
    : problem
      ? 'error'
      : phase === 'downloading'
        ? 'downloading'
        : phase === 'transcribing' || stopping
          ? 'transcribing'
          : phase === 'recording'
            ? 'recording'
            : status && !model?.installed && !pending && phase !== 'preparing'
              ? 'setup'
              : 'preparing'

  useEffect(() => {
    const check = () =>
      setInvalid(
        !noteAvailable(target.noteId) || target.editor.isDestroyed || !target.editor.isEditable,
      )
    check()
    const unsubscribe = library.subscribe(check)
    target.editor.on('transaction', check)
    target.editor.on('destroy', check)
    return () => {
      unsubscribe()
      target.editor.off('transaction', check)
      target.editor.off('destroy', check)
      if (liveSession.current)
        void invoke('dictation_cancel', { sessionId: liveSession.current }).catch(() => {})
    }
  }, [target])

  // Follows the editor pane; a project page hides it, so the bar then centers in the window.
  useLayoutEffect(() => {
    const element = root.current
    const pane =
      document.querySelector('.editor-group.is-focused') ?? document.querySelector('.editor-pane')
    if (!element || !pane) return
    const place = () => {
      const { left, width } = pane.getBoundingClientRect()
      const area = width || window.innerWidth
      element.style.setProperty('--dictation-center', `${width ? left + width / 2 : area / 2}px`)
      element.style.setProperty('--dictation-area', `${area}px`)
    }
    place()
    const observer = new ResizeObserver(place)
    observer.observe(pane)
    window.addEventListener('resize', place)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', place)
    }
  }, [])

  useLayoutEffect(() => {
    const box = textbox.current
    if (!box) return
    let width = -1
    const fit = () => {
      if (box.clientWidth === width) return
      width = box.clientWidth
      box.style.height = 'auto'
      box.style.height = `${box.scrollHeight}px`
    }
    fit()
    // The bar narrows and widens with the editor pane, which rewraps the text.
    const observer = new ResizeObserver(fit)
    observer.observe(box)
    return () => observer.disconnect()
  }, [transcript, view])

  // Keeps keyboard control on the bar as its controls change.
  useEffect(() => {
    if (view === 'review') {
      const box = textbox.current
      box?.focus()
      box?.setSelectionRange(box.value.length, box.value.length)
    } else root.current?.focus()
  }, [view])

  const insert = (text: string) => {
    try {
      if (!noteAvailable(target.noteId))
        throw Error('This note is no longer editable. Copy the text instead.')
      insertTranscript(target.editor, text)
      void close()
      return true
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e))
      return false
    }
  }

  const start = async (download: boolean) => {
    const id = newSession()
    recordAfterDownload.current = download
    insertWhenReady.current = false
    setPending(true)
    setStopping(false)
    setError('')
    setReview(false)
    setSession(id)
    const preferences = readPreferences()
    try {
      await invoke(download ? 'dictation_download' : 'dictation_start', {
        sessionId: id,
        modelId: preferences.model,
        language: preferences.language,
      })
    } catch (e) {
      setError(String(e))
      setPending(false)
    }
  }

  // Dictation starts as soon as the bar opens, once any cancelled worker has exited.
  useEffect(() => {
    if (started.current || !status || running(status.progress)) return
    started.current = true
    if (model?.installed) void start(false)
  })

  useEffect(() => {
    if (!progress) return
    setPending(false)
    if (progress.phase === 'error' || progress.phase === 'cancelled') setStopping(false)
    if (progress.phase === 'idle' && recordAfterDownload.current) void start(false)
    if (progress.phase === 'review' && consumed.current !== progress.sessionId) {
      consumed.current = progress.sessionId
      setStopping(false)
      const next = [transcript.trim(), progress.transcript ?? ''].filter(Boolean).join(' ')
      setTranscript(next)
      if (!insertWhenReady.current || !insert(next)) setReview(true)
    }
  }, [progress])

  const stop = (thenInsert: boolean) => {
    insertWhenReady.current = thenInsert
    setStopping(true)
    void invoke('dictation_stop', { sessionId: session }).catch((e) => {
      setStopping(false)
      setError(String(e))
    })
  }
  useEffect(() => {
    if (stopRequest && view === 'recording') stop(false)
  }, [stopRequest])

  async function close() {
    if (closing.current) return
    closing.current = true
    try {
      if (liveSession.current) await invoke('dictation_cancel', { sessionId: liveSession.current })
      setSession('')
      liveSession.current = ''
      if (!target.editor.isDestroyed) target.editor.commands.focus()
      onClose()
    } catch (e) {
      setError(String(e))
      closing.current = false
    }
  }
  // Cancelling another take returns to the text already dictated.
  const dismiss = () => {
    if (view === 'review' || !transcript.trim()) return void close()
    void invoke('dictation_cancel', { sessionId: session }).catch((e) => setError(String(e)))
    setSession('')
    setStopping(false)
    setPending(false)
    setError('')
    setReview(true)
  }
  const retry = () => {
    if (running(status?.progress)) return
    void start(!model?.installed)
  }

  const dismissLabel = view === 'review' ? 'Discard' : 'Cancel'
  const elsewhere = activeNoteId !== target.noteId
  return (
    <div
      ref={root}
      className="dictation-composer"
      role="region"
      aria-label="Dictation"
      tabIndex={-1}
      data-view={view}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && event.target === root.current && view === 'recording') {
          event.preventDefault()
          return stop(true)
        }
        if (event.key !== 'Escape') return
        event.preventDefault()
        event.stopPropagation()
        dismiss()
      }}
    >
      {problem && view === 'review' && (
        <p className="dictation-line is-error" role="alert">
          {problem}
        </p>
      )}
      {invalid && view !== 'error' && (
        <p className="dictation-line is-error" role="alert">
          The note can’t be edited right now. Copy the text to keep it.
        </p>
      )}
      {!invalid && elsewhere && (
        <p className="dictation-line">Inserts into “{target.title || 'Untitled'}”</p>
      )}
      <div className="dictation-row">
        <IconButton label={dismissLabel} onClick={dismiss}>
          <X aria-hidden="true" />
        </IconButton>
        {view === 'review' && (
          <textarea
            ref={textbox}
            className="dictation-text"
            aria-label="Dictated text"
            placeholder="Nothing dictated"
            rows={1}
            value={transcript}
            onChange={(event) => setTranscript(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
              event.preventDefault()
              if (!invalid && transcript.trim()) insert(transcript)
            }}
          />
        )}
        {view === 'recording' && (
          <>
            <span className="dictation-time" role="timer">
              {Math.floor((progress?.seconds ?? 0) / 60)}:
              {String((progress?.seconds ?? 0) % 60).padStart(2, '0')}
            </span>
            <Waveform sessionId={session} />
          </>
        )}
        <span className="dictation-status" role="status" aria-live="polite">
          {view === 'setup' && model && <>Speech model needed: {modelLabels[model.id]}</>}
          {view === 'preparing' && <span className="is-working">Opening microphone…</span>}
          {view === 'transcribing' && <span className="is-working">Transcribing…</span>}
          {view === 'downloading' && progress && (
            <>
              <progress max={progress.total || 1} value={progress.downloaded} />
              {Math.round(progress.downloaded / 1e6)} / {Math.round(progress.total / 1e6)} MB
            </>
          )}
        </span>
        {view === 'error' && (
          <p className="dictation-error" role="alert">
            {problem}
          </p>
        )}
        {view === 'setup' && (
          <button className="btn btn-primary btn-sm" onClick={() => void start(true)}>
            Download model
          </button>
        )}
        {view === 'error' && (
          <button className="btn btn-sm" disabled={!status} onClick={retry}>
            Try again
          </button>
        )}
        {view === 'recording' && (
          <IconButton
            label="Stop and review"
            className="dictation-stop"
            onClick={() => stop(false)}
          >
            <Square aria-hidden="true" />
          </IconButton>
        )}
        {view === 'review' && (
          <>
            <IconButton
              label={copied ? 'Copied' : 'Copy text'}
              onClick={() =>
                void writeText(transcript)
                  .then(() => {
                    setCopied(true)
                    window.setTimeout(() => setCopied(false), 1200)
                  })
                  .catch((e) => setError(String(e)))
              }
            >
              {copied ? (
                <Check className="dictation-copied" aria-hidden="true" />
              ) : (
                <Copy aria-hidden="true" />
              )}
            </IconButton>
            <IconButton
              label="Dictate more"
              disabled={running(status?.progress)}
              onClick={() => void start(false)}
            >
              <Mic aria-hidden="true" />
            </IconButton>
          </>
        )}
        {(view === 'recording' || view === 'review') && (
          <IconButton
            label="Insert into note"
            className="dictation-send"
            disabled={view === 'review' && (invalid || !transcript.trim())}
            onClick={() => (view === 'recording' ? stop(true) : insert(transcript))}
          >
            <ArrowUp aria-hidden="true" />
          </IconButton>
        )}
      </div>
    </div>
  )
}
