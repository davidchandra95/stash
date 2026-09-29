import { useEffect, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { FolderOpen, X } from '../icons'
import { isTauri } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { library } from '../storage/useLibrary'
import type { Notebook, NotebookIcon } from '../model'
import { isNotebookIcon, notebookIconOptions } from '../notebookIcons'

const defaultColor = '#82936f'
const colorPattern = /^#[0-9a-f]{6}$/i

function notebookColor(color: string) {
  return colorPattern.test(color) ? color : defaultColor
}

export default function NotebookDialog({
  open: visible,
  onOpenChange,
  parent,
  notebook,
  onCreated,
  onUpdated,
  fontFamily,
  dark,
  palette,
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
  fontFamily: string
  dark: boolean
  palette: string
}) {
  const editing = !!notebook
  const nameInput = useRef<HTMLInputElement>(null)
  const request = useRef(0)
  const [name, setName] = useState('')
  const [icon, setIcon] = useState<NotebookIcon>('notebook')
  const [color, setColor] = useState(defaultColor)
  const [path, setPath] = useState<string | null>(null)
  const [summary, setSummary] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!visible) return
    request.current += 1
    setName(notebook?.name ?? '')
    setIcon(isNotebookIcon(notebook?.icon) ? notebook.icon : 'notebook')
    setColor(notebookColor(notebook?.color ?? defaultColor))
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
      setColor(defaultColor)
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
          className="settings-dialog notebook-dialog"
          style={{ fontFamily }}
          data-theme={dark ? 'dark' : 'light'}
          data-palette={palette}
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
          <Dialog.Title>
            {editing ? 'Edit notebook' : parent ? 'New sub-notebook' : 'New notebook'}
          </Dialog.Title>
          <Dialog.Description className="muted">
            {editing
              ? `Update ${notebook?.name}.`
              : parent
                ? `Inside ${parent.name}`
                : 'Give a collection of thoughts a home.'}
          </Dialog.Description>
          <form className="notebook-dialog-form" onSubmit={(event) => void submit(event)}>
            <label className="notebook-field-label" htmlFor="notebook-name">
              Name
            </label>
            <input
              ref={nameInput}
              id="notebook-name"
              className="text-field"
              aria-label="Notebook name"
              placeholder="Notebook name"
              maxLength={80}
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={busy}
            />

            <fieldset className="notebook-icon-picker" disabled={busy}>
              <legend>Icon</legend>
              <div className="notebook-icon-options">
                {notebookIconOptions.map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    type="button"
                    className={`notebook-icon-option ${icon === id ? 'selected' : ''}`}
                    aria-label={label}
                    aria-pressed={icon === id}
                    title={label}
                    onClick={() => setIcon(id)}
                  >
                    <Icon size={18} aria-hidden="true" />
                  </button>
                ))}
              </div>
            </fieldset>

            <label className="notebook-color-field" htmlFor="notebook-color">
              <span>Color</span>
              <span className="notebook-color-value">{color.toUpperCase()}</span>
              <input
                id="notebook-color"
                type="color"
                aria-label="Notebook color"
                value={color}
                onChange={(event) => setColor(event.target.value)}
                disabled={busy}
              />
            </label>

            {editing ? (
              notebook?.rootId && (
                <p className="muted folder-help">
                  This folder-linked notebook keeps its disk folder. Changing the name only changes
                  the label in Stash and does not rename the folder.
                </p>
              )
            ) : parent?.rootId ? (
              <p className="muted folder-help">This creates a folder inside the linked notebook.</p>
            ) : allowFolderLinking ? (
              <div className="folder-picker">
                {path ? (
                  <>
                    <div className="folder-path">
                      <FolderOpen size={18} />
                      <span title={path}>{path}</span>
                      <button
                        type="button"
                        className="icon-button"
                        aria-label="Remove folder"
                        disabled={busy}
                        onClick={() => {
                          ++request.current
                          setPath(null)
                          setSummary('')
                          setError('')
                        }}
                      >
                        <X size={16} />
                      </button>
                    </div>
                    <button
                      type="button"
                      className="quiet-button"
                      disabled={busy}
                      onClick={() => void pick()}
                    >
                      Change folder
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="folder-pick-button"
                    onClick={() => void pick()}
                    disabled={busy}
                  >
                    <FolderOpen size={18} />
                    <span>Link a folder from this computer</span>
                  </button>
                )}
                {summary && (
                  <div role="status" className="muted">
                    {summary}
                  </div>
                )}
                {path && (
                  <p className="muted folder-help">
                    Edits in Stash update the original Markdown files. The notebook name does not
                    rename the folder.
                  </p>
                )}
              </div>
            ) : null}
            {error && (
              <p role="alert" className="folder-error">
                {error}
              </p>
            )}
            <div className="dialog-buttons">
              <button
                type="button"
                className="quiet-button"
                disabled={busy}
                onClick={() => close(false)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="primary-button"
                disabled={!name.trim() || busy || !!(path && error)}
              >
                {busy ? 'Working…' : editing ? 'Save changes' : 'Create notebook'}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
