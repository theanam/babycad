/**
 * Lining a multi-selection up, the way Tinkercad does it.
 *
 * Nine targets, three on each axis: bring the low faces together, bring the
 * centres together, or bring the high faces together. That is the whole idea —
 * there is no "distribute", no spacing, no snapping to one chosen block. Pick
 * an edge of the selection and everything comes to it.
 *
 * Two things make it behave the way people expect rather than merely
 * arithmetically:
 *
 *   - What moves is a *unit*, not a block. A combined group travels as one
 *     piece and keeps its internal arrangement, because keeping that
 *     arrangement is what combining it was for.
 *   - Bounds are read off the live meshes, so a block that has been turned or
 *     stretched lines up by the room it actually takes up rather than by the
 *     numbers it was built from. A cube turned 45° is wider than its width.
 */
import * as THREE from 'three'
import { boxOfMesh } from './gizmoMath'
import { rootUnitOf } from './sceneStore'

/** Low edge, middle, high edge — along one axis. */
export const ALIGN_MODES = ['min', 'center', 'max']

const AXIS_KEY = ['x', 'y', 'z']

const edgeOf = (box, axis, mode) =>
  mode === 'min' ? box.min[axis] : mode === 'max' ? box.max[axis] : (box.min[axis] + box.max[axis]) / 2

/**
 * Members of one group move together; everything else is its own unit.
 *
 * By the *top* group, not the innermost one. Groups nest, so a thing built out
 * of two combined halves is one object to anybody looking at it, and lining it
 * up should slide the whole thing rather than shear its halves apart.
 */
function unitsOf(objects, groups = []) {
  const byKey = new Map()
  for (const o of objects) {
    const key = rootUnitOf(o, groups)
    if (!byKey.has(key)) byKey.set(key, [])
    byKey.get(key).push(o)
  }
  return [...byKey.values()]
}

/**
 * The world-space box of each unit, and of the selection as a whole.
 * Units whose meshes aren't in the viewport yet are left out rather than
 * treated as a point at the origin.
 */
export function alignBounds(objects, meshes, groups = []) {
  const scratch = new THREE.Box3()
  const units = []
  const whole = new THREE.Box3().makeEmpty()

  for (const members of unitsOf(objects, groups)) {
    const box = new THREE.Box3().makeEmpty()
    for (const o of members) {
      const mesh = meshes.get(o.id)
      // A combined hole is invisible, and lining things up by the reach of
      // something nobody can see is a puzzle rather than a feature.
      if (mesh?.visible) box.union(boxOfMesh(mesh, scratch))
    }
    if (box.isEmpty()) continue
    units.push({ members, box })
    whole.union(box)
  }
  return { units, whole }
}

/**
 * How far each block has to travel to bring the selection into line.
 *
 * **A locked block is what the others line up against.** Normally the edge
 * everything meets at comes from the selection as a whole, which is fair when
 * nothing has been singled out. Lock one, though, and you have said which one
 * is right: the edge then comes from the locked blocks alone and only the free
 * ones travel. That is the whole use of locking something and then aligning to
 * it — a baseplate you have finished with, and a row of parts brought to it.
 *
 * @param slot  internal axis index — 0 is x, 1 is up, 2 is depth
 * @param mode  one of ALIGN_MODES
 * @returns  Map of object id to the distance it moves along that axis. Empty
 *           when there is nothing to line up, or when it is already lined up.
 */
export function alignOffsets(objects, meshes, slot, mode, groups = []) {
  const axis = AXIS_KEY[slot]
  const { units, whole } = alignBounds(objects, meshes, groups)
  // One unit is already as aligned as it can be — a group is not lined up
  // against itself.
  if (units.length < 2) return new Map()

  const held = units.filter((u) => u.members.some((o) => o.locked))
  const free = units.filter((u) => !u.members.some((o) => o.locked))
  // Everything held down: there is nothing left that may move.
  if (held.length && !free.length) return new Map()

  let anchor = whole
  if (held.length) {
    anchor = new THREE.Box3().makeEmpty()
    for (const u of held) anchor.union(u.box)
  }

  const target = edgeOf(anchor, axis, mode)
  const offsets = new Map()
  for (const { members, box } of held.length ? free : units) {
    const delta = target - edgeOf(box, axis, mode)
    if (Math.abs(delta) < 1e-6) continue
    for (const o of members) offsets.set(o.id, delta)
  }
  return offsets
}
