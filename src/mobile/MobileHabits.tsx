import { addDays } from '../projects/schedule'
import { today } from '../projects/model'
import { Archive, ArchiveRestore, Flame, Trash2 } from '../icons'
import { deleteHabit, setHabitArchived } from '../habits/actions'
import { HabitBody } from '../habits/HabitDetail'
import { HabitDay, habitColor } from '../habits/HabitParts'
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
} from '../habits/model'

type Notify = (notice: { message: string; undo?: () => void }) => void

/** Android's Habits page: each habit with its last seven days, checked off by tapping. */
export function MobileHabitList({
  habits,
  checkins,
  disabled,
  onOpen,
}: {
  habits: Habit[]
  checkins: HabitCheckin[]
  disabled: boolean
  onOpen: (id: string) => void
}) {
  const current = today()
  const days = Array.from({ length: 7 }, (_, i) => addDays(current, i - 6))
  const byId = new Map(checkins.map((c) => [c.id, c]))
  const live = liveHabits(habits)
  const active = live.filter((h) => h.archivedAt === null)
  const archived = live.filter((h) => h.archivedAt !== null)
  const card = (habit: Habit) => {
    const stats = habitStats(habit, checkins, current)
    return (
      <li key={habit.id} className="mobile-habit" style={habitColor(habit)}>
        <button className="mobile-habit-name" onClick={() => onOpen(habit.id)}>
          <span className="habit-dot" aria-hidden="true" />
          <span className="mobile-habit-title">{habit.name}</span>
          <span className="mobile-habit-meta">
            {formatFrequency(habit.frequency)}
            <span className={`habit-streak${stats.current ? ' is-active' : ''}`} aria-label={`Current streak: ${formatStreak(stats)}`}>
              <Flame aria-hidden="true" />
              {formatStreak(stats)}
            </span>
          </span>
        </button>
        <div className="mobile-habit-days" role="group" aria-label={`${habit.name}, last seven days`}>
          {days.map((date) => (
            <div key={date} className="mobile-habit-day">
              <span aria-hidden="true">{weekdayLabel(weekdayOf(date)).slice(0, 1)}</span>
              <HabitDay
                habit={habit}
                date={date}
                checkin={byId.get(checkinId(habit.id, date))}
                due={isDue(habit, date)}
                disabled={disabled || habit.archivedAt !== null}
              />
            </div>
          ))}
        </div>
      </li>
    )
  }
  return (
    <div className="mobile-project-scroll mobile-habits">
      {!live.length && (
        <p className="mobile-empty">Track something you want to do regularly, and note how each day went.</p>
      )}
      <ul className="mobile-habit-list">{active.map(card)}</ul>
      {archived.length > 0 && (
        <>
          <h3 className="mobile-task-heading">Archived</h3>
          <ul className="mobile-habit-list is-archived">{archived.map(card)}</ul>
        </>
      )}
    </div>
  )
}

/** Android's habit page: the shared habit body with Archive and Delete below. */
export function MobileHabitPage({
  habit,
  checkins,
  disabled,
  notify,
  onDeleted,
}: {
  habit: Habit
  checkins: HabitCheckin[]
  disabled: boolean
  notify: Notify
  onDeleted: () => void
}) {
  const archived = habit.archivedAt !== null
  return (
    <div className="mobile-project-scroll mobile-task-page mobile-habit-page" style={habitColor(habit)}>
      <HabitBody habit={habit} checkins={checkins} disabled={disabled} />
      <div className="mobile-habit-actions">
        <button className="btn" disabled={disabled} onClick={() => setHabitArchived(habit, !archived)}>
          {archived ? <ArchiveRestore aria-hidden="true" /> : <Archive aria-hidden="true" />}
          {archived ? 'Restore habit' : 'Archive habit'}
        </button>
        <button
          className="btn btn-danger"
          disabled={disabled}
          onClick={() => {
            deleteHabit(habit, notify)
            onDeleted()
          }}
        >
          <Trash2 aria-hidden="true" />
          Delete habit
        </button>
      </div>
    </div>
  )
}
