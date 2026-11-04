import { supported as dictationSupported } from '../dictation/client'
import * as Dropdown from '@radix-ui/react-dropdown-menu'
import {
  lazy,
  Suspense,
  useRef,
  useState,
  type ComponentProps,
  type KeyboardEvent,
  type PointerEvent,
} from 'react'
import { PanelRightClose, PanelRightOpen } from 'lucide-react'
import AppTooltip from '../components/AppTooltip'
import MenuActionContent from '../components/MenuActionContent'
import NativeNoteMenuButton from '../components/NativeNoteMenuButton'
import NoteTabs from '../components/NoteTabs'
import { PdfToolbarButton } from '../pdf/PdfTooltip'
import PdfWorkspace from '../pdf/PdfWorkspace'
import { pdfStore } from '../pdf/store'
import {
  currentLocation,
  defaultPdfNotes,
  type EditorGroupId,
  type SplitSide,
} from '../workspace'
import { SplitEditorContext } from '../components/noteEditorView'
import { tabDropTarget, type GroupArea, type TabDrop } from './tabDropTarget'
import { usesNativeContextMenu } from '../nativeContextMenu'
import { LiveNoteTools as NoteTools } from '../storage/libraryReaders'
import { library as libraryStore } from '../storage/useLibrary'
import {
  Columns2,
  Ellipsis,
  ListTree,
  Maximize2,
  Mic,
  Minimize2,
  RotateCcw,
  TextSearch,
} from '../icons'
import { trackApp, useApp, useBlocked } from './context'
import NoteDocument from './NoteDocument'

const noPdfNotes = defaultPdfNotes()
const minimumGroupWidth = 240

const PdfReader = lazy(() => import('../pdf/PdfViewer'))
function RetainedPdfReader(props: ComponentProps<typeof PdfReader>) {
  const [visited, setVisited] = useState(false)
  if (props.active && !visited) setVisited(true)
  return visited || props.active ? <PdfReader {...props} /> : null
}

/** Rendered only while the menu is open, so actions are not rebuilt on every render. */
function NoteActionItems() {
  const app = useApp()
  const blocked = useBlocked()
  const { active } = app
  if (!active) return null
  return app.actionsFor(active).map((action) => (
    <div key={action.label} role="none">
      {action.separator && <Dropdown.Separator className="menu-separator" />}
      <Dropdown.Item
        className="menu-item"
        disabled={blocked || action.disabled}
        onSelect={(event) => action.run(event.currentTarget as HTMLElement)}
      >
        <MenuActionContent icon={action.icon} label={action.label} />
        {action.shortcutId && app.shortcutFor(action.shortcutId) && (
          <span className="menu-shortcut" aria-hidden="true">
            {app.shortcutFor(action.shortcutId)}
          </span>
        )}
      </Dropdown.Item>
    </div>
  ))
}

function NoteActionsMenu() {
  const app = useApp()
  const blocked = useBlocked()
  const [open, setOpen] = useState(false)
  const { active } = app
  if (!active)
    return (
      <button className="icon-btn" aria-label="Note actions" disabled>
        <Ellipsis aria-hidden="true" />
      </button>
    )
  if (usesNativeContextMenu())
    return (
      <AppTooltip instant label="Note actions" disabled={blocked}>
        <NativeNoteMenuButton
          className="icon-btn"
          actions={() => app.actionsFor(app.active ?? active)}
          disabled={blocked}
          onError={app.setActionError}
        >
          <Ellipsis aria-hidden="true" />
        </NativeNoteMenuButton>
      </AppTooltip>
    )
  return (
    <Dropdown.Root open={open} onOpenChange={setOpen}>
      <AppTooltip instant label="Note actions" disabled={blocked}>
        <Dropdown.Trigger className="icon-btn" aria-label="Note actions" disabled={blocked}>
          <Ellipsis aria-hidden="true" />
        </Dropdown.Trigger>
      </AppTooltip>
      <Dropdown.Portal>
        <Dropdown.Content
          className="menu"
          sideOffset={4}
          align="end"
          collisionPadding={8}
          onCloseAutoFocus={(event) => {
            if (document.querySelector('.notebook-popover')) event.preventDefault()
          }}
        >
          <NoteActionItems />
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  )
}

