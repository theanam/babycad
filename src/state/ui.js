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

  toggleVariables: () =>
    set((s) => ({ variablesOpen: !s.variablesOpen, focusVariable: null })),
  closeVariables: () => set({ variablesOpen: false, focusVariable: null }),

  /** Show the variables, with this one ready to change. */
  revealVariable: (id) => set({ variablesOpen: true, focusVariable: id }),
  clearFocus: () => set({ focusVariable: null }),
}))
