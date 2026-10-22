import AppTooltip from './AppTooltip'
import { useEffect, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { FolderOpen, X } from '../icons'
import { isTauri } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { library } from '../storage/useLibrary'
import type { Notebook, NotebookIcon } from '../model'
import { isNotebookIcon, notebookIconOptions } from '../notebookIcons'
import {
  canonicalNotebookColor,
  defaultNotebookColor,
  notebookColorPreset,
  notebookColors,
  notebookColorValue,
} from '../notebookColors'

const colorPattern = /^#[0-9a-f]{6}$/i

function notebookColor(color: string) {
  return colorPattern.test(color) ? canonicalNotebookColor(color) : defaultNotebookColor
}

export default function NotebookDialog({
  open: visible,
  onOpenChange,
  parent,
  notebook,
  onCreated,
  onUpdated,
  allowFolderLinking = true,
}: {
  allowFolderLinking?: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  parent?: Notebook
  notebook?: Notebook
  onCreated: (id: string) => void
  onUpdated: (
    id: string,
    patch: { name: string; icon: NotebookIcon; color: string },
  ) => void | Promise<void>
}) {
  const editing = !!notebook
  const nameInput = useRef<HTMLInputElement>(null)
  const request = useRef(0)
  const [name, setName] = useState('')
  const [icon, setIcon] = useState<NotebookIcon>('notebook')
  const [color, setColor] = useState(defaultNotebookColor)
  const [path, setPath] = useState<string | null>(null)
  const [summary, setSummary] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!visible) return
    request.current += 1
    setName(notebook?.name ?? '')
    setIcon(isNotebookIcon(notebook?.icon) ? notebook.icon : 'notebook')
    setColor(notebookColor(notebook?.color ?? defaultNotebookColor))
    setPath(null)
    setSummary('')
    setError('')
  }, [visible, notebook?.id])

  const pick = async () => {
    const token = ++request.current
    setError('')
    if (!isTauri()) {
      setError('Folder linking requires the Stash desktop app.')
      return
    }
    try {
      const chosen = await open({
        directory: true,
        multiple: false,
        title: 'Choose a Markdown folder',
      })
      if (!chosen || token !== request.current) return
      setPath(chosen)
      setName((old) => old || chosen.split('/').filter(Boolean).at(-1) || '')
      setBusy(true)
      setSummary('Scanning Markdown files…')
      const scan = await library.command<{ path: string; files: number; folders: number }>(
        'scan_folder',
        { path: chosen },
      )
      if (token === request.current) {
        setPath(scan.path)
        setSummary(
          `${scan.files} Markdown ${scan.files === 1 ? 'file' : 'files'} · ${scan.folders} sub-notebooks`,
        )
      }
    } catch (e) {
      if (token === request.current) {
        setError(String(e))
        setSummary('')
      }
    } finally {
      if (token === request.current) setBusy(false)
    }
  }

  const close = (next: boolean, force = false) => {
    if (busy && !force) return
    if (!next) {
      ++request.current
      setName('')
      setIcon('notebook')
      setColor(defaultNotebookColor)
      setPath(null)
      setSummary('')
      setError('')
    }
    onOpenChange(next)
  }

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy) return
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Enter a notebook name.')
      nameInput.current?.focus()
      return
    }
    if (trimmed.length > 80) {
      setError('Notebook names can be up to 80 characters.')
      nameInput.current?.focus()
      return
    }
    if (!isNotebookIcon(icon)) {
      setError('Choose a supported notebook icon.')
      return
    }
    if (!colorPattern.test(color)) {
      setError('Choose a valid notebook color.')
      return
    }
    setBusy(true)
    setError('')
    try {
      if (notebook) {
        await onUpdated(notebook.id, { name: trimmed, icon, color })
      } else {
        const id = await library.createNotebook(trimmed, parent?.id, path ?? undefined)
        if (!id) throw Error('The notebook could not be created.')
        await library.updateNotebook(id, { name: trimmed, icon, color })
        onCreated(id)
      }
      close(false, true)
    } catch (submitError) {
      setError(String(submitError))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog.Root open={visible} onOpenChange={close}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content
          className="dialog notebook-dialog"
          data-notebook-id={notebook?.id}
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            nameInput.current?.focus()
          }}
          onCloseAutoFocus={(event) => {
            if (!notebook?.id) return
            const trigger = [...document.querySelectorAll<HTMLElement>('.notebook-options')].find(
              (element) => element.dataset.notebookId === notebook.id,
            )
            if (!trigger) return
            event.preventDefault()
            trigger.focus({ preventScroll: true })
          }}
        >
          <form onSubmit={(event) => void submit(event)}>
            <div className="dialog-header">
              <Dialog.Title className="dialog-title">
                {editing ? 'Edit notebook' : parent ? 'New sub-notebook' : 'New notebook'}
              </Dialog.Title>
              <Dialog.Description className="dialog-description">
                {editing
                  ? `Change how ${notebook?.name} looks in the sidebar.`
                  : parent
                    ? `Inside ${parent.name}.`
                    : 'A home for a collection of notes.'}
              </Dialog.Description>
            </div>
            <div className="dialog-body">
              <div className="notebook-name-row">
                <span
                  className="notebook-preview"
                  style={{ color: notebookColorValue(color) } as React.CSSProperties}
                  aria-hidden="true"
                >
                  {(() => {
                    const Icon = notebookIconOptions.find((option) => option.id === icon)!.icon
                    return <Icon />
                  })()}
                </span>
                <input
                  ref={nameInput}
                  id="notebook-name"
                  className="field"
                  aria-label="Notebook name"
                  placeholder="Name"
                  maxLength={80}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  disabled={busy}
                />
              </div>

              <fieldset className="notebook-fieldset" disabled={busy}>
                <legend className="field-label">Color</legend>
                <div className="notebook-colors">
                  {notebookColors.map((preset) => (
                    <button
                      type="button"
                      key={preset.id}
                      className="color-swatch"
                      style={{ '--swatch': `var(--notebook-${preset.id})` } as React.CSSProperties}
                      aria-label={`Color ${preset.label}`}
                      aria-pressed={color.toLowerCase() === preset.light}
                      onClick={() => setColor(preset.light)}
                    />
                  ))}
                  <AppTooltip label="Custom color">
                    <label
                      className="color-swatch is-custom"
                      aria-pressed={!notebookColorPreset(color)}
                      style={{ '--swatch': notebookColorValue(color) } as React.CSSProperties}
                    >
                      <input
                        id="notebook-color"
                        type="color"
                        aria-label="Notebook color"
                        value={color}
                        onChange={(event) => setColor(event.target.value)}
                        disabled={busy}
                      />
                    </label>
                  </AppTooltip>
                </div>
              </fieldset>

              <fieldset className="notebook-fieldset" disabled={busy}>
                <legend className="field-label">Icon</legend>
                <div className="notebook-icons">
                  {notebookIconOptions.map(({ id, label, icon: Icon }) => (
                    <AppTooltip instant label={label} disabled={busy} key={id}>
                      <button
                        type="button"
                        className="icon-btn notebook-icon"
                        aria-label={label}
                        aria-pressed={icon === id}
                        style={icon === id ? { color: notebookColorValue(color) } : undefined}
                        onClick={() => setIcon(id)}
                      >
                        <Icon aria-hidden="true" />
                      </button>
                    </AppTooltip>
                  ))}
                </div>
              </fieldset>

              {editing ? (
                notebook?.rootId && (
                  <p className="field-help">
                    This notebook is linked to a folder. Renaming it here doesn’t rename the folder
                    on disk.
                  </p>
                )
              ) : parent?.rootId ? (
                <p className="field-help">This creates a folder inside the linked notebook.</p>
              ) : allowFolderLinking ? (
                <div className="folder-link">
                  {path ? (
                    <div className="folder-link-path">
                      <FolderOpen aria-hidden="true" />
                      <AppTooltip label={path}>
                        <span className="truncate">{path}</span>
                      </AppTooltip>
                      <button
                        type="button"
                        className="btn btn-plain btn-sm"
                        disabled={busy}
                        onClick={() => void pick()}
                      >
                        Change…
                      </button>
                      <button
                        type="button"
                        className="icon-btn icon-btn-sm"
                        aria-label="Remove folder"
                        disabled={busy}
                        onClick={() => {
                          ++request.current
                          setPath(null)
                          setSummary('')
                          setError('')
                        }}
                      >
                        <X aria-hidden="true" />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-plain folder-link-button"
                      onClick={() => void pick()}
                      disabled={busy}
                    >
                      <FolderOpen aria-hidden="true" />
                      Link a folder of Markdown files…
                    </button>
                  )}
                  {summary && (
                    <p role="status" className="field-help">
                      {summary}
                    </p>
                  )}
                  {path && (
                    <p className="field-help">
                      Edits in Stash update the original Markdown files. Renaming the notebook
                      doesn’t rename the folder.
                    </p>
                  )}
                </div>
              ) : null}
              {error && (
                <p role="alert" className="field-error">
                  {error}
                </p>
              )}
            </div>
            <div className="dialog-footer">
              <button type="button" className="btn" disabled={busy} onClick={() => close(false)}>
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={!name.trim() || busy || !!(path && error)}
              >
                {busy ? 'Working…' : editing ? 'Save' : 'Create'}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
