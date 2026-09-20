/**
 * Cutting holes out of solids.
 *
 * A block is either a solid or a hole. A hole cuts the solids it is *combined*
 * with — Tinkercad's rule, and the reason it is a rule rather than "cuts
 * whatever it touches" is that it leaves you somewhere to put a hole while you
 * line it up.
 *
 * The subtraction is done per solid rather than once per group, which sounds
 * like more work and is the same answer: (A ∪ B) − H is (A − H) ∪ (B − H).
 * Doing it per solid is what lets every block keep its own id, colour, mesh
 * and handles — the gizmo, the align targets and the properties rail all carry
 * on addressing blocks, and a hole can be nudged and watched.
 *
 * Results are cached and reference counted, the same deal the plain shape
 * cache gets and for the same reason: a cut geometry is expensive to build and
 * leaks GPU buffers if it is dropped without `dispose()`.
 */
import * as THREE from 'three'
import { Brush, Evaluator, SUBTRACTION } from 'three-bvh-csg'
import { acquireGeometry, releaseGeometry } from './geometryCache'
import { keyOfParams } from './index'

const IDLE_MAX = 24

const evaluator = new Evaluator()
// Our geometries carry position and normal; a brush pair whose attribute sets
// disagree throws, so pin the evaluator to the two both are guaranteed to have.
evaluator.attributes = ['position', 'normal']
evaluator.useGroups = false

const entries = new Map() // key -> { key, geometry, refs }
const byGeometry = new WeakMap()
const idle = []

const _a = new THREE.Matrix4()
const _b = new THREE.Matrix4()
const _euler = new THREE.Euler()
const _quat = new THREE.Quaternion()
const _pos = new THREE.Vector3()
const _scale = new THREE.Vector3()
const _boxA = new THREE.Box3()
const _boxB = new THREE.Box3()

/** A block's own transform. Groups are logical here, so this is world space. */
function matrixOf(object, target) {
  _pos.fromArray(object.position)
  _euler.fromArray(object.rotation)
  _quat.setFromEuler(_euler)
  _scale.fromArray(object.scale)
  return target.compose(_pos, _quat, _scale)
}

/** Trimmed so a nudge of a thousandth of a millimetre isn't a new cache entry. */
const matrixKey = (m) => m.elements.map((n) => Math.round(n * 1e4) / 1e4).join(',')

function brushAt(geometry, matrix) {
  const brush = new Brush(geometry)
  brush.matrixAutoUpdate = false
  brush.matrix.copy(matrix)
  brush.matrix.decompose(brush.position, brush.quaternion, brush.scale)
  brush.updateMatrixWorld(true)
  return brush
}

/**
 * The holes that actually reach this solid. Anything whose world box misses
 * the solid's is skipped — without this, ten holes and ten solids in one group
 * would be a hundred subtractions to draw a scene where most pairs never meet.
 */
function reaching(object, holes) {
  if (!holes?.length) return []
  const solid = acquireGeometry(object.type, object.params)
  _boxA.copy(solid.boundingBox).applyMatrix4(matrixOf(object, _a))
  releaseGeometry(solid)

  const near = []
  for (const hole of holes) {
    const g = acquireGeometry(hole.type, hole.params)
    _boxB.copy(g.boundingBox).applyMatrix4(matrixOf(hole, _b))
    releaseGeometry(g)
    if (_boxA.intersectsBox(_boxB)) near.push(hole)
  }
  return near
}

/**
 * The key a cut is cached under: this solid's shape, plus each hole's shape
 * and where it sits *relative to the solid*. Relative is what matters — slide
 * a cut block and its hole across the plate together and the cut is the same
 * cut, so it should not be rebuilt.
 */
function cutKey(object, holes) {
  const inverse = matrixOf(object, _a).clone().invert()
  let key = keyOfParams(object.type, object.params)
  for (const hole of holes) {
    const relative = inverse.clone().multiply(matrixOf(hole, _b))
    key += `#${keyOfParams(hole.type, hole.params)}@${matrixKey(relative)}`
  }
  return key
}

function buildCut(object, holes) {
  const inverse = matrixOf(object, _a).clone().invert()
  let result = null

  for (const hole of holes) {
    const solidGeometry = result ?? acquireGeometry(object.type, object.params)
    const holeGeometry = acquireGeometry(hole.type, hole.params)
    const relative = inverse.clone().multiply(matrixOf(hole, _b))

    const cut = evaluator.evaluate(
      brushAt(solidGeometry, _b.identity()),
      brushAt(holeGeometry, relative),
      SUBTRACTION
    )
    releaseGeometry(holeGeometry)
    if (result) result.dispose()
    else releaseGeometry(solidGeometry)
    result = cut.geometry
  }

  result.computeBoundingBox()
  result.computeBoundingSphere()
  return result
}

/**
 * The geometry a block should actually be drawn with: its plain shape when
 * nothing cuts it, and the cut when something does. Release it with
 * `releaseShape`, which hands it back to whichever cache lent it.
 */
export function acquireShape(object, holes) {
  const near = object.hole ? [] : reaching(object, holes)
  if (!near.length) return acquireGeometry(object.type, object.params)

  const key = cutKey(object, near)
  let entry = entries.get(key)
  if (!entry) {
    entry = { key, geometry: buildCut(object, near), refs: 0 }
    entries.set(key, entry)
    byGeometry.set(entry.geometry, entry)
  }
  if (entry.refs === 0) {
    const at = idle.indexOf(key)
    if (at !== -1) idle.splice(at, 1)
  }
  entry.refs++
  return entry.geometry
}

export function releaseShape(geometry) {
  const entry = geometry && byGeometry.get(geometry)
  if (!entry) return releaseGeometry(geometry) // a plain shape, not a cut one
  if (entry.refs === 0) return
  if (--entry.refs > 0) return
  idle.push(entry.key)
  while (idle.length > IDLE_MAX) {
    const dead = entries.get(idle.shift())
    if (!dead || dead.refs > 0) continue
    entries.delete(dead.key)
    dead.geometry.dispose()
  }
}

/**
 * The holes each group contains, so a block can be told what cuts it without
 * every block having to search the whole scene.
 */
export function holesByGroup(objects) {
  const byGroup = new Map()
  for (const o of objects) {
    if (!o.hole || !o.parentGroupId) continue
    if (!byGroup.has(o.parentGroupId)) byGroup.set(o.parentGroupId, [])
    byGroup.get(o.parentGroupId).push(o)
  }
  return byGroup
}

/** What cuts this one block: the holes combined with it, and not itself. */
export const holesFor = (object, byGroup) =>
  object.hole || !object.parentGroupId ? null : byGroup.get(object.parentGroupId) ?? null
