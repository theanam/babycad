/**
 * An imported model.
 *
 * The only shape here that is not built from its parameters — see
 * `shapes/meshStore` for why the triangles live beside the scene rather than
 * in it. `mesh` is the id they are kept under; this builder just fetches them.
 *
 * It has no size parameters on purpose. A cube can be asked for a wider X
 * because a cube knows what its width means; a model is a bag of triangles
 * with no opinion about which of them is "the width", so the gizmo falls back
 * to the scale multiplier, which is exactly the honest answer. That is also
 * why `AXIS_PARAMS` has no entry for it.
 */
import { geometryFor } from '../meshStore'

export function buildModel({ mesh }) {
  return geometryFor(mesh)
}
