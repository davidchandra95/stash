import type { CSSProperties } from 'react'
import AppTooltip from '../components/AppTooltip'
import { useApp } from '../app/context'
import { notebookColorValue } from '../notebookColors'
import ProjectRing from './ProjectRing'
import {
  formatRange,
  healthLabel,
  timelinePosition,
  timelineRange,
  type ProjectSummary,
} from './model'

const monthLabel = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' })
const yearLabel = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
})
const pct = (value: number) => `${value * 100}%`

/** Projects as bars from start to end date, with today marked. */
export default function ProjectsTimeline({
  rows,
  current,
}: {
  rows: ProjectSummary[]
  current: string
}) {
  const app = useApp()
  const dated = rows.filter((row) => row.project.startDate || row.project.endDate)
  const undated = rows.filter((row) => !row.project.startDate && !row.project.endDate)
  const range = timelineRange(
    dated.map((row) => row.project),
    current,
  )
  const todayAt = range ? timelinePosition(range, current) : 0

  return (
    <div className="timeline">
      {range && (
        <div className="timeline-grid" role="list" aria-label="Project timeline">
          <div className="timeline-row timeline-header" aria-hidden="true">
            <span className="timeline-label" />
            <span className="timeline-track">
              {range.months.map((month, index) => (
                <span
                  key={month}
                  className="timeline-month"
                  style={{ left: pct(timelinePosition(range, month)) }}
                >
                  {index === 0 || month.endsWith('-01-01')
                    ? yearLabel.format(new Date(`${month}T00:00:00Z`))
                    : monthLabel.format(new Date(`${month}T00:00:00Z`))}
                </span>
              ))}
            </span>
          </div>
          <div className="timeline-body">
            <span className="timeline-overlay" aria-hidden="true">
              {range.months.map((month) => (
                <span
                  key={month}
                  className="timeline-gridline"
                  style={{ left: pct(timelinePosition(range, month)) }}
                />
              ))}
              <span className="timeline-today" style={{ left: pct(todayAt) }} />
            </span>
            {dated.map(({ project, progress, health }) => {
              const start = project.startDate ?? project.endDate!
              const end = project.endDate ?? project.startDate!
              const left = timelinePosition(range, start)
              // An end date covers that whole day.
              const right = Math.min(
                1,
                timelinePosition(range, end) + 1 / (range.months.length * 30.4),
              )
              const milestone = !project.startDate || !project.endDate
              const label = `${project.name}: ${formatRange(project.startDate, project.endDate, current)}${
                health ? ` · ${healthLabel[health]}` : ''
              }`
              return (
                <div className="timeline-row" role="listitem" key={project.id}>
                  <button className="timeline-label" onClick={() => app.openProject(project.id)}>
                    <ProjectRing project={project} ratio={progress.ratio} />
                    <span className="truncate">{project.name}</span>
                  </button>
                  <span className="timeline-track">
                    <AppTooltip label={label}>
                      <button
                        className={`timeline-bar ${milestone ? 'is-milestone' : ''} ${health ? `is-${health}` : ''}`}
                        aria-label={label}
                        onClick={() => app.openProject(project.id)}
                        style={
                          {
                            '--bar-color': notebookColorValue(project.color),
                            '--done': pct(progress.ratio ?? 0),
                            left: pct(left),
                            width: milestone ? undefined : pct(Math.max(right - left, 0.004)),
                          } as CSSProperties
                        }
                      >
                        {!milestone && <i />}
                      </button>
                    </AppTooltip>
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}
      {undated.length > 0 && (
        <div className="timeline-undated">
          <h3 className="task-detail-heading">No dates</h3>
          {undated.map(({ project, progress }) => (
            <button
              key={project.id}
              className="timeline-label"
              onClick={() => app.openProject(project.id)}
            >
              <ProjectRing project={project} ratio={progress.ratio} />
              <span className="truncate">{project.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
