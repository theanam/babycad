/**
 * Lets a block mesh hand a drag straight to the gizmo.
 *
 * Dragging a block's body moves it, but the pointer-down happens on the mesh
 * (in SceneObject) while all the drag machinery lives in BoxGizmo. The gizmo
 * registers its handler here on mount.
 */
export const dragBus = {
  startBodyMove: null,
  // Double-clicking a word on the plate opens it for editing. The block knows
  // it was double-clicked; the gizmo owns the editor, because that is where
  // every other "type it onto the thing itself" editor already lives.
  editWords: null,
}
