import { useCallback, useMemo, useRef, type ReactNode } from 'react'
import { useApp, useBlocked } from '../app/context'
import { taskDetailLimits } from '../contentsWidth'
import { library as libraryStore } from '../storage/useLibrary'
import { useContentsResize } from '../useContentsResize'
import TaskDetail from './TaskDetail'
import type { Task } from './model'

/**
 * An inspector beside a Projects page, with the divider on its left edge. Task and habit
 * inspectors share the saved width and always leave the main view its minimum width.
 */
export function ResizableDetail({ label, children }: { label: string; children: ReactNode }) {
  const { library } = useApp()
  const paneRef = useRef<HTMLElement | null>(null)
  // The slot's ref attaches before this component's effects, unlike a ref owned by the pane.
  const attach = useCallback((slot: HTMLDivElement | null) => {
    paneRef.current = slot?.parentElement ?? null
  }, [])
  const resize = useContentsResize({
    workspaceRef: paneRef,
    savedWidth: library.workspace?.taskDetailWidth,
    disabled: useBlocked(),
    onCommit: libraryStore.setTaskDetailWidth,
    limits: taskDetailLimits,
    label,
    className: 'pane-resizer task-detail-resizer',
  })
  return (
    <div ref={attach} className="task-detail-slot" style={{ width: resize.visibleWidth }}>
      <div {...resize.dividerProps} />
      {children}
    </div>
  )
}

/** The task inspector and the divider on its left edge. */
export default function ResizableTaskDetail({ task }: { task: Task }) {
  // Dragging changes the wrapper's state on every move; the form doesn't depend on it.
  const detail = useMemo(() => <TaskDetail task={task} />, [task])
  return <ResizableDetail label="Resize task details">{detail}</ResizableDetail>
}
