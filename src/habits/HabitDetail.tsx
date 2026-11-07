import { useEffect, useState, type CSSProperties } from 'react'
import AppTooltip from '../components/AppTooltip'
import DateField from '../components/DateField'
import { useApp, useBlocked } from '../app/context'
import { notebookColors } from '../notebookColors'
import { Archive, ArchiveRestore, ChevronLeft, ChevronRight, Trash2, X } from '../icons'
import { addDays, calendarDate } from '../projects/schedule'
import { formatDate, today } from '../projects/model'
import { deleteHabit, setHabitArchived, updateHabit } from './actions'
import { FrequencyEditor, HabitDay, formatDay, habitColor } from './HabitParts'
import {
  checkinId,
  formatStreak,
  habitNotes,
  habitStats,
  isDue,
  maxHabitName,
  weekdayLabel,
  weekStart,
  type Habit,
  type HabitCheckin,
} from './model'

const monthFormat = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })

/** The desktop habit inspector: a pane bar with Archive, Delete and Close over the habit body. */
export default function HabitDetail({ habit }: { habit: Habit }) {
  const app = useApp()
  const blocked = useBlocked()
  const archived = habit.archivedAt !== null
  return (
    <aside className="task-detail habit-detail" aria-label="Habit details" data-pane="task" style={habitColor(habit)}>
      <div className="pane-bar" data-tauri-drag-region>
        <span className="task-detail-label">Habit</span>
        <span className="pane-spacer" data-tauri-drag-region />
        <AppTooltip instant label={archived ? 'Restore habit' : 'Archive habit'} disabled={blocked}>
          <button
            className="icon-btn"
            aria-label={archived ? 'Restore habit' : 'Archive habit'}
            disabled={blocked}
            onClick={() => setHabitArchived(habit, !archived)}
          >
            {archived ? <ArchiveRestore aria-hidden="true" /> : <Archive aria-hidden="true" />}
          </button>
        </AppTooltip>
        <AppTooltip instant label="Delete habit" disabled={blocked}>
          <button
            className="icon-btn"
            aria-label="Delete habit"
            disabled={blocked}
            onClick={() => {
              app.setSelectedHabitId(null)
              deleteHabit(habit, app.setProjectNotice)
            }}
          >
            <Trash2 aria-hidden="true" />
          </button>
        </AppTooltip>
        <AppTooltip instant label="Close" shortcut="Esc">
          <button className="icon-btn" aria-label="Close habit details" onClick={() => app.setSelectedHabitId(null)}>
            <X aria-hidden="true" />
          </button>
        </AppTooltip>
      </div>
      <div
        className="task-detail-body"
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !event.defaultPrevented) app.setSelectedHabitId(null)
        }}
      >
        <HabitBody habit={habit} checkins={app.habits.checkins} disabled={blocked} />
      </div>
      <div className="task-detail-footer">
        Started {formatDate(habit.startDate)}
        {archived && ' · Archived'}
      </div>
    </aside>
  )
}

/**
 * Name, streaks, a month of check-ins, the notes written on them, and settings. Shared by the
 * desktop inspector and the Android habit page.
 */