/** Focus mode, table of contents, find and the note menu for the open note. */
export function NoteControls({ focused = true }: { focused?: boolean }) {
  const app = useApp()
  const blocked = useBlocked()
  const { active, focus } = app
  const companionPdf =
    !app.activePdf &&
    active &&
    Object.entries(app.companions).find(([, id]) => id === active.id)?.[0]
  return (
    <div className="note-controls">
      {dictationSupported() && (
        <AppTooltip instant label="Dictate note" shortcut={app.shortcutFor('dictate-note')}>
          <button
            className="icon-btn"
            aria-label="Dictate note"
            aria-pressed={focused && !!app.dictationTarget}
            disabled={blocked || (!app.canDictate && !app.dictationTarget)}
            onClick={app.startDictation}
          >
            <Mic aria-hidden="true" />
          </button>
        </AppTooltip>
      )}
      {companionPdf && (
        <button
          className="btn btn-plain btn-sm"
          onClick={() => {
            app.workspace.openPdf(companionPdf)
            app.setPdfPreferences({ open: true }, companionPdf)
          }}
        >
          Open PDF
        </button>
      )}
      <AppTooltip
        instant
        label={focus ? 'Exit focus mode' : 'Focus mode'}
        shortcut={app.shortcutFor('focus')}
      >
        <button
          className="icon-btn"
          aria-label={focus ? 'Exit focus mode' : 'Focus mode'}
          aria-pressed={focus}
          onClick={() => app.setFocus((value) => !value)}
        >
          {focus ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}
        </button>
      </AppTooltip>
      <AppTooltip
        instant
        label="Table of contents"
        shortcut={app.shortcutFor('contents')}
        disabled={!active || blocked}
      >
        <button
          ref={focused ? app.contentsLauncher : undefined}
          className="icon-btn"
          aria-label="Table of contents"
          aria-pressed={focused && app.contentsOpen}
          aria-expanded={focused && app.contentsOpen}
          aria-controls={focused ? 'note-contents' : undefined}
          disabled={!active || blocked}
          onClick={(event) => app.toggleContents(event.detail === 0)}
        >
          <ListTree aria-hidden="true" />
        </button>
      </AppTooltip>
      <AppTooltip
        instant
        label="Find in note"
        shortcut={app.shortcutFor('find')}
        disabled={!active || blocked}
      >
        <button
          className="icon-btn"
          aria-label="Find in note"
          aria-pressed={focused && app.findOpen}
          disabled={!active || blocked}
          onClick={() => app.setFindOpen((value) => !value)}
        >
          <TextSearch aria-hidden="true" />
        </button>
      </AppTooltip>
      <NoteActionsMenu />
    </div>
  )
}

function PdfReaders() {
  const app = useApp()
  const blocked = useBlocked()
  const { workspace, pdfs, activePdf, focus, notesOpen, companion } = app
  return (
    <Suspense
      fallback={
        <p role="status" className="pane-message">
          Loading PDF viewer…
        </p>
      }
    >
      {workspace.groups.main.tabs.flatMap((tab) => {
        const location = currentLocation(tab)
        const doc =
          location.kind === 'pdf'
            ? pdfs.documents.find((item) => item.id === location.documentId)
            : undefined
        if (!doc) return []
        const active = doc.id === activePdf?.id
        return (
          <div key={doc.id} className="pdf-session" hidden={!active}>
            <RetainedPdfReader
              active={active}
              source={pdfStore.source(doc)}
              reading={doc.reading}
              target={app.pdfNavigation?.documentId === doc.id ? app.pdfNavigation : undefined}
              onReading={(reading) => pdfStore.reading(doc.id, reading)}
              registerCapture={pdfStore.capture}
              contentsWidth={app.library.workspace?.contentsWidth}
              onContentsWidth={libraryStore.setContentsWidth}
              disabled={blocked}
              captureDisabled={app.captureBusy}
              onCapture={active ? app.capturePdf : undefined}
              toolbarActions={
                active ? (
                  <PdfToolbarButton
                    className="icon-btn"
                    aria-label={focus ? 'Exit focus mode' : 'Focus mode'}
                    title={focus ? 'Exit focus mode' : 'Focus mode'}
                    shortcut={app.shortcutFor('focus')}
                    aria-pressed={focus}
                    onClick={() => app.setFocus((value) => !value)}
                  >
                    {focus ? <Minimize2 /> : <Maximize2 />}
                  </PdfToolbarButton>
                ) : undefined
              }
              notesAction={
                active ? (
                  <PdfToolbarButton
                    className="icon-btn"
                    aria-label={app.pdfNotesLabel}
                    title={app.pdfNotesLabel}
                    aria-expanded={notesOpen}
                    disabled={app.captureBusy || blocked}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => void app.takeNotes()}
                  >
                    {companion?.trashed ? (
                      <RotateCcw />
                    ) : notesOpen ? (
                      <PanelRightClose className="ui-icon" />
                    ) : (
                      <PanelRightOpen className="ui-icon" />
                    )}
                  </PdfToolbarButton>
                ) : undefined
              }
            />
          </div>
        )
      })}
    </Suspense>
  )
}

