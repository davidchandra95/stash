import AppTooltip from './AppTooltip'
import { useEffect, useState, type ReactNode } from 'react'
import * as Dropdown from '@radix-ui/react-dropdown-menu'
import {
  BookPlus,
  ChevronRight,
  FilePlus2,
  FolderOpen,
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

const folderDeleteReason = 'Folder-linked notebooks cannot be deleted.'

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
  dropTarget,
}: {
  dropTarget?: { id: string; allowed: boolean; hint: string } | null
  books: Notebook[]
  active: string
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

  // Reveal the selected notebook by expanding its ancestors.
  useEffect(() => {
    let book = books.find((b) => `book:${b.id}` === active)
    const ancestors = new Set<string>()
    while (book?.parentId && !ancestors.has(book.parentId)) {
      ancestors.add(book.parentId)
      book = books.find((b) => b.id === book!.parentId)
    }
    setCollapsed((old) => new Set([...old].filter((id) => !ancestors.has(id))))
  }, [active, books])

  // Hovering a dragged note over a collapsed notebook opens it.
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

  const cannotDelete = (book: Notebook) => deleteDisabled?.(book) ?? !!book.rootId
  const deleteReason = (book: Notebook) => deleteDisabledReason?.(book) ?? folderDeleteReason

  const menuActions = (book: Notebook): NoteAction[] => {
    const actions: NoteAction[] = [
      { label: 'New note', icon: FilePlus2, run: () => createNote(book) },
      { label: 'Edit', icon: Pencil, run: () => edit(book) },
      { label: 'New sub-notebook', icon: BookPlus, run: () => createChild(book) },
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
    actions.push({
      label: 'Delete notebook',
      icon: Trash2,
      separator: true,
      disabled: cannotDelete(book),
      run: () => deleteNotebook(book),
    })
    if (cannotDelete(book))
      actions.push({ label: deleteReason(book), icon: Trash2, disabled: true, run: () => {} })
    return actions
  }

  const openNativeMenu = (
    book: Notebook,
    launcher: HTMLElement,
    point: { x: number; y: number },
  ) => {
    if (disabled) return
    setOpenBookId(book.id)
    if (!usesNativeContextMenu()) return
    void showNativeContextMenu(menuActions(book), launcher, point)
      .catch((error) => {
        console.error('Native notebook menu failed', error)
        window.alert('Could not open the context menu. Please try again.')
      })
      .finally(() => setOpenBookId(null))
  }

  const toggle = (id: string, expanded: boolean) =>
    setCollapsed((old) => {
      const next = new Set(old)
      if (expanded) next.add(id)
      else next.delete(id)
      return next
    })

  const branch = (parent: string | null, depth = 0): ReactNode =>
    books
      .filter((b) => (b.parentId ?? null) === parent)
      .map((book) => {
        const children = books.some((b) => b.parentId === book.id)
        const expanded = !collapsed.has(book.id)
        const selected = active === `book:${book.id}`
        const drop = dropTarget?.id === book.id ? dropTarget : null
        return (
          <div key={book.id} role="none">
            <AppTooltip label={drop ? drop.hint : notebookPath(book, books)}>
              <div
                className={[
                  'side-row',
                  'has-actions',
                  selected && 'is-selected',
                  openBookId === book.id && 'menu-open',
                  drop && (drop.allowed ? 'is-drop-target' : 'is-drop-blocked'),
                ]
                  .filter(Boolean)
                  .join(' ')}
                data-notebook-drop-id={book.id}
                style={{ '--depth': depth } as React.CSSProperties}
                onContextMenu={(event) => {
                  event.preventDefault()
                  openNativeMenu(book, event.currentTarget, { x: event.clientX, y: event.clientY })
                }}
              >
                {children ? (
                  <button
                    className="side-disclosure"
                    aria-label={`${expanded ? 'Collapse' : 'Expand'} ${book.name}`}
                    aria-expanded={expanded}
                    onClick={() => toggle(book.id, expanded)}
                  >
                    <ChevronRight size={12} aria-hidden="true" />
                  </button>
                ) : (
                  <span className="side-disclosure" aria-hidden="true" />
                )}
                {renderBook(book)}
                <span className="side-actions">
                  <AppTooltip instant label={`New note in ${book.name}`} disabled={disabled}>
                    <button
                      type="button"
                      className="icon-btn icon-btn-sm"
                      aria-label={`New note in ${book.name}`}
                      disabled={disabled}
                      onClick={() => createNote(book)}
                    >
                      <SquarePen aria-hidden="true" />
                    </button>
                  </AppTooltip>
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
                        openNativeMenu(book, launcher, { x: rect.left, y: rect.bottom })
                      }
                    }}
                  >
                    <Dropdown.Trigger
                      className="icon-btn icon-btn-sm notebook-options"
                      aria-label={`Actions for ${book.name}`}
                      data-notebook-id={book.id}
                      disabled={disabled}
                    >
                      <MoreHorizontal aria-hidden="true" />
                    </Dropdown.Trigger>
                    <Dropdown.Portal>
                      <Dropdown.Content className="menu" sideOffset={4} align="start">
                        {menuActions(book).map((action) =>
                          action.disabled && action.label === deleteReason(book) ? (
                            <Dropdown.Label key={action.label} className="menu-label">
                              {action.label}
                            </Dropdown.Label>
                          ) : (
                            <div key={action.label} role="none">
                              {action.separator && (
                                <Dropdown.Separator className="menu-separator" />
                              )}
                              <Dropdown.Item
                                className="menu-item"
                                disabled={disabled || action.disabled}
                                onSelect={() => action.run()}
                              >
                                <MenuActionContent icon={action.icon} label={action.label} />
                              </Dropdown.Item>
                            </div>
                          ),
                        )}
                      </Dropdown.Content>
                    </Dropdown.Portal>
                  </Dropdown.Root>
                </span>
              </div>
            </AppTooltip>
            {children && expanded && branch(book.id, depth + 1)}
          </div>
        )
      })

  return <nav aria-label="Notebooks">{branch(null)}</nav>
}
