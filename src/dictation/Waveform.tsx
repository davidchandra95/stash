import { useEffect, useRef } from 'react'
import { listen } from '@tauri-apps/api/event'

const BAR = 3
const STEP = 5
const SAMPLE_MS = 100

/** Maps microphone RMS to 0..1 on a decibel scale, so silence stays a row of dots. */
export function loudness(rms: number) {
  const decibels = 20 * Math.log10(Math.max(rms, 1e-5))
  return Math.min(1, Math.max(0, (decibels + 50) / 38))
}

/** Live input level: the newest sample enters on the right and scrolls left. */
export default function Waveform({ sessionId }: { sessionId: string }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const element = canvas.current
    const context = element?.getContext('2d')
    if (!element || !context) return
    const levels: number[] = []
    let sampledAt = 0
    let frame = 0
    let color = ''
    const draw = () => {
      const { width, height } = element.getBoundingClientRect()
      const scale = window.devicePixelRatio || 1
      const pixelWidth = Math.round(width * scale)
      const pixelHeight = Math.round(height * scale)
      if (element.width !== pixelWidth || element.height !== pixelHeight) {
        element.width = pixelWidth
        element.height = pixelHeight
      }
      context.setTransform(scale, 0, 0, scale, 0, 0)
      context.clearRect(0, 0, width, height)
      context.lineCap = 'round'
      context.lineWidth = BAR
      context.strokeStyle = color
      const still = document.documentElement.dataset.motion === 'off'
      const age = still ? 1 : Math.min(1, (performance.now() - sampledAt) / SAMPLE_MS)
      const slots = Math.ceil(width / STEP) + 1
      for (let slot = 0; slot < slots; slot++) {
        const level = levels[levels.length - 1 - slot] ?? 0
        const x = width - BAR / 2 - slot * STEP + (1 - age) * STEP
        const reach = Math.max(0.01, (level * (height - BAR)) / 2)
        context.globalAlpha = 0.45 + 0.55 * level
        context.beginPath()
        context.moveTo(x, height / 2 - reach)
        context.lineTo(x, height / 2 + reach)
        context.stroke()
      }
      frame = requestAnimationFrame(draw)
    }
    color = getComputedStyle(element).color
    frame = requestAnimationFrame(draw)
    const listener = listen<{ sessionId: string; level: number }>('dictation-level', (event) => {
      if (event.payload.sessionId !== sessionId) return
      levels.push(loudness(event.payload.level))
      if (levels.length > 2000) levels.splice(0, 1000)
      sampledAt = performance.now()
      // Picks up a theme change without reading styles on every frame.
      color = getComputedStyle(element).color
    })
    void listener.catch(() => {})
    return () => {
      cancelAnimationFrame(frame)
      void listener.then((off) => off()).catch(() => {})
    }
  }, [sessionId])
  return <canvas ref={canvas} className="dictation-waveform" aria-hidden="true" />
}
