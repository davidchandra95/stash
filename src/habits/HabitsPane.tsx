import { useState } from 'react'
import AppTooltip from '../components/AppTooltip'
import { trackApp, useApp, useBlocked } from '../app/context'
import { ChevronDown, ChevronRight, Flame, Plus, Target } from '../icons'
import { addDays } from '../projects/schedule'
import { today } from '../projects/model'
import HabitDetail from './HabitDetail'
import { ResizableDetail } from '../projects/ResizableTaskDetail'
import { HabitDay, formatDay, habitColor } from './HabitParts'
import {
  checkinId,
  formatFrequency,
  formatStreak,
  habitStats,
  isDue,
  liveHabits,
  weekdayLabel,
  weekdayOf,
  type Habit,
  type HabitCheckin,
} from './model'

/** The Habits page: the last seven days of every habit, with a detail panel for one. */
export default trackApp(function HabitsPane() {
  const app = useApp()
  const blocked = useBlocked()
  const { habits, checkins, ready, error } = app.habits
  const [archivedOpen, setArchivedOpen] = useState(false)
  const current = today()
  const days = Array.from({ length: 7 }, (_, i) => addDays(current, i - 6))
  const byId = new Map(checkins.map((c) => [c.id, c]))
  const live = liveHabits(habits)
  const active = live.filter((h) => h.archivedAt === null)
  const archived = live.filter((h) => h.archivedAt !== null)
  const selected = live.find((h) => h.id === app.selectedHabitId)
  const dueToday = active.filter((h) => h.frequency.kind !== 'weekly' && isDue(h, current))
  const doneToday = dueToday.filter((h) => byId.get(checkinId(h.id, current))?.done).length

  const row = (habit: Habit) => (
    <HabitRow
      key={habit.id}
      habit={habit}
      days={days}
      checkins={checkins}
      byId={byId}
      selected={habit.id === selected?.id}
      disabled={blocked}
      onSelect={() => app.setSelectedHabitId(habit.id === selected?.id ? null : habit.id)}
    />
  )
  return (
    <section className={`project-pane ${selected ? 'has-detail' : ''}`} aria-label="Habits" data-pane="project">
      <div className="project-main">
        <header className="project-header">
          <div className="project-title">
            <Target aria-hidden="true" />
            <h1>Habits</h1>
            <div className="project-actions">
              <AppTooltip instant label="New habit">
                <button
                  className="icon-btn"
                  aria-label="New habit"
                  disabled={blocked || !ready}
                  onClick={() => app.setHabitEditing('new')}
                >
                  <Plus aria-hidden="true" />
                </button>
              </AppTooltip>
            </div>
          </div>
          <p className="project-description">
            {dueToday.length
              ? `${doneToday} of ${dueToday.length} done today · ${formatDay(current)}`
              : formatDay(current)}
          </p>
        </header>
        <div className="task-scroll habits-scroll">
          {error && (
            <p role="alert" className="field-error">
              {error}
            </p>
          )}
          {ready && !live.length && (
            <div className="habits-empty">
              <p>Track something you want to do regularly, and note how each day went.</p>
              <button className="btn btn-primary" disabled={blocked} onClick={() => app.setHabitEditing('new')}>
                New habit
              </button>
            </div>
          )}
          {active.length > 0 && (
            <table className="habit-grid">
              <thead>
                <tr>
                  <th scope="col" className="habit-name-col">
                    Habit
                  </th>
                  {days.map((date) => (
                    <th
                      scope="col"
                      key={date}
                      className={`habit-day-col${date === current ? ' is-today' : ''}`}
                      aria-label={formatDay(date)}
                    >
                      <span className="habit-weekday">{weekdayLabel(weekdayOf(date))}</span>
                      <span className="habit-date">{Number(date.slice(8))}</span>
                    </th>
                  ))}
                  <th scope="col" className="habit-streak-col">
                    Streak
                  </th>
                </tr>
              </thead>
              <tbody>{active.map(row)}</tbody>
            </table>
          )}
          {archived.length > 0 && (
            <div className="habits-archived">
              <button
                className="task-group-header"
                aria-expanded={archivedOpen}
                onClick={() => setArchivedOpen((open) => !open)}
              >
                {archivedOpen ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
                Archived
                <span className="count">{archived.length}</span>
              </button>
              {archivedOpen && (
                <table className="habit-grid is-archived">
                  <tbody>{archived.map(row)}</tbody>
                </table>
              )}
            </div>
          )}
        </div>
      </div>
      {selected && (
        <ResizableDetail label="Resize habit details">
          <HabitDetail key={selected.id} habit={selected} />
        </ResizableDetail>
      )}
    </section>
  )
})

function HabitRow({
  habit,
  days,
  checkins,
  byId,
  selected,
  disabled,
  onSelect,
}: {
  habit: Habit
  days: string[]
  checkins: HabitCheckin[]
  byId: Map<string, HabitCheckin>
  selected: boolean
  disabled: boolean
  onSelect: () => void
}) {
  const stats = habitStats(habit, checkins)
  const weekly = habit.frequency.kind === 'weekly' ? habit.frequency.times : 0
  return (
    <tr className={`habit-row${selected ? ' is-selected' : ''}`}>
      <th scope="row" className="habit-name-col">
        <button className="habit-name" style={habitColor(habit)} aria-pressed={selected} onClick={onSelect}>
          <span className="habit-dot" aria-hidden="true" />
          <span className="habit-title">{habit.name}</span>
          <span className="habit-frequency-label">
            {weekly ? `${stats.thisWeek}/${weekly} this week` : formatFrequency(habit.frequency)}
          </span>
        </button>
      </th>
      {days.map((date) => (
        <td key={date} className="habit-day-col">
          <HabitDay
            habit={habit}
            date={date}
            checkin={byId.get(checkinId(habit.id, date))}
            due={isDue(habit, date)}
            disabled={disabled || habit.archivedAt !== null}
          />
        </td>
      ))}
      <td className="habit-streak-col">
        <span
          className={`habit-streak${stats.current ? ' is-active' : ''}`}
          aria-label={`Current streak: ${formatStreak(stats)}`}
        >
          <Flame aria-hidden="true" />
          {stats.current}
          {stats.unit === 'week' ? 'w' : 'd'}
        </span>
      </td>
    </tr>
  )
}
