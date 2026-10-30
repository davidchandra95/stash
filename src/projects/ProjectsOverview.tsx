import { useState, type CSSProperties } from 'react'
import { useApp, useBlocked } from '../app/context'
import { ArrowDown, ArrowUp, Briefcase, Plus } from '../icons'
import ProjectRing from './ProjectRing'
import ProjectsTimeline from './ProjectsTimeline'
import {
  formatRange,
  healthLabel,
  isOpenProject,
  projectStatusLabel,
  sortSummaries,
  summarize,
  today,
  type OverviewSort,
} from './model'

const columns: { key: OverviewSort; label: string; className: string }[] = [
  { key: 'name', label: 'Project', className: 'is-name' },
  { key: 'status', label: 'Status', className: 'is-status' },
  { key: 'end', label: 'Dates', className: 'is-dates' },
  { key: 'progress', label: 'Progress', className: 'is-progress' },
  { key: 'health', label: 'Health', className: 'is-health' },
  { key: 'open', label: 'Open tasks', className: 'is-open' },
]

/** Every project with its status, dates, progress and health, for tracking at a glance. */
export default function ProjectsOverview() {
  const app = useApp()
  const blocked = useBlocked()
  const [showAll, setShowAll] = useState(false)
  const [layout, setLayout] = useState<'table' | 'timeline'>('table')
  const [sort, setSort] = useState<{ key: OverviewSort; descending: boolean }>({
    key: 'health',
    descending: false,
  })
  const current = today()
  const all = summarize(app.projects.projects, app.projects.tasks, current)
  const shown = showAll ? all : all.filter((row) => isOpenProject(row.project))
  const rows = sortSummaries(shown, sort.key, sort.descending)
  const attention = all.filter((row) => row.health === 'at_risk' || row.health === 'overdue')

  const header = (column: (typeof columns)[number]) => {
    const active = sort.key === column.key
    return (
      <th
        key={column.key}
        className={column.className}
        scope="col"
        aria-sort={active ? (sort.descending ? 'descending' : 'ascending') : undefined}
      >
        <button
          className="overview-sort"
          onClick={() =>
            setSort((old) => ({
              key: column.key,
              descending: old.key === column.key ? !old.descending : false,
            }))
          }
        >
          {column.label}
          {active &&
            (sort.descending ? (
              <ArrowUp aria-hidden="true" />
            ) : (
              <ArrowDown aria-hidden="true" />
            ))}
        </button>
      </th>
    )
  }

  return (
    <div className="projects-overview">
      <header className="project-header">
        <div className="project-title">
          <Briefcase aria-hidden="true" />
          <h1>Projects</h1>
        </div>
        <p className="project-description">
          {attention.length
            ? `${attention.length} ${attention.length === 1 ? 'project needs' : 'projects need'} attention.`
            : all.some((row) => row.health)
              ? 'Every active project is on track.'
              : 'Status, dates and progress for every project.'}
        </p>
        <div className="project-props">
          <div className="segmented" role="group" aria-label="Overview layout">
            <button aria-pressed={layout === 'table'} onClick={() => setLayout('table')}>
              Table
            </button>
            <button aria-pressed={layout === 'timeline'} onClick={() => setLayout('timeline')}>
              Timeline
            </button>
          </div>
          <div className="segmented" role="group" aria-label="Projects shown">
            <button aria-pressed={!showAll} onClick={() => setShowAll(false)}>
              Active and planned
            </button>
            <button aria-pressed={showAll} onClick={() => setShowAll(true)}>
              All
            </button>
          </div>
        </div>
      </header>
      <div className="task-scroll">
        {rows.length && layout === 'timeline' ? (
          <ProjectsTimeline rows={rows} current={current} />
        ) : rows.length ? (
          <table className="overview-table">
            <thead>
              <tr>{columns.map(header)}</tr>
            </thead>
            <tbody>
              {rows.map(({ project, progress, health, open, overdue }) => (
                <tr
                  key={project.id}
                  tabIndex={0}
                  onClick={() => app.openProject(project.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') app.openProject(project.id)
                  }}
                >
                  <th scope="row" className="is-name">
                    <span className="overview-name">
                      <ProjectRing project={project} ratio={progress.ratio} />
                      <span className="truncate">{project.name}</span>
                    </span>
                  </th>
                  <td className="is-status">
                    <span className="overview-status">
                      <span className={`status-dot is-${project.status}`} aria-hidden="true" />
                      {projectStatusLabel(project.status)}
                    </span>
                  </td>
                  <td className="is-dates">
                    {formatRange(project.startDate, project.endDate, current) || (
                      <span className="overview-none">No dates</span>
                    )}
                  </td>
                  <td className="is-progress">
                    {progress.total ? (
                      <span className="overview-progress">
                        <span
                          className="progress-track"
                          aria-hidden="true"
                          style={{ '--done': `${(progress.ratio ?? 0) * 100}%` } as CSSProperties}
                        >
                          <i />
                        </span>
                        {progress.done}/{progress.total}
                      </span>
                    ) : (
                      <span className="overview-none">No tasks</span>
                    )}
                  </td>
                  <td className="is-health">
                    {health ? (
                      <span className={`project-health is-${health}`}>
                        <span className={`health-dot is-${health}`} aria-hidden="true" />
                        {healthLabel[health]}
                      </span>
                    ) : (
                      <span className="overview-none">—</span>
                    )}
                  </td>
                  <td className="is-open">
                    {open}
                    {overdue > 0 && <span className="overview-overdue"> · {overdue} late</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="task-empty overview-empty">
            <p>{all.length ? 'No active or planned projects.' : 'No projects yet.'}</p>
            <button
              className="btn"
              disabled={blocked}
              onClick={() => app.setProjectEditing('new')}
            >
              <Plus aria-hidden="true" />
              New project
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
