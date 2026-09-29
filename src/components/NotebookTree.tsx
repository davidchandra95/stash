import { useEffect, useState, type ReactNode } from 'react'
import * as Dropdown from '@radix-ui/react-dropdown-menu'
import {
  ChevronDown,
  ChevronRight,
  FilePlus2,
  FolderOpen,
  FolderPlus,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  SquarePen,
  Trash2,
  Unlink2,
} from '../icons'
import type { Notebook } from '../model'
import { notebookPath } from '../notebooks'
import MenuActionContent from './MenuActionContent'
import { showNativeContextMenu, usesNativeContextMenu } from '../nativeContextMenu'
import type { NoteAction } from './NoteContextMenu'
export default function NotebookTree({
  books,
  active,
  renderBook,
  createNote,
  edit,
  deleteNotebook,
  deleteDisabled,
  deleteDisabledReason,
  createChild,
  refresh,
  reselect,
  convert,
  disabled,
  dark,
  palette,
  dropTarget,
}: {
  dropTarget?: { id: string; allowed: boolean; hint: string } | null
  books: Notebook[]
  active: string
  dark: boolean
  palette: string
  renderBook: (book: Notebook) => ReactNode
  createNote: (book: Notebook) => void
  edit: (book: Notebook) => void
  deleteNotebook: (book: Notebook) => void
  deleteDisabled?: (book: Notebook) => boolean
  deleteDisabledReason?: (book: Notebook) => string
  createChild: (book: Notebook) => void
  refresh: (id: string) => void
  reselect: (id: string) => void
  convert?: (book: Notebook) => void
  disabled?: boolean
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [openBookId, setOpenBookId] = useState<string | null>(null)
  useEffect(() => {
    let book = books.find((b) => `book:${b.id}` === active)
    const ancestors = new Set<string>()
    while (book?.parentId && !ancestors.has(book.parentId)) {
      ancestors.add(book.parentId)
      book = books.find((b) => b.id === book!.parentId)
    }
    setCollapsed((old) => new Set([...old].filter((id) => !ancestors.has(id))))
  }, [active, books])
  useEffect(() => {
    if (!dropTarget || !collapsed.has(dropTarget.id)) return
    const timer = window.setTimeout(
      () =>
        setCollapsed((old) => {
          const next = new Set(old)
          next.delete(dropTarget.id)
          return next
        }),
      600,
    )
    return () => window.clearTimeout(timer)
  }, [dropTarget?.id, collapsed])
  const openMenu = (book: Notebook, launcher: HTMLElement, point: { x: number; y: number }) => {
    if (disabled) return
    setOpenBookId(book.id)
    if (!usesNativeContextMenu()) return
    const actions: NoteAction[] = [
      { label: 'New note', icon: FilePlus2, run: () => createNote(book) },
      { label: 'Edit', icon: Pencil, run: () => edit(book) },
      { label: 'New sub-notebook', icon: FolderPlus, run: () => createChild(book) },
    ]
    if (book.rootId) {
      actions.push({ label: 'Refresh folder', icon: RefreshCw, run: () => refresh(book.rootId!) })
      if (book.relativePath === '' && convert)
        actions.push({
          label: 'Convert to Stash notebook…',
          icon: Unlink2,
          run: () => convert(book),
        })
      actions.push({
        label: 'Locate linked folder…',
        icon: FolderOpen,
        run: () => reselect(book.rootId!),
      })
    }
    const cannotDelete = deleteDisabled?.(book) ?? !!book.rootId
    actions.push({
      label: 'Delete notebook',
      icon: Trash2,
      separator: true,
      disabled: cannotDelete,
      run: () => deleteNotebook(book),
    })
    if (cannotDelete)
      actions.push({
        label: deleteDisabledReason?.(book) ?? 'Folder-linked notebooks cannot be deleted.',
        icon: Trash2,
        disabled: true,
        run: () => {},
      })
    void showNativeContextMenu(actions, launcher, point)
      .catch((error) => {
        console.error('Native notebook menu failed', error)
        window.alert('Could not open the context menu. Please try again.')
      })
      .finally(() => setOpenBookId(null))
  }
  const branch = (parent: string | null, depth = 0): ReactNode =>
    books
      .filter((b) => (b.parentId ?? null) === parent)
      .map((book) => {
        const children = books.some((b) => b.parentId === book.id),
          expanded = !collapsed.has(book.id),
          selected = active === `book:${book.id}`
        return (
          <div key={book.id} className="notebook-branch">
            <div
              className={`notebook-tree-row ${selected ? 'selected' : ''} ${
                openBookId === book.id ? 'menu-open' : ''
              } ${dropTarget?.id === book.id ? (dropTarget.allowed ? 'notebook-drop-target' : 'notebook-drop-unavailable') : ''}`}
              data-notebook-drop-id={book.id}
              style={{ paddingLeft: depth * 14 }}
              title={dropTarget?.id === book.id ? dropTarget.hint : notebookPath(book, books)}
              onContextMenu={(event) => {
                event.preventDefault()
                openMenu(book, event.currentTarget, { x: event.clientX, y: event.clientY })
              }}
            >
              {children ? (
                <button
                  className="notebook-disclosure"
                  aria-label={`${expanded ? 'Collapse' : 'Expand'} ${book.name}`}
                  aria-expanded={expanded}
                  onClick={() =>
                    setCollapsed((old) => {
                      const next = new Set(old)
                      if (expanded) next.add(book.id)
                      else next.delete(book.id)
                      return next
                    })
                  }
                >
                  {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </button>
              ) : (
                <span className="notebook-disclosure" />
              )}
              {renderBook(book)}
              <button
                type="button"
                className="icon-button notebook-row-action notebook-new-note"
                aria-label={`New note in ${book.name}`}
                title={`New note in ${book.name}`}
                disabled={disabled}
                onClick={() => createNote(book)}
              >
                <SquarePen size={16} aria-hidden="true" />
              </button>
              <Dropdown.Root
                open={!usesNativeContextMenu() && openBookId === book.id}
                onOpenChange={(open) => {
                  if (!usesNativeContextMenu()) {
                    setOpenBookId(open ? book.id : null)
                    return
                  }
                  if (!open) return
                  const launcher = document.querySelector<HTMLElement>(
                    `[data-notebook-id="${CSS.escape(book.id)}"]`,
                  )
                  if (launcher) {
                    const rect = launcher.getBoundingClientRect()
                    openMenu(book, launcher, { x: rect.left, y: rect.bottom })
                  }
                }}
              >
                <Dropdown.Trigger
                  className="icon-button notebook-row-action notebook-options"
                  aria-label={`Actions for ${book.name}`}
                  data-notebook-id={book.id}
                  disabled={disabled}
                >
                  <MoreHorizontal size={16} />
                </Dropdown.Trigger>
                <Dropdown.Portal>
                  <Dropdown.Content
                    className="workspace-action-menu"
                    data-theme={dark ? 'dark' : 'light'}
                    data-palette={palette}
                    sideOffset={4}
                  >
                    <Dropdown.Item disabled={disabled} onSelect={() => createNote(book)}>
                      <MenuActionContent icon={FilePlus2} label="New note" />
                    </Dropdown.Item>
                    <Dropdown.Item disabled={disabled} onSelect={() => edit(book)}>
                      <MenuActionContent icon={Pencil} label="Edit" />
                    </Dropdown.Item>
                    <Dropdown.Item disabled={disabled} onSelect={() => createChild(book)}>
                      <MenuActionContent icon={FolderPlus} label="New sub-notebook" />
                    </Dropdown.Item>
                    {book.rootId && (
                      <>
                        <Dropdown.Item disabled={disabled} onSelect={() => refresh(book.rootId!)}>
                          <MenuActionContent icon={RefreshCw} label="Refresh folder" />
                        </Dropdown.Item>
                        {book.relativePath === '' && convert && (
                          <Dropdown.Item disabled={disabled} onSelect={() => convert(book)}>
                            <MenuActionContent icon={Unlink2} label="Convert to Stash notebook…" />
                          </Dropdown.Item>
                        )}
                        <Dropdown.Item disabled={disabled} onSelect={() => reselect(book.rootId!)}>
                          <MenuActionContent icon={FolderOpen} label="Locate linked folder…" />
                        </Dropdown.Item>
                      </>
                    )}
                    <Dropdown.Separator />
                    <Dropdown.Item
                      disabled={disabled || (deleteDisabled?.(book) ?? !!book.rootId)}
                      title={
                        disabled || (deleteDisabled?.(book) ?? !!book.rootId)
                          ? (deleteDisabledReason?.(book) ??
                            'Folder-linked notebooks cannot be deleted.')
                          : undefined
                      }
                      onSelect={() => deleteNotebook(book)}
                    >
                      <MenuActionContent icon={Trash2} label="Delete notebook" />
                    </Dropdown.Item>
                    {(deleteDisabled?.(book) ?? !!book.rootId) && !disabled && (
                      <Dropdown.Label className="notebook-menu-hint">
                        {deleteDisabledReason?.(book) ??
                          'Folder-linked notebooks cannot be deleted.'}
                      </Dropdown.Label>
                    )}
                  </Dropdown.Content>
                </Dropdown.Portal>
              </Dropdown.Root>
            </div>
            {children && expanded && branch(book.id, depth + 1)}
          </div>
        )
      })
  return <nav aria-label="Notebooks">{branch(null)}</nav>
}
