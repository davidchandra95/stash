// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { motion, useMotionPreference } from '../motion'
import type { Task } from './model'
import { TaskRowsMotion, useTaskToggle } from './useTaskToggle'

const toggleTask = vi.hoisted(() => vi.fn())
vi.mock('./actions', () => ({ toggleTask }))

let root: ReturnType<typeof createRoot>
let host: HTMLDivElement
let beforeChange: ReturnType<typeof vi.fn<() => void>>
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.useFakeTimers()
  toggleTask.mockClear()
  beforeChange = vi.fn<() => void>()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(() => root.unmount())
  host.remove()
  vi.useRealTimers()
})

const task = (status: Task['status']) => ({ id: 't1', title: 'Water', status }) as Task

function Check({ task, animations }: { task: Task; animations: boolean }) {
  useMotionPreference(animations)
  const { status, ticking, toggle } = useTaskToggle(task)
  return (
    <button data-status={status} data-ticking={ticking} onClick={toggle}>
      check
    </button>
  )
}
const render = (status: Task['status'], animations = true) =>
  act(() =>
    root.render(
      <TaskRowsMotion.Provider value={beforeChange}>
        <Check task={task(status)} animations={animations} />
      </TaskRowsMotion.Provider>,
    ),
  )
const button = () => host.querySelector('button')!
const click = () => act(() => button().click())

it('shows the task as done at once and completes it after the hold', async () => {
  await render('todo')
  await click()
  expect(button().dataset.status).toBe('done')
  expect(button().dataset.ticking).toBe('true')
  expect(toggleTask).not.toHaveBeenCalled()
  await act(() => vi.advanceTimersByTime(motion.tick * 2))
  expect(beforeChange).toHaveBeenCalledOnce()
  expect(toggleTask).toHaveBeenCalledOnce()
  expect(button().dataset.ticking).toBe('false')
})

it('cancels the completion when clicked again during the hold', async () => {
  await render('todo')
  await click()
  await click()
  expect(button().dataset.status).toBe('todo')
  await act(() => vi.advanceTimersByTime(motion.tick * 4))
  expect(toggleTask).not.toHaveBeenCalled()
})

it('still completes the task when the row unmounts during the hold', async () => {
  await render('todo')
  await click()
  await act(() => root.render(null))
  expect(toggleTask).toHaveBeenCalledOnce()
})

it('reopens at once, and completes at once with animations off', async () => {
  await render('done')
  await click()
  expect(toggleTask).toHaveBeenCalledOnce()
  await render('todo', false)
  await click()
  expect(toggleTask).toHaveBeenCalledTimes(2)
})