/** Where a group's button or menu sends a tab: the side the other group is on. */
function splitDirections(
  group: EditorGroupId,
  split: boolean,
  splitSide: SplitSide,
): SplitSide[] {
  if (!split) return ['right', 'left']
  if (group === 'split') return [splitSide === 'left' ? 'right' : 'left']
  return [splitSide]
}

/** Finds where a tab dragged out of its strip would land, and draws its ghost. */
function useTabSplitDrag() {
  const app = useApp()
  const [drop, setDrop] = useState<TabDrop | null>(null)
  const ghost = useRef<HTMLDivElement | null>(null)
  const pointer = useRef({ x: 0, y: 0 })
  const placeGhost = () => {
    if (ghost.current)
      ghost.current.style.transform = `translate(${pointer.current.x + 12}px, ${pointer.current.y + 12}px)`
  }
  const [ghostTitle, setGhostTitle] = useState<string | null>(null)
  const targetAt = (id: string, x: number, y: number) => {
    const { groups, splitOpen } = app.workspace
    const source = groups.main.tabs.some((tab) => tab.id === id) ? 'main' : 'split'
    const tab = groups[source]?.tabs.find((tab) => tab.id === id)
    if (!tab || currentLocation(tab).kind === 'pdf' || (groups.split && !splitOpen)) return null
    const areas = [...document.querySelectorAll<HTMLElement>('.editor-group[data-group]')].map(
      (element): GroupArea => {
        const { left, right, top, bottom } = element.getBoundingClientRect()
        const bar = element.querySelector('.editor-bar')?.getBoundingClientRect().bottom ?? top
        return { group: element.dataset.group as EditorGroupId, left, right, top, bottom, documentTop: bar }
      },
    )
    return tabDropTarget(x, y, source, areas)
  }
  const insertionIndex = (group: EditorGroupId, x: number) => {
    const tabs = document.querySelectorAll<HTMLElement>(
      `.editor-group[data-group="${group}"] [data-tab-id]`,
    )
    return [...tabs].filter((tab) => {
      const { left, width } = tab.getBoundingClientRect()
      return x > left + width / 2
    }).length
  }
  return {
    drop,
    attachGhost: (element: HTMLDivElement | null) => {
      ghost.current = element
      placeGhost()
    },
    ghostTitle,
    outside: {
      over: (id: string, x: number, y: number) => {
        const next = targetAt(id, x, y)
        setDrop((old) =>
          old?.group === next?.group && old?.side === next?.side && old?.inStrip === next?.inStrip
            ? old
            : next,
        )
        const strip = document
          .querySelector(`[data-tab-id="${CSS.escape(id)}"]`)
          ?.closest('.tabs')
          ?.getBoundingClientRect()
        const inStrip =
          !!strip && x >= strip.left && x <= strip.right && y >= strip.top && y <= strip.bottom
        setGhostTitle(
          inStrip
            ? null
            : (document.querySelector(`[data-tab-id="${CSS.escape(id)}"] .tab-title`)?.textContent ??
                ''),
        )
        pointer.current = { x, y }
        placeGhost()
      },
      drop: (id: string, x: number, y: number) => {
        const target = targetAt(id, x, y)
        if (!target) return
        app.workspace.moveTab(id, {
          side: target.side,
          index: target.inStrip ? insertionIndex(target.group, x) : undefined,
        })
      },
      end: () => {
        setDrop(null)
        setGhostTitle(null)
      },
    },
  }
}

function SplitButton({ group, direction }: { group: EditorGroupId; direction: SplitSide }) {
  const app = useApp()
  const blocked = useBlocked()
  const tabId = app.workspace.groups[group]?.activeTabId
  const label = direction === 'left' ? 'Split Left' : 'Split Right'
  return (
    <AppTooltip instant label={label} shortcut={app.shortcutFor('split-note')} disabled={blocked || !tabId}>
      <button
        className="icon-btn"
        aria-label={label}
        disabled={blocked || !tabId}
        onClick={() => {
          if (tabId) app.workspace.splitTab(tabId, direction)
        }}
      >
        <Columns2 aria-hidden="true" />
      </button>
    </AppTooltip>
  )
}

function LinkMessage() {
  const app = useApp()
  if (!app.linkMessage) return null
  return (
    <div className="pane-banner" role="alert">
      <span>{app.linkMessage}</span>
      <button className="btn btn-sm" onClick={() => app.setLinkMessage('')}>
        Dismiss
      </button>
    </div>
  )
}

