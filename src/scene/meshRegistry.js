/**
 * id -> THREE.Mesh for every block currently in the viewport.
 *
 * The gizmo uses this to move meshes directly during a drag, which is what
 * keeps dragging smooth: React only hears about the change once, when the
 * drag ends.
 */
export const meshes = new Map()

export const registerMesh = (id, mesh) => {
  if (mesh) meshes.set(id, mesh)
  else meshes.delete(id)
}
