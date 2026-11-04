import { useCallback, useMemo, useRef } from 'react'
import { useApp, useBlocked } from '../app/context'
import { taskDetailLimits } from '../contentsWidth'
import { library as libraryStore } from '../storage/useLibrary'
import { useContentsResize } from '../useContentsResize'
import TaskDetail from './TaskDetail'
import type { Task } from './model'

/** The task inspector and the divider on its left edge. */
export default function ResizableTaskDetail({ task }: { task: Task }) {
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
    label: 'Resize task details',
    className: 'pane-resizer task-detail-resizer',
  })
  // Dragging changes this component's state on every move; the form doesn't depend on it.
  const detail = useMemo(() => <TaskDetail task={task} />, [task])
  return (
    <div ref={attach} className="task-detail-slot" style={{ width: resize.visibleWidth }}>
      <div {...resize.dividerProps} />
      {detail}
    </div>
  )
}
