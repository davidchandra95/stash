// A React callback ref measures before the workspace restores saved scrolling.
// This space belongs to the scroll pane, never to the saved note document.
export function observeEditorScrollSpace(pane: HTMLDivElement | null) {
  if (!pane) return
  const measure = () => {
    // A hidden PDF companion pane keeps its last visible scroll room.
    if (!pane.clientHeight) return
    const room = `${pane.clientHeight / 2}px`
    if (pane.style.getPropertyValue('--editor-scroll-room') !== room)
      pane.style.setProperty('--editor-scroll-room', room)
  }
  measure()
  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
  observer?.observe(pane, { box: 'border-box' })
  window.addEventListener('resize', measure)
  return () => {
    observer?.disconnect()
    window.removeEventListener('resize', measure)
  }
}
