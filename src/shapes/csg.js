/**
 * Cutting holes out of solids.
 *
 * A block is either a solid or a hole, and a hole cuts every solid it reaches
 * into — straight away, while you are still pushing it around. There is no
 * step to perform and nothing to commit before the hole is a hole: drop a tube
 * through a cube and the cube has a tube-shaped hole in it.
 *
 * `Combine` doesn't do the cutting, then. What it does is finish the job: a
 * hole that has been combined with something stops being drawn, so all that is
 * left on screen is the solid with the bite taken out of it. Split apart and
 * the grey ghost comes back, still cutting, still movable.
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
import { onFaceLoaded } from './fontStore'

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

/**
 * Each hole with the transform that puts it where it sits relative to the
 * solid — the frame a cut is worked out in, since the solid's own geometry is
 * built at the origin. `io/solidCut` cuts the same holes a second time for the
 * exported file, and has to place them exactly where these are placed.
 */
export function relativeCutters(object, holes) {
  const inverse = matrixOf(object, _a).clone().invert()
  return (holes ?? []).map((hole) => ({
    hole,
    matrix: inverse.clone().multiply(matrixOf(hole, _b)),
  }))
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
/** The cut-geometry twin of `forgetType`, for the same reason. */
export function forgetCutsOf(type) {
  for (const key of [...entries.keys()]) {
    if (!key.startsWith(type)) continue
    const entry = entries.get(key)
    entries.delete(key)
    const at = idle.indexOf(key)
    if (at !== -1) idle.splice(at, 1)
    if (entry && entry.refs === 0) entry.geometry.dispose()
  }
}

export function acquireShape(object, holes) {
  const near = object.hole || !holes?.length ? [] : holes
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

/** A block's world-space bounding box, borrowed from the shape cache. */
function worldBox(object, target) {
  const geometry = acquireGeometry(object.type, object.params)
  target.copy(geometry.boundingBox).applyMatrix4(matrixOf(object, _a))
  releaseGeometry(geometry)
  return target
}

/**
 * Which holes cut which solids, worked out once for the whole scene.
 *
 * Boxes first, and only then geometry: ten holes among a hundred blocks is a
 * thousand pairs, and all but a handful of them are nowhere near each other.
 * A pair whose bounding boxes miss cannot possibly intersect, and that test is
 * two comparisons per axis against a subtraction that is thousands of
 * triangles of work.
 *
 * Solids only — a hole is never cut, by another hole or by itself.
 */
export function cuttersByObject(objects) {
  const holes = objects.filter((o) => o.hole)
  const out = new Map()
  if (!holes.length) return out

  const holeBoxes = holes.map((hole) => worldBox(hole, new THREE.Box3()))

  for (const object of objects) {
    if (object.hole) continue
    worldBox(object, _boxB)
    let near = null
    for (let i = 0; i < holes.length; i++) {
      if (!_boxB.intersectsBox(holeBoxes[i])) continue
      ;(near ??= []).push(holes[i])
    }
    if (near) out.set(object.id, near)
  }
  return out
}

/** Whether a hole has been combined, and so has done its job and stepped back. */
export const isFinished = (object) => Boolean(object.hole && object.parentGroupId)

// Words built while a typeface was still downloading are in the wrong face,
// and nothing about their parameters says so. See `shapes/fontStore`.
onFaceLoaded(() => forgetCutsOf('text'))