export function HabitBody({
  habit,
  checkins,
  disabled: blocked,
}: {
  habit: Habit
  checkins: HabitCheckin[]
  disabled: boolean
}) {
  const current = today()
  const [name, setName] = useState(habit.name)
  useEffect(() => setName(habit.name), [habit.name])
  const [month, setMonth] = useState(current.slice(0, 7))
  const stats = habitStats(habit, checkins, current)
  const notes = habitNotes(habit, checkins)
  const byId = new Map(checkins.map((c) => [c.id, c]))
  const archived = habit.archivedAt !== null

  const first = `${month}-01`
  const daysInMonth = calendarDate(first).daysInMonth
  const gridStart = weekStart(first)
  const cells = Array.from({ length: Math.ceil((daysInMonth + calendarDate(first).dayOfWeek - 1) / 7) * 7 }, (_, i) =>
    addDays(gridStart, i),
  )
  const shiftMonth = (delta: number) => setMonth(calendarDate(first).add({ months: delta }).toString().slice(0, 7))

  const commitName = () => {
    const next = name.trim()
    if (!next) setName(habit.name)
    else if (next !== habit.name) updateHabit(habit, { name: next })
  }
  return (
    <>
        <div className="task-detail-title">
          <span className="habit-dot is-large" aria-hidden="true" />
          <input
            className="task-title-input"
            aria-label="Habit name"
            maxLength={maxHabitName}
            disabled={blocked}
            value={name}
            onChange={(event) => setName(event.target.value)}
            onBlur={commitName}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur()
              if (event.key === 'Escape') setName(habit.name)
            }}
          />
        </div>
        <dl className="habit-stats">
          <div>
            <dt>Streak</dt>
            <dd>{formatStreak(stats)}</dd>
          </div>
          <div>
            <dt>Best</dt>
            <dd>{formatStreak({ current: stats.best, unit: stats.unit })}</dd>
          </div>
          <div>
            <dt>Check-ins</dt>
            <dd>{stats.total}</dd>
          </div>
        </dl>
        <div className="task-detail-section">
          <div className="habit-month-header">
            <h3 className="task-detail-heading">{monthFormat.format(new Date(`${first}T00:00:00Z`))}</h3>
            <div className="habit-month-nav">
              <button className="icon-btn icon-btn-sm" aria-label="Previous month" onClick={() => shiftMonth(-1)}>
                <ChevronLeft aria-hidden="true" />
              </button>
              <button
                className="icon-btn icon-btn-sm"
                aria-label="Next month"
                disabled={month >= current.slice(0, 7)}
                onClick={() => shiftMonth(1)}
              >
                <ChevronRight aria-hidden="true" />
              </button>
            </div>
          </div>
          <div className="habit-month" role="group" aria-label="Check-ins this month">
            {[1, 2, 3, 4, 5, 6, 7].map((day) => (
              <span key={day} className="habit-month-weekday" aria-hidden="true">
                {weekdayLabel(day).slice(0, 2)}
              </span>
            ))}
            {cells.map((date) =>
              date.slice(0, 7) === month ? (
                <HabitDay
                  key={date}
                  habit={habit}
                  date={date}
                  label={String(Number(date.slice(8)))}
                  checkin={byId.get(checkinId(habit.id, date))}
                  due={isDue(habit, date)}
                  disabled={blocked || archived}
                />
              ) : (
                <span key={date} aria-hidden="true" />
              ),
            )}
          </div>
        </div>
        <div className="task-detail-section">
          <h3 className="task-detail-heading">
            Notes {notes.length > 0 && <span className="count">{notes.length}</span>}
          </h3>
          {notes.length ? (
            <ol className="habit-notes">
              {notes.map((checkin) => (
                <li key={checkin.id}>
                  <span className="habit-note-date">
                    {formatDay(checkin.date)}
                    {!checkin.done && ' · not done'}
                  </span>
                  <p className="habit-note-text">{checkin.note}</p>
                </li>
              ))}
            </ol>
          ) : (
            <p className="task-mentions-empty">Click a day to check it off and note how it went.</p>
          )}
        </div>
        <div className="task-detail-section">
          <h3 className="task-detail-heading">Repeat</h3>
          <FrequencyEditor
            key={habit.id}
            value={habit.frequency}
            disabled={blocked}
            onChange={(frequency) => updateHabit(habit, { frequency })}
          />
        </div>
        <div className="task-detail-section task-props">
          <label htmlFor="habit-detail-start">Starts</label>
          <DateField
            id="habit-detail-start"
            label="Start date"
            value={habit.startDate}
            clearable={false}
            disabled={blocked}
            onChange={(startDate) => startDate && updateHabit(habit, { startDate })}
          />
          <span className="habit-prop-label">Color</span>
          <div className="notebook-colors">
            {notebookColors.map((preset) => (
              <button
                type="button"
                key={preset.id}
                className="color-swatch"
                style={{ '--swatch': `var(--notebook-${preset.id})` } as CSSProperties}
                aria-label={`Color ${preset.label}`}
                aria-pressed={habit.color.toLowerCase() === preset.light}
                disabled={blocked}
                onClick={() => updateHabit(habit, { color: preset.light })}
              />
            ))}
          </div>
        </div>
    </>
  )
}
