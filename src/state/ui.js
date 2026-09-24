/**
 * Chrome state: which side panel is showing, and whether something has asked
 * for a particular variable to be brought up.
 *
 * In a store rather than in App because the ask can come from inside the 3D
 * canvas — a size label on the bounding box names the variable driving that
 * side — and a callback cannot be handed across that boundary.
 */
import { create } from 'zustand'

export const useUI = create((set) => ({
  /** The right rail shows the variables instead of the block's properties. */
  variablesOpen: false,
  /** A variable to reveal and put the cursor in, cleared once that is done. */
  focusVariable: null,

  /**
   * Touch's shift-click: while this is on, tapping a block adds it to the
   * selection instead of replacing it.
   *
   * A finger has no modifier to hold, and the desktop's other route to a
   * multi-selection — dragging a box over empty plate — is the gesture that
   * turns the view on a touchscreen, so neither survives the trip. A mode is
   * the honest answer, and it is sticky: picking out four blocks to line up
   * means four taps, and a mode that switched itself off after the first
   * would be worse than no mode at all.
   *
   * It lives here rather than in the scene store because it is chrome — how
   * the selection is being made, not what is in it.
   */
  pickMore: false,

  togglePickMore: () => set((s) => ({ pickMore: !s.pickMore })),
  setPickMore: (pickMore) => set({ pickMore }),

  toggleVariables: () =>
    set((s) => ({ variablesOpen: !s.variablesOpen, focusVariable: null })),
  closeVariables: () => set({ variablesOpen: false, focusVariable: null }),

  /** Show the variables, with this one ready to change. */
  revealVariable: (id) => set({ variablesOpen: true, focusVariable: id }),
  clearFocus: () => set({ focusVariable: null }),
}))
