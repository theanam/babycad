/**
 * Lets a block mesh hand a drag straight to the gizmo.
 *
 * Dragging a block's body moves it, but the pointer-down happens on the mesh
 * (in SceneObject) while all the drag machinery lives in BoxGizmo. The gizmo
 * registers its handler here on mount.
 */
export const dragBus = {
  startBodyMove: null,
}
