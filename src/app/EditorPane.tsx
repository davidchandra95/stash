import * as Dropdown from '@radix-ui/react-dropdown-menu'
import { lazy, Suspense, useState, type ComponentProps } from 'react'
import { PanelRightClose, PanelRightOpen } from 'lucide-react'
import AppTooltip from '../components/AppTooltip'
import MenuActionContent from '../components/MenuActionContent'
import NativeNoteMenuButton from '../components/NativeNoteMenuButton'
import NoteTabs from '../components/NoteTabs'
import { PdfToolbarButton } from '../pdf/PdfTooltip'
import PdfWorkspace from '../pdf/PdfWorkspace'
import { pdfStore } from '../pdf/store'
import { currentLocation } from '../workspace'
import { usesNativeContextMenu } from '../nativeContextMenu'
import { LiveNoteTools as NoteTools } from '../storage/libraryReaders'
import { library as libraryStore } from '../storage/useLibrary'
import {
  ChevronLeft,
  ChevronRight,
  Ellipsis,
  ListTree,
  Maximize2,
  Minimize2,
  RotateCcw,
  TextSearch,
} from '../icons'
import { useApp, useBlocked } from './context'
import { LeadingControls } from './WindowControls'
import NoteDocument from './NoteDocument'

const PdfReader = lazy(() => import('../pdf/PdfViewer'))
function RetainedPdfReader(props: ComponentProps<typeof PdfReader>) {
  const [visited, setVisited] = useState(false)
  if (props.active && !visited) setVisited(true)
  return visited || props.active ? <PdfReader {...props} /> : null
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
          actions={app.actionsFor(active)}
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
          {app.actionsFor(active).map((action) => (
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
          ))}
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  )
}

/** Focus mode, table of contents, find and the note menu for the open note. */
export function NoteControls() {
  const app = useApp()
  const blocked = useBlocked()
  const { active, focus } = app
  const companionPdf =
    !app.activePdf &&
    active &&
    Object.entries(app.companions).find(([, id]) => id === active.id)?.[0]
  return (
    <div className="note-controls">
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
          ref={app.contentsLauncher}
          className="icon-btn"
          aria-label="Table of contents"
          aria-pressed={app.contentsOpen}
          aria-expanded={app.contentsOpen}
          aria-controls="note-contents"
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
          aria-pressed={app.findOpen}
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

function HistoryButtons() {
  const app = useApp()
  const blocked = useBlocked()
  const { workspace } = app
  return (
    <div className="history-buttons">
      <AppTooltip
        instant
        label="Back"
        shortcut={app.shortcutFor('back')}
        disabled={blocked || !workspace.canBack}
      >
        <button
          className="icon-btn"
          aria-label="Back to previous note"
          disabled={blocked || !workspace.canBack}
          onClick={() => workspace.move(-1)}
        >
          <ChevronLeft aria-hidden="true" />
        </button>
      </AppTooltip>
      <AppTooltip
        instant
        label="Forward"
        shortcut={app.shortcutFor('forward')}
        disabled={blocked || !workspace.canForward}
      >
        <button
          className="icon-btn"
          aria-label="Forward to next note"
          disabled={blocked || !workspace.canForward}
          onClick={() => workspace.move(1)}
        >
          <ChevronRight aria-hidden="true" />
        </button>
      </AppTooltip>
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
      {workspace.tabs.flatMap((tab) => {
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

export default function EditorPane() {
  const app = useApp()
  const blocked = useBlocked()
  const { workspace, activePdf, selected, active } = app
  return (
    <main className="editor-pane" data-pane="editor">
      <div className="pane-bar editor-bar" data-tauri-drag-region>
        <LeadingControls pane="editor" />
        <HistoryButtons />
        <div className="tab-area" data-tauri-drag-region>
          <NoteTabs
            documents={app.pdfs.documents}
            notes={app.notes}
            disabled={blocked}
            tabs={workspace.tabs.map((tab) => ({
              id: tab.id,
              noteId: tab.entries[tab.index].noteId,
              documentId: tab.entries[tab.index].documentId,
              preview: tab.preview,
              pinned: tab.pinned,
            }))}
            activeTabId={workspace.activeTabId}
            onSelectTab={workspace.select}
            onPinTab={workspace.setPinned}
            onCloseTab={workspace.close}
            onKeepOpenTab={workspace.keepOpen}
            onReorderTab={workspace.reorderTab}
          />
        </div>
        {!activePdf && <NoteControls />}
      </div>
      {app.pdfs.savingError && (
        <div role="alert" className="pane-banner is-error">
          <span>{app.pdfs.savingError}</span>
          <button className="btn btn-sm" onClick={() => void pdfStore.flush().catch(() => {})}>
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
          workspace.tabs.some((tab) => currentLocation(tab).kind === 'pdf') ? (
            <PdfReaders />
          ) : undefined
        }
      >
        {app.linkMessage && (
          <div className="pane-banner" role="alert">
            <span>{app.linkMessage}</span>
            <button className="btn btn-sm" onClick={() => app.setLinkMessage('')}>
              Dismiss
            </button>
          </div>
        )}
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
        <div id="note-find-slot" />
        <div
          ref={app.editorWorkspaceRef}
          className={[
            'editor-workspace',
            app.contentsOpen && active && 'with-contents',
            app.contentsResize.overlay && 'contents-overlay',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <div className="editor-document">
            <NoteDocument />
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
      </PdfWorkspace>
    </main>
  )
}
