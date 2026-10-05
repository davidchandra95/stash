import {
  cloneElement,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type HTMLAttributes,
  type ReactElement,
  type Ref,
  type RefObject,
} from 'react'

export const motion = {
  sidebar: 220,
  focus: 260,
  search: 160,
  menu: 120,
  dialog: 180,
  contents: 200,
  control: 100,
  row: 180,
  find: 140,
  collapse: 180,
  chip: 120,
  notice: 140,
} as const
export const motionEase = 'cubic-bezier(0.2, 0, 0, 1)'
const listeners = new Set<() => void>()
const running = new Set<Animation>()
let enabled = false
let reduced = false
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
export const motionEnabled = () => enabled
export const useMotionEnabled = () => useSyncExternalStore(subscribe, motionEnabled, () => false)
export const useReducedMotion = () =>
  useSyncExternalStore(
    subscribe,
    () => reduced,
    () => false,
  )

export function useMotionPreference(preference: boolean) {
  useLayoutEffect(() => {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    const update = () => {
      reduced = media?.matches ?? false
      enabled = preference && !reduced
      document.documentElement.dataset.motion = enabled ? 'on' : 'off'
      for (const [name, duration] of Object.entries(motion))
        document.documentElement.style.setProperty(`--motion-${name}`, `${duration}ms`)
      if (!enabled) for (const animation of [...running]) animation.cancel()
      listeners.forEach((listener) => listener())
    }
    update()
    media?.addEventListener('change', update)
    return () => {
      media?.removeEventListener('change', update)
    }
  }, [preference])
  return useMotionEnabled()
}

export function animate(
  element: HTMLElement,
  frames: Keyframe[],
  duration: number,
  finish?: () => void,
) {
  if (!enabled || !element.animate) {
    finish?.()
    return undefined
  }
  const animation = element.animate(frames, { duration, easing: motionEase })
  running.add(animation)
  let settled = false
  const settle = () => {
    if (settled) return
    settled = true
    running.delete(animation)
    finish?.()
  }
  animation.finished.then(settle, settle)
  return animation
}

/** Retain only presentation during exit; closed controls are immediately inert. */
export function MotionPresence({
  open,
  children,
  duration = motion.notice,
  collapse = false,
  initial = true,
}: {
  open: boolean
  children: ReactElement<HTMLAttributes<HTMLElement> & { ref?: Ref<HTMLElement> }>
  duration?: number
  collapse?: boolean
  initial?: boolean
}) {
  const active = useMotionEnabled()
  const [present, setPresent] = useState(open)
  const node = useRef<HTMLElement | null>(null)
  const childRef = children.props.ref
  const attach = useCallback(
    (element: HTMLElement | null) => {
      node.current = element
      if (typeof childRef === 'function') {
        const cleanup = childRef(element)
        if (cleanup)
          return () => {
            node.current = null
            cleanup()
          }
      } else if (childRef) childRef.current = element
    },
    [childRef],
  )
  const last = useRef(children)
  if (open) last.current = children
  const first = useRef(true)
  const animation = useRef<Animation | undefined>(undefined)
  const generation = useRef(0)
  useLayoutEffect(() => {
    const element = node.current
    const version = ++generation.current
    const height = element?.getBoundingClientRect().height ?? 0
    const opacity = element ? getComputedStyle(element).opacity : '1'
    animation.current?.cancel()
    animation.current = undefined
    const entering = first.current || !present
    const skip = first.current && !initial
    first.current = false
    if (!element || !active || skip) {
      setPresent(open)
      return
    }
    if (open) setPresent(true)
    const from: Keyframe = { opacity: open ? (entering ? 0 : opacity) : opacity }
    const to: Keyframe = { opacity: open ? 1 : 0 }
    if (collapse) {
      from.height = open && entering ? '0px' : `${height}px`
      from.minHeight = to.minHeight = '0px'
      if (open && entering)
        from.paddingTop = from.paddingBottom = from.marginTop = from.marginBottom = '0px'
      to.height = open ? `${element.scrollHeight}px` : '0px'
      from.overflow = to.overflow = 'clip'
      if (!open) {
        to.paddingTop = to.paddingBottom = to.marginTop = to.marginBottom = '0px'
        to.minHeight = '0px'
      }
    }
    animation.current = animate(element, [from, to], open ? duration : duration * 0.75, () => {
      if (version === generation.current) setPresent(open)
    })
  }, [open, active, duration, collapse, initial])
  useLayoutEffect(
    () => () => {
      ++generation.current
      animation.current?.cancel()
    },
    [],
  )
  if (!open && (!present || !active)) return null
  return cloneElement(open ? children : last.current, {
    ref: attach,
    inert: !open || children.props.inert,
    'aria-hidden': !open ? true : children.props['aria-hidden'],
    'data-motion-presence': open ? 'open' : 'closed',
    style: collapse ? { ...children.props.style, overflow: 'clip' } : children.props.style,
  } as HTMLAttributes<HTMLElement> & { ref: Ref<HTMLElement> })
}

