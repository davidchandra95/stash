import {
  useEffect,
  useState,
  useSyncExternalStore,
  type HTMLAttributes,
  type ReactNode,
  type Ref,
} from 'react'
import AppTooltip from '../components/AppTooltip'
import {
  CircleAlert,
  CircleCheck,
  Cloud,
  CloudOff,
  NotebookPen,
  RefreshCw,
  Settings,
  SquareCheckBig,
  Trash2,
} from '../icons'
import { today, todayGroups } from '../projects/model'
import { displayZone, subscribeDisplayZone } from '../projects/schedule'
import { libraryProjection } from '../storage/librarySelectors'
import { library as libraryStore, useLibrarySelector } from '../storage/useLibrary'
import { trackApp, useApp, useBlocked } from './context'
import type { Domain } from './useAppController'

const domains: { id: Domain; label: string; icon: ReactNode; shortcut: string }[] = [
  {
    id: 'notes',
    label: 'Notes',
    icon: <NotebookPen aria-hidden="true" />,
    shortcut: 'show-notes',
  },
  {
    id: 'projects',
    label: 'Projects',
    icon: <SquareCheckBig aria-hidden="true" />,
    shortcut: 'show-projects',
  },
]

/** The app-level switch between Notes and Projects. The active area's icon toggles the sidebar. */
function DomainButtons() {
  useSyncExternalStore(subscribeDisplayZone, displayZone)
  const app = useApp()
  const blocked = useBlocked()
  const overdue =
    todayGroups(app.projects.tasks, today()).find((g) => g.id === 'overdue')?.tasks.length ?? 0
  const select = (id: Domain) => {
    if (id === app.domain) return app.toggleSidebar()
    app.switchDomain(id)
    if (!app.sidebar) app.toggleSidebar()
  }
  return (
    <>
      {domains.map((d) => (
        <AppTooltip
          key={d.id}
          instant
          side="right"
          label={d.label}
          shortcut={app.shortcutFor(d.shortcut)}
        >
          <button
            className="rail-btn is-area"
            aria-label={d.label}
            aria-pressed={d.id === app.domain}
            disabled={blocked || (d.id === 'projects' && !app.projects.ready)}
            onClick={() => select(d.id)}
          >
            {d.icon}
            {d.id === 'projects' && overdue > 0 && (
              <span className="rail-badge" role="img" aria-label={`${overdue} overdue tasks`}>
                {overdue}
              </span>
            )}
          </button>
        </AppTooltip>
      ))}
    </>
  )
}

function useNow(interval: number) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), interval)
    return () => window.clearInterval(timer)
  }, [interval])
  return now
}

const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
function since(timestamp: number, now: number) {
  const minutes = Math.round((timestamp - now) / 60_000)
  if (minutes > -1) return 'just now'
  if (minutes > -60) return relative.format(minutes, 'minute')
  const hours = Math.round(minutes / 60)
  if (hours > -24) return relative.format(hours, 'hour')
  return relative.format(Math.round(hours / 24), 'day')
}

function SyncButton() {
  const app = useApp()
  const blocked = useBlocked()
  const now = useNow(30_000)
  const { library } = app
  const { syncError, syncProgress } = useLibrarySelector(
    (state) => ({ syncError: state.syncError, syncProgress: state.syncProgress }),
    (a, b) => a.syncError === b.syncError && a.syncProgress === b.syncProgress,
  )
  const status = library.syncStatus

  let icon: ReactNode = <CloudOff aria-hidden="true" />
  let label = 'Sync is off'
  let tone = ''
  if (library.preview) {
    icon = <Cloud aria-hidden="true" />
    label = 'Browser preview'
  } else if (library.syncing) {
    icon = <RefreshCw aria-hidden="true" className="ui-icon spinner" />
    label = syncProgress || 'Syncing…'
  } else if (syncError) {
    icon = <CircleAlert aria-hidden="true" />
    label = 'Couldn’t sync'
    tone = 'is-error'
  } else if (status?.configured) {
    icon = <CircleCheck aria-hidden="true" />
    tone = 'is-ok'
    label = status.pending
      ? `${status.pending.toLocaleString('en-US')} changes to sync`
      : status.lastSuccess
        ? `Synced ${since(status.lastSuccess, now)}`
        : 'Not synced yet'
  }

  return (
    <AppTooltip
      instant
      side="right"
      label={library.preview ? 'Browser previews do not sync' : label}
    >
      <button
        className={`rail-btn rail-sync ${tone}`}
        aria-label={label}
        disabled={library.preview || blocked}
        onClick={app.syncNow}
      >
        {icon}
      </button>
    </AppTooltip>
  )
}

/** The far-left strip: areas at the top; sync, Trash and Settings at the bottom. */
export default trackApp(function ActivityRail({
  ...presence
}: {
  /** MotionPresence passes its ref, inert and state here; the nav must receive them. */
  ref?: Ref<HTMLElement>
} & HTMLAttributes<HTMLElement>) {
  const app = useApp()
  const blocked = useBlocked()
  const trashCount = libraryProjection.count(libraryStore.getSnapshot(), 'trash')
  return (
    <nav {...presence} className="activity-rail" aria-label="Area" data-tauri-drag-region>
      <DomainButtons />
      <span className="activity-rail-fill" data-tauri-drag-region />
      <SyncButton />
      <AppTooltip instant side="right" label={trashCount ? `Trash (${trashCount})` : 'Trash'}>
        <button
          className="rail-btn"
          aria-label="Trash"
          aria-pressed={!app.projectView && app.view === 'trash'}
          disabled={blocked}
          onClick={() => {
            app.setNoteList(true)
            app.navigate('trash')
          }}
        >
          <Trash2 aria-hidden="true" />
        </button>
      </AppTooltip>
      <AppTooltip instant side="right" label="Settings" shortcut={app.shortcutFor('settings')}>
        <button
          className="rail-btn"
          aria-label="Settings"
          disabled={blocked}
          onClick={() => {
            app.setSettingsCategory('appearance')
            app.setAppearanceOpen(true)
          }}
        >
          <Settings aria-hidden="true" />
        </button>
      </AppTooltip>
    </nav>
  )
})
