import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { motion, motionEnabled } from '../motion'
import { toggleTask } from './actions'
import type { Task } from './model'

/** A task list provides this so its rows slide when a checkbox commits a change. */
export const TaskRowsMotion = createContext<(() => void) | null>(null)

/**
 * Completing a task draws the check, then holds the row in place for a moment before
 * the task moves to Done. A second click during the hold cancels it. Reopening, and
 * any change with motion off, applies at once.
 */
export function useTaskToggle(task: Task) {
  const beforeChange = useContext(TaskRowsMotion)
  const [ticking, setTicking] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  const commit = useRef(() => {})
  commit.current = () => {
    beforeChange?.()
    toggleTask(task)
  }
  // A row that unmounts during the hold still completes its task.
  useEffect(
    () => () => {
      if (timer.current === undefined) return
      window.clearTimeout(timer.current)
      timer.current = undefined
      commit.current()
    },
    [],
  )
  const toggle = () => {
    if (timer.current !== undefined) {
      window.clearTimeout(timer.current)
      timer.current = undefined
      setTicking(false)
      return
    }
    if (task.status === 'done' || !motionEnabled()) return commit.current()
    setTicking(true)
    timer.current = window.setTimeout(() => {
      timer.current = undefined
      setTicking(false)
      commit.current()
    }, motion.tick * 2)
  }
  return { status: ticking ? 'done' : task.status, ticking, toggle }
}
