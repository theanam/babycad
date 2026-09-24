/**
 * How far the thing you are holding is from the nearest thing you are not.
 *
 * Positions answer "where is this block", and while you are placing a part
 * against another part that is rarely the question. The question is how much
 * room is left between them — whether a lid clears a rim, whether two pegs are
 * far enough apart — and no amount of reading X and Y off two blocks answers
 * it without arithmetic nobody wants to do while dragging.
 *
 * **What is measured.** The clearance between the two boxes, not the distance
 * between their middles. Centre to centre is a number that changes when a
 * block is resized and tells you nothing about whether the two touch; the gap
 * between their sides is the one that is nought when they meet.
 *
 * Boxes, rather than the shapes themselves: two balls side by side really are
 * touching before their boxes are, and measuring the true surfaces would mean
 * a distance query against every triangle of both, every frame of a drag. The
 * box is what the rest of this app already aligns, stacks and seats against,
 * so at least the number agrees with everything else on screen.
 *
 * The direction comes back with the distance, because a number you can type
 * into needs to know which way to move the block to honour what you typed.
 */
import * as THREE from 'three'

/**
 * Is there anything here to measure to?
 *
 * `visible` is not enough. A block whose builder threw, and an imported model
 * whose triangles are not in the store, both come back from
 * `shapes/geometryCache` as `nothingToDraw()` — a real mesh, visible, with an
 * empty position buffer. Worse, that cache deliberately pins an empty
 * geometry's bounding box to a point at the origin rather than leaving it at
 * infinity, because `restingHeight` reads the box and a NaN position takes the
 * renderer with it. So the box is finite, sits exactly on the object's
 * position, and reads as a perfectly good neighbour a few centimetres away —
 * which is how "54 mm to the model" comes to point at bare plate.
 *
 * Counting the vertices is the question actually being asked: not "is this
 * object switched on" but "is there a surface here that a gap could be between".
 */
const drawsSomething = (mesh) =>
  Boolean(mesh?.visible) && (mesh.geometry?.getAttribute('position')?.count ?? 0) > 0

const _box = new THREE.Box3()
const _size = new THREE.Vector3()
const AXES = ['x', 'y', 'z']

/** A mesh's world-space box, reusing `target`. */
function boxOf(mesh, target) {
  mesh.updateMatrixWorld()
  if (!mesh.geometry?.boundingBox) mesh.geometry?.computeBoundingBox?.()
  target.copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld)
  return target
}

/**
 * How far apart two boxes are along one axis. Positive is clear air between
 * them; zero or less is an overlap, and how much of one.
 */
const along = (a, b, k) => Math.max(a.min[k] - b.max[k], b.min[k] - a.max[k])

/**
 * The nearest block that is not being moved, and the room between.
 *
 * Returns `{ id, type, gap, direction, from, to }` — `direction` being the way
 * to push the moving blocks to make the gap bigger, and `from`/`to` the two
 * nearest points, one on each box, so the gap can be drawn as well as counted.
 * Null when there is nothing else on the plate to measure against.
 */
export function nearestNeighbour(movingIds, objects, meshes) {
  const moving = new Set(movingIds)

  // The moving side is measured as one box, so a combined thing is one thing.
  const mine = new THREE.Box3().makeEmpty()
  for (const id of moving) {
    const mesh = meshes.get(id)
    if (drawsSomething(mesh)) mine.union(boxOf(mesh, _box))
  }
  if (mine.isEmpty()) return null

  let best = null
  for (const o of objects) {
    if (moving.has(o.id)) continue
    const mesh = meshes.get(o.id)
    // A combined hole is not drawn, and neither is a model whose triangles
    // went missing. Measuring to either is reporting a gap to thin air.
    if (!drawsSomething(mesh)) continue
    const theirs = boxOf(mesh, _box)

    // Clear air on each axis, and none of it counted twice: an axis they
    // overlap on contributes nothing to how far apart they are.
    const clear = AXES.map((k) => Math.max(along(mine, theirs, k), 0))
    const gap = Math.hypot(clear[0], clear[1], clear[2])
    if (best && gap >= best.gap) continue

    // Which way is away. Where there is clear air, away is along it; where
    // the two boxes already overlap everywhere, there is no gap to grow and
    // the least-buried axis is the shortest way out.
    let direction
    if (gap > 1e-9) {
      direction = AXES.map((k, i) =>
        clear[i] > 0 ? (mine.min[k] - theirs.max[k] > 0 ? clear[i] : -clear[i]) / gap : 0
      )
    } else {
      const overlaps = AXES.map((k) => along(mine, theirs, k))
      const shallowest = overlaps.indexOf(Math.max(...overlaps))
      const key = AXES[shallowest]
      const push =
        mine.getCenter(_size)[key] >= (theirs.min[key] + theirs.max[key]) / 2 ? 1 : -1
      direction = [0, 0, 0]
      direction[shallowest] = push
    }
    // The shortest line between the two boxes. On an axis where they are
    // apart it runs from one facing side to the other; on an axis where they
    // already overlap there is nothing to cross, so it sits in the middle of
    // the overlap and stays square to the blocks.
    const from = []
    const to = []
    for (const k of AXES) {
      if (mine.max[k] < theirs.min[k]) {
        from.push(mine.max[k])
        to.push(theirs.min[k])
      } else if (theirs.max[k] < mine.min[k]) {
        from.push(mine.min[k])
        to.push(theirs.max[k])
      } else {
        const middle = (Math.max(mine.min[k], theirs.min[k]) + Math.min(mine.max[k], theirs.max[k])) / 2
        from.push(middle)
        to.push(middle)
      }
    }
    best = { id: o.id, type: o.type, gap, direction, from, to }
  }
  return best
}
