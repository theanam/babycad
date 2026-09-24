import { useCallback, useEffect, useRef } from 'react'
import { ChevronUpIcon, CloseIcon } from '../icons'

/**
 * A panel that comes up from the bottom edge.
 *
 * Everything the desktop shell puts in a rail, a flyout or a drop-down menu
 * arrives here instead, for one reason: on a handheld the bottom of the screen
 * is where the thumbs are, and the top is where they are not. A menu hung off
 * a button in the top bar is a menu you have to re-grip the device to reach.
 *
 * Two kinds, and the difference matters:
 *
 * **Modal** (`scrim`) — picking a shape, choosing a file. There is nothing to
 * see behind it and a tap outside puts it away.
 *
 * **Attached** (no scrim) — the properties of whatever is selected. The block
 * being edited is the thing you are looking at, so the sheet must not cover it
 * and must not swallow the presses that go past it: a colour is chosen and a
 * corner is dragged in the same breath. It rides above the bottom bar, takes
 * a little under half the screen, and pulls up to most of it when the numbers
 * are what you are working on.
 *
 * Dragging is done on the mesh directly rather than through React state — the
 * same reason the gizmo does it, sixty translate writes a second is not a
 * re-render anybody wants — and the store is written once, when the finger
 * comes up and the sheet has decided where it landed.
 */

/** Past this much downward travel, letting go steps down rather than springs back. */
const DISMISS_PX = 80
/** Past this much upward travel, it steps up. */
const EXPAND_PX = 54

/**
 * The heights an attached sheet stops at, shortest first.
 *
 * Three rather than two, and the first one is small on purpose: picking a
 * block should not cost you the build. At `peek` the sheet is only as tall as
 * what is picked, the three modes and the three actions — a bar, really —
 * and the plate above it is still the plate. `mid` adds the colours and the
 * solid/hole switch, `tall` is for working in millimetres. Each is one drag or
 * one tap of the grab bar away from the next.
 */
export const DETENTS = ['peek', 'mid', 'tall']

export default function Sheet({
  title,
  subtitle,
  onClose,
  children,
  /** A modal sheet dims what is behind it and closes on a tap outside. */
  scrim = false,
  /** One of `DETENTS`, or 'auto' — auto is as tall as its contents need. */
  detent = 'auto',
  onDetent,
  /** Extra chrome for the right of the title row. */
  actions,
  /** A swatch or icon before the title, identifying what the sheet is about. */
  lead,
  /** Hand the whole body to the child, which then does its own scrolling. */
  flush = false,
  className = '',
  label,
}) {
  const panel = useRef(null)
  const drag = useRef(null)
  /**
   * How far the last press on the grab bar travelled.
   *
   * A pointerup on the element that captured the pointer still produces a
   * `click`, however far the finger moved in between — so without this a drag
   * up one rung fires the drag handler and then the tap handler, and the sheet
   * jumps two.
   */
  const travelled = useRef(0)

  useEffect(() => {
    if (!onClose) return
    const onKey = (e) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const onGrabDown = useCallback((e) => {
    const el = panel.current
    if (!el) return
    e.currentTarget.setPointerCapture?.(e.pointerId)
    drag.current = { y: e.clientY, moved: 0 }
    travelled.current = 0
    el.style.transition = 'none'
  }, [])

  const onGrabMove = useCallback((e) => {
    const el = panel.current
    if (!drag.current || !el) return
    const dy = e.clientY - drag.current.y
    drag.current.moved = dy
    // Downward is free; upward is rubber-banded, because there is nowhere for
    // a sheet already at its tallest to go and a panel that lifts off the
    // bottom edge reads as broken rather than as resistance.
    el.style.transform = `translateY(${dy > 0 ? dy : dy / 3}px)`
  }, [])

  /** Where this sheet sits in the ladder, or -1 if it isn't on it. */
  const step = DETENTS.indexOf(detent)

  const onGrabUp = useCallback(
    (e) => {
      const el = panel.current
      const state = drag.current
      drag.current = null
      if (!el || !state) return
      e.currentTarget.releasePointerCapture?.(e.pointerId)
      el.style.transition = ''
      el.style.transform = ''

      const dy = state.moved
      travelled.current = Math.abs(dy)
      if (dy > DISMISS_PX) {
        // Down goes one rung; off the bottom rung it goes away altogether.
        if (step > 0 && onDetent) onDetent(DETENTS[step - 1])
        else onClose?.()
      } else if (dy < -EXPAND_PX && step >= 0 && step < DETENTS.length - 1) {
        onDetent?.(DETENTS[step + 1])
      }
    },
    [step, onClose, onDetent]
  )

  const sheet = (
    <div
      ref={panel}
      className={`sheet sheet-${detent}${scrim ? '' : ' sheet-attached'} ${className}`}
      role="dialog"
      aria-modal={scrim || undefined}
      aria-label={label ?? title}
    >
      <div
        className="sheet-grab"
        onPointerDown={onGrabDown}
        onPointerMove={onGrabMove}
        onPointerUp={onGrabUp}
        onPointerCancel={onGrabUp}
        // Tapping the bar walks up the ladder and drops back to the bottom
        // from the top, for anybody who would rather tap than drag.
        onClick={() => {
          // A press that went anywhere was a drag, and has already been
          // answered on the way up.
          if (travelled.current > 4) return
          if (step < 0 || !onDetent) return
          onDetent(DETENTS[(step + 1) % DETENTS.length])
        }}
        aria-label={step >= 0 && step < DETENTS.length - 1 ? 'Show more' : 'Show less'}
        role={step >= 0 ? 'button' : undefined}
      >
        <i />
        {/* A pill alone says "draggable" to somebody who already knows the
            convention. The caret says which way, to somebody who doesn't. */}
        {step >= 0 && step < DETENTS.length - 1 && (
          <ChevronUpIcon size={13} stroke="#59627A" />
        )}
      </div>

      {(title || onClose) && (
        <div className="sheet-head">
          {lead}
          <div className="sheet-title">
            {title}
            {subtitle && <em>{subtitle}</em>}
          </div>
          {actions}
          {onClose && (
            <button className="sheet-close" onClick={onClose} aria-label="Close">
              <CloseIcon size={18} stroke="#8A93A5" />
            </button>
          )}
        </div>
      )}

      <div className={`sheet-body${flush ? ' flush' : ''}`}>{children}</div>
    </div>
  )

  if (!scrim) return sheet
  return (
    <div
      className="sheet-scrim"
      onPointerDown={(e) => e.target === e.currentTarget && onClose?.()}
    >
      {sheet}
    </div>
  )
}
