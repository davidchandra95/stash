// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it } from 'vitest'
import { library, useLibrarySelector } from './useLibrary'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const host = document.createElement('div')
const root = createRoot(host)
const original = library.getSnapshot()
afterEach(async () => {
  await act(async () => root.render(null))
  Object.assign(library as unknown as { state: typeof original }, { state: original })
})

it('keeps note readers quiet during save feedback and still updates status readers', async () => {
  let noteRenders = 0
  let statusRenders = 0
  function Notes() {
    const notes = useLibrarySelector((state) => state.notes)
    noteRenders++
    return <span>{notes.length}</span>
  }
  function Status() {
    const status = useLibrarySelector((state) => state.status)
    statusRenders++
    return <output>{status}</output>
  }
  await act(async () =>
    root.render(
      <>
        <Notes />
        <Status />
      </>,
    ),
  )
  const initialNotes = noteRenders
  const initialStatus = statusRenders
  const publish = (library as unknown as { publish: (patch: object) => void }).publish.bind(library)
  await act(async () => publish({ status: 'saving' }))
  await act(async () => publish({ status: 'saving' }))
  await act(async () => publish({ status: 'saved' }))
  expect(noteRenders).toBe(initialNotes)
  expect(statusRenders).toBe(initialStatus + 2)
  expect(host.querySelector('output')?.textContent).toBe('saved')
})

it('supports inline selectors with equality without a fresh-snapshot render loop', async () => {
  let renders = 0
  function Reader({ suffix }: { suffix: string }) {
    const value = useLibrarySelector(
      (state) => ({ path: state.path + suffix }),
      (a, b) => a.path === b.path,
    )
    renders++
    return <output>{value.path}</output>
  }
  await act(async () => root.render(<Reader suffix="one" />))
  const before = renders
  const publish = (library as unknown as { publish: (patch: object) => void }).publish.bind(library)
  await act(async () => publish({ status: 'saving' }))
  expect(renders).toBe(before)
  await act(async () => root.render(<Reader suffix="two" />))
  expect(host.textContent).toBe(original.path + 'two')
})
