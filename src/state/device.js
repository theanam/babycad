/**
 * Which shell to draw: the desktop one, or the touch one.
 *
 * The question is not "does this browser have a touch API" — a laptop with a
 * touchscreen and a mouse in hand wants the desktop chrome, and it answers yes
 * to that. It is "what is the thing doing the pointing", which is what
 * `pointer: coarse` asks. A finger covers far more screen than a cursor, has
 * no hover to reveal anything with and no buttons to hold, so a rail of 60px
 * shape buttons, a right-drag to orbit and a tooltip explaining the difference
 * are all answers to a question nobody on a tablet is being asked.
 *
 * `compact` splits that touch shell again, at the width where a phone stops
 * being a small tablet: the bottom bar loses its labels and the view cube
 * gives up its corner. It is width, not pointer — an iPad in portrait is
 * roomy, a phone in landscape is short but wide.
 *
 * Both are read live. A convertible folded into a tablet, a phone turned on
 * its side, a desktop window dragged narrow: the shell follows, because the
 * media query is subscribed to rather than latched at load.
 */
import { useEffect, useState } from 'react'

const COARSE = '(pointer: coarse)'
const COMPACT = '(max-width: 760px)'

const query = (q) =>
  typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(q) : null

const read = () => {
  const coarse = query(COARSE)
  const compact = query(COMPACT)
  return { touch: Boolean(coarse?.matches), compact: Boolean(compact?.matches) }
}

/**
 * `{ touch, compact }`, kept current.
 *
 * One subscription per mount is fine: this is read by the shell and by a
 * handful of panels, not by anything on a per-frame path.
 */
export function useDevice() {
  const [state, setState] = useState(read)

  useEffect(() => {
    const lists = [query(COARSE), query(COMPACT)].filter(Boolean)
    // Only when an answer actually changed. The hook hands back a fresh object
    // each read, and every consumer of it re-renders the shell.
    const onChange = () =>
      setState((was) => {
        const now = read()
        return was.touch === now.touch && was.compact === now.compact ? was : now
      })
    // Safari only grew `addEventListener` on a media query list in 14.
    for (const list of lists) {
      if (list.addEventListener) list.addEventListener('change', onChange)
      else list.addListener(onChange)
    }
    onChange()
    return () => {
      for (const list of lists) {
        if (list.removeEventListener) list.removeEventListener('change', onChange)
        else list.removeListener(onChange)
      }
    }
  }, [])

  return state
}

/** The same answer outside React, for the handful of places that need it. */
export const isTouch = () => Boolean(query(COARSE)?.matches)
