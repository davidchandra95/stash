// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import mermaid from 'mermaid'
import { renderMermaid } from './mermaid'

vi.mock('mermaid', () => ({ default: { initialize: vi.fn(), render: vi.fn() } }))
const render = vi.mocked(mermaid.render)
const initialize = vi.mocked(mermaid.initialize)
const element = document.createElement('div')
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  render.mockResolvedValue({
    svg: '<svg><text>Safe diagram</text></svg>',
    diagramType: 'flowchart-v2',
  })
})
afterEach(() => {
  vi.restoreAllMocks()
  render.mockReset()
  initialize.mockReset()
})

it('keeps SVG labels and styles while removing executable content, links and images', async () => {
  render.mockResolvedValueOnce({
    svg: '<svg><style>text{fill:#333}</style><text onclick="alert(1)">Safe</text><script>alert(1)</script><foreignObject><div>HTML</div></foreignObject><a href="https://example.com"><text>Link</text></a><image href="https://example.com/image.png" /></svg>',
    diagramType: 'flowchart-v2',
  })
  const output = document.createElement('div')
  output.innerHTML = await renderMermaid('graph TD\nA-->B', element)
  expect(output.querySelector('svg text')?.textContent).toBe('Safe')
  expect(output.querySelector('style')?.textContent).toBe('text{fill:#333}')
  expect(output.querySelector('script, foreignObject, a, image, [onclick]')).toBeNull()
  expect(initialize).toHaveBeenCalledWith(
    expect.objectContaining({
      startOnLoad: false,
      securityLevel: 'strict',
      htmlLabels: false,
      secure: expect.arrayContaining(['securityLevel', 'htmlLabels', 'secure']),
    }),
  )
})

it('serializes configuration and rendering for simultaneous editors and uses unique SVG IDs', async () => {
  let finish!: (result: Awaited<ReturnType<typeof mermaid.render>>) => void
  render.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const first = renderMermaid('graph TD\nA-->B', element)
  const second = renderMermaid('graph TD\nB-->C', element)
  await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(1))
  expect(initialize).toHaveBeenCalledTimes(1)
  finish({ svg: '<svg><text>First</text></svg>', diagramType: 'flowchart-v2' })
  await expect(first).resolves.toContain('First')
  await expect(second).resolves.toContain('Safe diagram')
  expect(initialize).toHaveBeenCalledTimes(2)
  expect(render.mock.calls[0][0]).not.toBe(render.mock.calls[1][0])
})

it('renders the next diagram even when the previous diagram failed', async () => {
  render.mockRejectedValueOnce(Error('Invalid syntax'))
  const failed = renderMermaid('invalid', element)
  const next = renderMermaid('graph TD\nA-->B', element)
  await expect(failed).rejects.toThrow('Invalid syntax')
  await expect(next).resolves.toContain('Safe diagram')
})
