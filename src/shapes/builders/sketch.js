/**
 * A drawing, lifted into a solid.
 *
 * The one shape with two ways in: `io/importSvg` writes its document out of a
 * file, the drawing editor writes one by hand, and nothing below here can tell
 * which happened. See `docs/sketches.md`.
 *
 * **Why there are two roads through this function.** `extrudeProfile` is ours
 * and gives crease smoothing — the thing that keeps a flattened curve reading
 * as a curve instead of a row of facets — and it cannot bevel. Three's
 * `ExtrudeGeometry` bevels. So an edge above zero goes the second way,
 * exactly as `builders/text` already does for the same reason.
 *
 * What `ExtrudeGeometry` does not do is shade what it builds: everything it
 * makes is flat-shaded, and a rounded edge that is flat-shaded is a flight of
 * steps. Round and Bevel came out looking like the same thing, which is a
 * switch that does nothing. `smoothCreases` puts that right afterwards —
 * see `shapes/edges` — and being a pass over the finished mesh it also
 * smooths the walls, so the second road no longer costs anything the first
 * one gives.
 *
 * That is also why there is no Twist here though the extruder has one: a
 * parameter that silently switches another one off is worse than a parameter
 * that is not there.
 */
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { extrudeProfile } from '../extrude'
import { smoothCreases } from '../edges'
import { flattenSketch, shapesFrom } from '../sketch/flatten'

/** The smallest bevel worth cutting, in millimetres. */
const MIN_EDGE = 1e-4

/**
 * How many facets a round edge is cut from.
 *
 * Three was the number `builders/text` uses and it is not enough here: a
 * letter's edge is a fraction of a millimetre and a plate's is millimetres,
 * so what reads as a softened corner on one reads as three steps on the
 * other. Six is a curve at the silhouette, and with `smoothCreases` shading
 * across them it is a curve everywhere else too.
 *
 * A chamfer is one facet by definition, and that is the whole difference
 * between the two styles.
 */
const ROUND_FACETS = 6

/**
 * How far in an edge may come. A bevel wider than half the thickness meets
 * itself in the middle, and one wider than a quarter of the smallest island
 * eats the island — so it is clamped against both, and against the smallest
 * thing being bevelled rather than the whole drawing's span.
 */
function edgeFor(edge, thickness, islands) {
  let smallest = Infinity
  for (const { contour } of islands) {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const p of contour) {
      if (p.x < minX) minX = p.x
      if (p.x > maxX) maxX = p.x
      if (p.y < minY) minY = p.y
      if (p.y > maxY) maxY = p.y
    }
    smallest = Math.min(smallest, maxX - minX, maxY - minY)
  }
  return Math.min(edge, thickness * 0.49, smallest * 0.24)
}

export function buildSketch({ sketch, thickness, sides, edge, edgeStyle }) {
  const { islands } = flattenSketch(sketch, sides)
  // An empty drawing is the ordinary state of a block the moment it is made,
  // not an error: the cache turns this into a real, selectable block that
  // draws nothing.
  if (!islands.length) return null

  const e = edge > 0 ? edgeFor(edge, thickness, islands) : 0
  const geometry = e > MIN_EDGE ? bevelled(islands, thickness, e, edgeStyle) : plain(islands, thickness)

  // Centred on the origin in all three, as every builder here does. Sitting it
  // on the plate is `restingHeight`'s job and it can only do that if the
  // origin is the middle.
  geometry.computeBoundingBox()
  const b = geometry.boundingBox
  geometry.translate(-(b.min.x + b.max.x) / 2, -(b.min.y + b.max.y) / 2, -(b.min.z + b.max.z) / 2)
  return geometry
}

/**
 * The crease-smoothed road. One extrusion per island — "outer contour" is
 * singular in `extrudeProfile` and always was — merged into one solid.
 */
function plain(islands, thickness) {
  const parts = islands.map(({ contour, holes }) =>
    extrudeProfile(contour, holes, { height: thickness })
  )
  if (parts.length === 1) return parts[0]
  const merged = mergeGeometries(parts)
  for (const part of parts) part.dispose()
  return merged
}

/**
 * The bevelled road.
 *
 * `ExtrudeGeometry` adds its bevel on top of whatever it is given, in both
 * directions, and both have to be taken back off or an edge would make the
 * part bigger:
 *
 *   - **Thickness.** The bevel stands proud at each end, so the depth asked
 *     for is the thickness less the two of them — which is what makes a 5 mm
 *     plate with a 1 mm edge come out 5 mm thick rather than 7.
 *   - **Footprint.** The bevel grows *outward* from the outline by default,
 *     so a 20 mm square would come out 22 mm across. `bevelOffset: -e` starts
 *     it that far inside instead, and the widest point goes back to being the
 *     outline that was drawn. Everywhere else in this app an edge takes
 *     material off rather than adding it — a cube with a 3 mm edge is still
 *     20 mm — and a drawing has to agree with that.
 *
 * One segment is a flat chamfer; three is enough to read as a round.
 *
 * It builds in XY and extrudes along +Z, which would stand the drawing up
 * like a billboard, so it is turned a quarter circle about X. The turn is
 * `+90°` rather than the `−90°` the text builder uses, because `flatten` has
 * already taken the drawing into the extruder's plane and this has to land on
 * the same mapping the other road does: a drawing's y ends up on the scene's
 * z either way.
 */
function bevelled(islands, thickness, e, edgeStyle) {
  const geometry = new THREE.ExtrudeGeometry(shapesFrom(islands), {
    depth: thickness - 2 * e,
    steps: 1,
    bevelEnabled: true,
    bevelThickness: e,
    bevelSize: e,
    bevelOffset: -e,
    bevelSegments: edgeStyle === 'bevel' ? 1 : ROUND_FACETS,
  })
  geometry.rotateX(Math.PI / 2)
  // Flat-shaded out of the box, which is what made a round edge look like a
  // bevel with extra steps. The threshold is the extruder's own.
  return smoothCreases(geometry)
}