/** The note and its tools. Find and contents belong to the focused group. */
function GroupDocument({ group, focused }: { group: EditorGroupId; focused: boolean }) {
  const app = useApp()
  const blocked = useBlocked()
  const active = focused ? app.active : undefined
  return (
    <>
      {focused && <div id="note-find-slot" />}
      <div
        ref={focused ? app.editorWorkspaceRef : undefined}
        className={[
          'editor-workspace',
          app.contentsOpen && active && 'with-contents',
          focused && app.contentsResize.overlay && 'contents-overlay',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <div className="editor-document">
          <NoteDocument group={group} />
        </div>
        {active && (
          <NoteTools
            noteId={active.id}
            contentsOpen={app.contentsOpen}
            contentsMode={app.contentsResize.overlay ? 'overlay' : 'docked'}
            onContentsOpenChange={app.setContentsOpen}
            contentsLauncher={app.contentsLauncher}
            focusContentsOnOpen={app.contentsKeyboardOpen.current}
            findOpen={app.findOpen}
            searchNavigation={app.matchNavigation}
            onSearchNavigationComplete={() => app.setMatchNavigation(null)}
            onFindOpenChange={app.setFindOpen}
            disabled={blocked}
            readOnly={
              !!(
                active.trashed ||
                active.source?.unavailable ||
                app.library.conflicts[active.id] ||
                active.source?.trashPath ||
                app.busyNote === active.id
              )
            }
            contentsDividerProps={app.contentsResize.dividerProps}
          />
        )}
      </div>
    </>
  )
}

function EditorGroup({
  group,
  outside,
  drop,
}: {
  group: EditorGroupId
  outside: ComponentProps<typeof NoteTabs>['dragOutside']
  drop: TabDrop | null
}) {
  const app = useApp()
  const blocked = useBlocked()
  const { workspace, activePdf, selected } = app
  const { groups } = workspace
  const state = groups[group]!
  const focused = workspace.focusedGroup === group
  const isSplit = workspace.splitOpen
  const directions = splitDirections(group, isSplit, groups.splitSide)
  const left = !isSplit || (group === 'split') === (groups.splitSide === 'left')
  return (
    <SplitEditorContext.Provider value={group === 'split'}>
      <div
        className={`editor-group${focused ? ' is-focused' : ''}`}
        data-group={group}
        style={
          isSplit
            ? {
                flexGrow: left ? groups.ratio : 1 - groups.ratio,
                order: left ? 0 : 2,
              }
            : undefined
        }
        onPointerDownCapture={() => workspace.focusGroup(group)}
        onFocusCapture={() => workspace.focusGroup(group)}
      >
        <div className="pane-bar editor-bar" data-tauri-drag-region>
          <div className="tab-area" data-tauri-drag-region>
            <NoteTabs
              documents={app.pdfs.documents}
              notes={app.notes}
              disabled={blocked}
              tabs={state.tabs.map((tab) => ({
                id: tab.id,
                noteId: tab.entries[tab.index].noteId,
                documentId: tab.entries[tab.index].documentId,
                preview: tab.preview,
                pinned: tab.pinned,
              }))}
              activeTabId={state.activeTabId}
              onSelectTab={workspace.select}
              onPinTab={workspace.setPinned}
              onCloseTab={workspace.close}
              onKeepOpenTab={workspace.keepOpen}
              onReorderTab={workspace.reorderTab}
              splitSides={directions}
              onSplitTab={workspace.splitTab}
              dragOutside={outside}
            />
          </div>
          {!(focused && activePdf) && <SplitButton group={group} direction={directions[0]} />}
          {!(focused && activePdf) && <NoteControls focused={focused} />}
        </div>
        {group === 'main' ? (
          <>
            {app.pdfs.savingError && (
              <div role="alert" className="pane-banner is-error">
                <span>{app.pdfs.savingError}</span>
                <button
                  className="btn btn-sm"
                  onClick={() => void pdfStore.flush().catch(() => {})}
                >
                  Retry
                </button>
              </div>
            )}
            {app.pdfNotesError && (
              <div role="alert" className="pane-banner is-error">
                <span>{app.pdfNotesError}</span>
                <button className="btn btn-sm" onClick={() => app.setPdfNotesError('')}>
                  Dismiss
                </button>
              </div>
            )}
            <PdfWorkspace
              pdfActive={!!activePdf}
              open={app.notesOpen}
              preferences={app.pdfPreferences}
              onPreferences={app.setPdfPreferences}
              onFocus={app.setFocusedPane}
              pdf={
                state.tabs.some((tab) => currentLocation(tab).kind === 'pdf') ? (
                  <PdfReaders />
                ) : undefined
              }
            >
              {focused && <LinkMessage />}
              {activePdf && (
                <header className="companion-bar">
                  <span className="truncate companion-title">
                    {selected
                      ? `${app.notebookLabel(selected)} › ${selected.title || 'Untitled note'}`
                      : ''}
                  </span>
                  <NoteControls />
                </header>
              )}
              <GroupDocument group={group} focused={focused} />
            </PdfWorkspace>
          </>
        ) : (
          <PdfWorkspace
            pdfActive={false}
            open
            preferences={noPdfNotes}
            onPreferences={() => {}}
            onFocus={app.setFocusedPane}
          >
            {focused && <LinkMessage />}
            <GroupDocument group={group} focused={focused} />
          </PdfWorkspace>
        )}
        {drop?.group === group && (
          <div className="editor-drop-zone" data-side={drop.side ?? 'all'} aria-hidden="true" />
        )}
      </div>
    </SplitEditorContext.Provider>
  )
}

function SplitDivider({ ratio, onChange }: { ratio: number; onChange: (ratio: number) => void }) {
  const drag = useRef<{ live: number } | null>(null)
  const [live, setLive] = useState<number | null>(null)
  const bounds = (element: HTMLElement) => {
    const width = element.parentElement!.getBoundingClientRect().width
    const minimum = Math.min(0.5, minimumGroupWidth / Math.max(1, width))
    return { minimum, maximum: 1 - minimum }
  }
  const clamp = (element: HTMLElement, value: number) => {
    const { minimum, maximum } = bounds(element)
    return Math.max(minimum, Math.min(maximum, value))
  }
  const shown = live ?? ratio
  // The groups read their shares from the controller. A drag only saves once, on release.
  const paint = (element: HTMLElement, value: number) => {
    const groups = element.parentElement!
    const [first, second] = [...groups.querySelectorAll<HTMLElement>(':scope > .editor-group')].sort(
      (a, b) => Number(a.style.order) - Number(b.style.order),
    )
    first.style.flexGrow = String(value)
    second.style.flexGrow = String(1 - value)
  }
  return (
    <div
      className="pdf-split-divider editor-split-divider"
      role="separator"
      tabIndex={0}
      aria-label="Resize split notes"
      aria-orientation="vertical"
      aria-valuemin={10}
      aria-valuemax={90}
      aria-valuenow={Math.round(shown * 100)}
      style={{ order: 1 }}
      onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
        const element = event.currentTarget
        const { minimum, maximum } = bounds(element)
        const next =
          event.key === 'ArrowLeft'
            ? ratio - 0.03
            : event.key === 'ArrowRight'
              ? ratio + 0.03
              : event.key === 'Home'
                ? minimum
                : event.key === 'End'
                  ? maximum
                  : null
        if (next === null) return
        event.preventDefault()
        onChange(clamp(element, next))
      }}
      onPointerDown={(event: PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0) return
        drag.current = { live: ratio }
        event.currentTarget.setPointerCapture(event.pointerId)
        event.currentTarget.focus({ preventScroll: true })
        event.preventDefault()
      }}
      onPointerMove={(event: PointerEvent<HTMLDivElement>) => {
        if (!drag.current || !(event.buttons & 1)) return
        const element = event.currentTarget
        const { left, width } = element.parentElement!.getBoundingClientRect()
        const value = clamp(element, (event.clientX - left) / Math.max(1, width))
        drag.current.live = value
        setLive(value)
        paint(element, value)
      }}
      onPointerUp={() => {
        if (drag.current) onChange(drag.current.live)
        drag.current = null
        setLive(null)
      }}
      onLostPointerCapture={() => {
        drag.current = null
        setLive(null)
      }}
    />
  )
}

export default trackApp(function EditorPane() {
  const app = useApp()
  const { workspace } = app
  const { drop, attachGhost, ghostTitle, outside } = useTabSplitDrag()
  return (
    <main className="editor-pane" data-pane="editor">
      <div className="editor-groups">
        <EditorGroup group="main" outside={outside} drop={drop} />
        {workspace.splitOpen && (
          <>
            <SplitDivider ratio={workspace.groups.ratio} onChange={workspace.setSplitRatio} />
            <EditorGroup group="split" outside={outside} drop={drop} />
          </>
        )}
      </div>
      {ghostTitle !== null && (
        <div ref={attachGhost} className="tab tab-drag-ghost note-drag-ghost" aria-hidden="true">
          <span className="tab-title">{ghostTitle}</span>
        </div>
      )}
    </main>
  )
})
