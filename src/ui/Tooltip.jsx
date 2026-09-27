import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * A tooltip that actually turns up.
 *
 * The shape rail is pictures and nothing else — the names live in the flyout,
 * which you have to open. That leaves the rail relying on the browser's own
 * `title`, and a native tooltip waits somewhere north of a second before it
 * shows, sits wherever the platform feels like, and looks like nothing else
 * in the app. Somebody scanning the rail for "the one that makes words" moves
 * on long before it appears, which is exactly the thing the rail is bad at
 * answering.
 *
 * So: 120 ms, beside the thing it describes, in the app's own dark. Long
 * enough not to flicker while the pointer sweeps down the rail, short enough
 * to feel like an answer rather than a wait.
 *
 * **Portalled to the body**, for the same reason `ParamMenu` is: the rail
 * scrolls, and a pop-over drawn inside a scroll container is clipped by it.
 *
 * **Mouse only.** A finger has no hover — the first a touchscreen hears of a
 * pointer is that it is already pressing — and the touch shell puts the names
 * on the buttons anyway.
 */
const DELAY = 120
const GAP = 10

export function useTooltip(side = 'right') {
  const [tip, setTip] = useState(null)
  const timer = useRef(0)

  const hide = useCallback(() => {
    clearTimeout(timer.current)
    setTip(null)
  }, [])

  useEffect(() => hide, [hide])

  // A tooltip that outlived the thing it describes would hang in the corner
  // of the screen with nothing under it.
  useEffect(() => {
    if (!tip) return
    window.addEventListener('scroll', hide, true)
    window.addEventListener('resize', hide)
    window.addEventListener('wheel', hide, { passive: true })
    return () => {
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('resize', hide)
      window.removeEventListener('wheel', hide)
    }
  }, [tip, hide])

  const open = useCallback(
    (event, label, hint) => {
      if (!label) return
      const el = event.currentTarget
      clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        const rect = el.getBoundingClientRect()
        // A button that has gone away between the hover and the timer — the
        // rail re-renders on every placement — has no rectangle worth using.
        if (!rect.width && !rect.height) return
        setTip({ label, hint, rect })
      }, DELAY)
    },
    []
  )

  /** Spread onto whatever the tooltip is for. */
  const bind = useCallback(
    (label, hint) => ({
      onPointerEnter: (e) => e.pointerType === 'mouse' && open(e, label, hint),
      onPointerLeave: hide,
      // Pressing it answers the question; the tooltip is in the way after that.
      onPointerDown: hide,
      // Tab round the rail and the names come up the same way — but only for
      // a keyboard. Pressing a button focuses it too, so without asking
      // `:focus-visible` the tooltip that the press just dismissed came
      // straight back up over the rail.
      onFocus: (e) => e.currentTarget.matches?.(':focus-visible') && open(e, label, hint),
      onBlur: hide,
    }),
    [open, hide]
  )

  return { bind, node: tip ? <Tip {...tip} side={side} /> : null }
}

function Tip({ label, hint, rect, side }) {
  const box = useRef(null)
  const [at, setAt] = useState(null)

  // Measured before it is placed: a tooltip has to know how tall it is to sit
  // level with its button, and how wide to stay on the screen.
  useEffect(() => {
    const el = box.current
    if (!el) return
    const own = el.getBoundingClientRect()
    const margin = 8
    let left = side === 'right' ? rect.right + GAP : rect.left - own.width - GAP
    // No room that side: go to the other one rather than off the edge.
    if (left + own.width > window.innerWidth - margin) left = rect.left - own.width - GAP
    if (left < margin) left = rect.right + GAP
    const top = Math.max(
      margin,
      Math.min(rect.top + rect.height / 2 - own.height / 2, window.innerHeight - own.height - margin)
    )
    setAt({ left, top })
  }, [rect, side, label, hint])

  return createPortal(
    <div
      ref={box}
      className="tip"
      role="tooltip"
      // Laid out off-screen for the one frame it takes to measure, rather
      // than flashed in the top-left corner first.
      style={at ? { left: at.left, top: at.top } : { left: -9999, top: 0 }}
    >
      <b>{label}</b>
      {hint && <span>{hint}</span>}
    </div>,
    document.body
  )
}