type Snapshot = {
  rect: { left: number; top: number; width: number; height: number }
  clone: HTMLElement
}
function itemSnapshots(parent: HTMLElement, selector: string) {
  const bounds = parent.getBoundingClientRect()
  return new Map(
    [...parent.querySelectorAll<HTMLElement>(selector)].map((element) => {
      const rect = element.getBoundingClientRect()
      return [
        element.dataset.motionKey!,
        {
          rect: {
            left: rect.left - bounds.left + parent.scrollLeft,
            top: rect.top - bounds.top + parent.scrollTop,
            width: rect.width,
            height: rect.height,
          },
          clone: element.cloneNode(true) as HTMLElement,
        },
      ]
    }),
  )
}
/** Measure explicit actions, not each keystroke. Coordinates remain valid while scrolling. */
export function useAnimatedItems(
  ref: RefObject<HTMLElement | null>,
  selector: string,
  scope: string,
  duration: number,
  automatic = false,
) {
  const previous = useRef(new Map<string, Snapshot>())
  const previousScope = useRef<string | null>(null)
  const requested = useRef(false)
  const animations = useRef<Animation[]>([])
  const ghosts = useRef<HTMLElement[]>([])
  const active = useMotionEnabled()
  const cleanup = () => {
    animations.current.forEach((animation) => animation.cancel())
    ghosts.current.forEach((ghost) => ghost.remove())
    animations.current = []
    ghosts.current = []
  }
  const request = () => {
    requested.current = true
    if (ref.current) previous.current = itemSnapshots(ref.current, selector)
  }
  useLayoutEffect(() => {
    const parent = ref.current
    const keys = [...(parent?.querySelectorAll<HTMLElement>(selector) ?? [])].map(
      (element) => element.dataset.motionKey!,
    )
    const changed = keys.join('\0') !== [...previous.current.keys()].join('\0')
    const sameScope = scope === previousScope.current
    if (!sameScope || !active) cleanup()
    const explicit = requested.current
    requested.current = false
    if (!changed && sameScope) return
    // New rows represent creation/duplication. Search changes are excluded by scope.
    const added = keys.some((key) => !previous.current.has(key))
    const shouldAnimate =
      parent &&
      active &&
      sameScope &&
      (automatic || explicit || (added && previous.current.size > 0))
    cleanup()
    const next = parent ? itemSnapshots(parent, selector) : new Map<string, Snapshot>()
    if (parent && shouldAnimate) {
      parent.querySelectorAll<HTMLElement>(selector).forEach((element) => {
        const before = previous.current.get(element.dataset.motionKey!)
        const after = next.get(element.dataset.motionKey!)!
        const frames: Keyframe[] = before
          ? [
              {
                transform: `translate(${before.rect.left - after.rect.left}px, ${before.rect.top - after.rect.top}px)`,
              },
              { transform: 'translate(0, 0)' },
            ]
          : [{ opacity: 0 }, { opacity: 1 }]
        const animation = animate(element, frames, duration)
        if (animation) animations.current.push(animation)
      })
      previous.current.forEach(({ rect, clone }, key) => {
        if (next.has(key)) return
        clone.removeAttribute('id')
        clone.removeAttribute('data-motion-key')
        clone.removeAttribute('data-note-id')
        clone.querySelectorAll('[id]').forEach((child) => child.removeAttribute('id'))
        clone.setAttribute('inert', '')
        clone.setAttribute('aria-hidden', 'true')
        Object.assign(clone.style, {
          position: 'absolute',
          pointerEvents: 'none',
          left: `${rect.left}px`,
          top: `${rect.top}px`,
          width: `${rect.width}px`,
          height: `${rect.height}px`,
          margin: '0',
          overflow: 'clip',
          minHeight: '0',
        })
        parent.append(clone)
        ghosts.current.push(clone)
        const animation = animate(
          clone,
          [
            { opacity: 1, height: `${rect.height}px` },
            { opacity: 0, height: '0px', paddingTop: '0px', paddingBottom: '0px' },
          ],
          duration,
          () => clone.remove(),
        )
        if (animation) animations.current.push(animation)
      })
    }
    previous.current = next
    previousScope.current = scope
  })
  useLayoutEffect(() => cleanup, [])
  return request
}

/** Editor menus own their DOM and cannot use React presence. */
export function hideMenu(menu: HTMLElement) {
  if (menu.hidden) return
  menu.hidden = true
  if (!enabled) return
  const ghost = menu.cloneNode(true) as HTMLElement
  ghost.hidden = false
  ghost.setAttribute('inert', '')
  ghost.setAttribute('aria-hidden', 'true')
  ghost.removeAttribute('id')
  ghost.querySelectorAll('[id]').forEach((child) => child.removeAttribute('id'))
  ghost.style.pointerEvents = 'none'
  ghost.style.animation = 'none'
  menu.after(ghost)
  animate(
    ghost,
    [{ opacity: 1 }, { opacity: 0, transform: 'translateY(-4px)' }],
    motion.menu * 0.75,
    () => ghost.remove(),
  )
}
