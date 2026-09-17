import { create } from 'zustand'

/**
 * Transient drag state, kept out of the scene store on purpose.
 *
 * While a gizmo drag is in flight the block meshes are mutated directly (see
 * BoxGizmo) so React never re-renders the scene per frame. This little store
 * carries only what the chrome needs to stay truthful during the drag:
 * whether a drag is happening, and a throttled copy of the live transform of
 * the primary selected block.
 */
export const useLive = create(() => ({
  dragging: false,
  live: null, // { position, rotation, scale } of the primary block, mid-drag
}))

export const beginDrag = () => useLive.setState({ dragging: true, live: null })
export const endDrag = () => useLive.setState({ dragging: false, live: null })
export const setLive = (live) => useLive.setState({ live })
