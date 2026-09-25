/**
 * Cutting holes out of solids.
 *
 * A block is either a solid or a hole, and a hole cuts every solid it reaches
 * into — straight away, while you are still pushing it around. Drop a tube
 * through a cube and the cube has a tube-shaped hole in it.
 *
 * The cutting happens off the main thread. While a hole is being dragged the
 * block shows the last cut it had, or its plain shape the first time, and the
 * hole is its grey ghost; the subtraction runs in a worker (`cutWorker`) and
 * the block takes the result when it lands. On a cube and a tube that is a
 * frame or two. On an imported model it can be minutes — the cost of a cut
 * grows with about the 1.9th power of the triangle count on a hollow part —
 * and the tab keeps answering throughout, which is the whole reason for the
 * worker: before it, each of those minutes was the tab locked solid, on every
 * nudge of the hole.
 *
 * `Combine` is where a hole settles. Once combined it cuts its own piece —
 * the solids it was combined with, up to the top group — and nothing else,
 * however far it reaches into the block next door. It stops being drawn, so
 * what is left on screen is the solid with the bite taken out of it. Split
 * apart and the ghost comes back, cutting as a loose hole does, free to move.
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
 *
 * There is still a synchronous path — `acquireShape` — for the exporter's
 * fallback and for the checks, which run under Node and have no worker. Both
 * paths call the same `cutArrays`, so they cannot disagree about the shape.
 */
import * as THREE from 'three'
import { acquireGeometry, measured, releaseGeometry } from './geometryCache'
import { keyOfParams } from './index'
import { onFaceLoaded } from './fontStore'
import { arraysOf, cutArrays } from './cutCore'
import { submitCut } from './cutQueue'
import { mark, trace } from '../debug/trace'

const IDLE_MAX = 24

/**
 * Past this, a synchronous cut is written to the console with its size and
 * cost. Only the synchronous path can stall the tab now, and it only runs for
 * an export whose Manifold cut was refused — but that is exactly the moment
 * to know about.
 */
const SLOW_CUT_MS = 500

/** Triangles in a shape, straight off the cache. */
function triangleCount(object) {
  const geometry = acquireGeometry(object.type, object.params)
  const n = (geometry.getAttribute('position')?.count ?? 0) / 3
  releaseGeometry(geometry)
  return n
}

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

/** A geometry's arrays, as fresh copies, borrowed from the shape cache. */
function arraysFor(type, params) {
  const geometry = acquireGeometry(type, params)
  const out = arraysOf(geometry)
  releaseGeometry(geometry)
  return out
}

/** A geometry back from the worker's arrays, measured and ready to draw. */
function geometryFromArrays({ positions, normals }) {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  if (normals?.length === positions.length) g.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
  else g.computeVertexNormals()
  // A hole can be bigger than the thing it cuts, and then there is nothing
  // left: an empty geometry, whose box measures from +infinity to -infinity.
  // Align, the clearance readout and the gizmo all read that box, and the
  // first arithmetic any of them does on it is NaN. See `measured`.
  return measured(g)
}

/**
 * The cut, synchronously, on this thread. The exporter's fallback and the
 * checks; nothing that draws while you watch.
 */
function buildCut(object, holes) {
  const started = performance.now()
  const cutters = relativeCutters(object, holes).map(({ hole, matrix }) => ({
    ...arraysFor(hole.type, hole.params),
    matrix: matrix.toArray(),
  }))
  const cut = geometryFromArrays(cutArrays(arraysFor(object.type, object.params), cutters))
  const ms = performance.now() - started
  if (ms > SLOW_CUT_MS) {
    console.warn(
      `[babycad] cutting a ${object.type} (${triangleCount(object).toLocaleString()} triangles) ` +
        `with ${holes.length} hole${holes.length === 1 ? '' : 's'} took ${(ms / 1000).toFixed(1)}s ` +
        `on the main thread`
    )
  }
  return cut
}

/** Take a reference on a cache entry, lifting it out of the idle pool. */
function take(entry) {
  if (entry.refs === 0) {
    const at = idle.indexOf(entry.key)
    if (at !== -1) idle.splice(at, 1)
  }
  entry.refs++
  return entry.geometry
}

/** Put a finished cut in the cache. Refs start at zero; the next acquire takes one. */
function remember(key, geometry) {
  const entry = { key, geometry, refs: 0 }
  entries.set(key, entry)
  byGeometry.set(geometry, entry)
  return entry
}

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

/**
 * The geometry a block should be drawn with, synchronously: its plain shape
 * when nothing cuts it, and the cut — built here and now, on this thread —
 * when something does. For the exporter's fallback and the checks. The
 * viewport uses `acquireShapeLive`. Release either with `releaseShape`.
 */
export function acquireShape(object, holes) {
  const near = object.hole || !holes?.length ? [] : holes
  if (!near.length) return acquireGeometry(object.type, object.params)

  const key = cutKey(object, near)
  let entry = entries.get(key)
  if (entry) mark(`cut cached: ${object.type} with ${near.length} hole(s)`)
  if (!entry) {
    entry = remember(
      key,
      trace(
        `buildCut(${object.type}, ${triangleCount(object).toLocaleString()} tris, ${near.length} hole(s))`,
        () => buildCut(object, near)
      )
    )
  }
  return take(entry)
}

/* --------------------------------------------------- the live path -- */

/** Cut keys the worker is on, or has been asked for. */
const pending = new Set()
/** The cut each block last showed, so a block catches up rather than flashes. */
const lastShown = new Map() // objectId -> key
/** The cut each block last asked for, so a result nobody wants goes to idle. */
const lastWanted = new Map() // objectId -> key
/**
 * Solid geometries the worker gave up on — the clock ran out, or the worker
 * itself fell over. Keyed on the solid alone rather than the cut: a model that
 * cannot be cut in two minutes cannot be cut in two minutes wherever the hole
 * is, and trying again on every nudge would burn a core for nothing.
 */
const hopeless = new Set() // solid geometry key
/** Blocks whose latest cut could not be done, for the chrome to say so. */
const failedSolids = new Set() // objectId
const listeners = new Set()

/**
 * Hear when a cut lands, or fails. `cb({ objectId, key, failed })`. Returns
 * the unsubscribe. A block subscribes for its own id and re-reads its geometry.
 */
export function onCutReady(cb) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}
const announce = (objectId, key, failed = false) => {
  for (const cb of listeners) cb({ objectId, key, failed })
}

/** Whether this block's most recent cut could not be done. */
export const cutFailedFor = (objectId) => failedSolids.has(objectId)

function schedule(key, object, near) {
  if (pending.has(key)) return
  pending.add(key)
  lastWanted.set(object.id, key)
  const solidKey = keyOfParams(object.type, object.params)
  const providers = new Map([[solidKey, () => arraysFor(object.type, object.params)]])
  const holes = relativeCutters(object, near).map(({ hole, matrix }) => {
    const k = keyOfParams(hole.type, hole.params)
    providers.set(k, () => arraysFor(hole.type, hole.params))
    return { key: k, matrix: matrix.toArray() }
  })
  mark(`cut scheduled: ${object.type} (${triangleCount(object).toLocaleString()} tris) with ${near.length} hole(s)`)
  const started = performance.now()

  submitCut({ key, objectId: object.id, solidKey, holes, arraysFor: (k) => providers.get(k)() })
    .then((arrays) => {
      pending.delete(key)
      mark(`cut landed: ${object.type} after ${((performance.now() - started) / 1000).toFixed(2)}s`)
      if (!entries.has(key)) {
        const entry = remember(key, geometryFromArrays(arrays))
        // A result nobody is waiting for any more — the hole moved on — goes
        // straight to the idle pool, so it can be reused if the hole comes
        // back and let go of if it does not.
        if (lastWanted.get(object.id) !== key) {
          idle.push(key)
          while (idle.length > IDLE_MAX) {
            const dead = entries.get(idle.shift())
            if (!dead || dead.refs > 0) continue
            entries.delete(dead.key)
            dead.geometry.dispose()
          }
          return
        }
        void entry
      }
      failedSolids.delete(object.id)
      announce(object.id, key)
    })
    .catch((error) => {
      pending.delete(key)
      if (error?.superseded) return // a newer request for the same block replaced it
      mark(`cut failed: ${object.type} — ${error?.message}`)
      if (error?.timeout || /worker stopped/.test(error?.message ?? '')) hopeless.add(solidKey)
      failedSolids.add(object.id)
      announce(object.id, key, true)
    })
}

/**
 * The geometry a block should be drawn with, right now, without waiting.
 *
 * Its plain shape when nothing cuts it. The cut, when one is cached. And when
 * the cut it needs has not been made yet, the cut it last showed — so a block
 * with a hole being dragged through it catches up with the hole rather than
 * flashing whole between one position and the next — or its plain shape the
 * first time. Asking is what starts the worker on it; `onCutReady` says when
 * to ask again.
 */
export function acquireShapeLive(object, holes) {
  const near = object.hole || !holes?.length ? [] : holes
  if (!near.length) {
    lastShown.delete(object.id)
    lastWanted.delete(object.id)
    failedSolids.delete(object.id)
    return acquireGeometry(object.type, object.params)
  }

  const key = cutKey(object, near)
  const entry = entries.get(key)
  if (entry) {
    lastShown.set(object.id, key)
    lastWanted.set(object.id, key)
    return take(entry)
  }

  if (hopeless.has(keyOfParams(object.type, object.params))) {
    failedSolids.add(object.id)
  } else {
    schedule(key, object, near)
  }

  const shown = lastShown.get(object.id)
  const previous = shown && entries.get(shown)
  if (previous) return take(previous)
  return acquireGeometry(object.type, object.params)
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

/** The top of a group's ancestry, so nested combines count as one piece. */
function rootGroupOf(groupId, groups) {
  const byId = new Map(groups.map((g) => [g.id, g]))
  let g = byId.get(groupId)
  let guard = 0
  while (g?.parentGroupId && byId.has(g.parentGroupId) && guard++ < 64) g = byId.get(g.parentGroupId)
  return g?.id ?? groupId
}

/**
 * Which holes cut which solids, worked out once for the whole scene.
 *
 * Two rules, and one mode:
 *
 *   - A loose hole cuts every solid it overlaps. That is the trick the app is
 *     built around, and now that the cut runs off the main thread it holds
 *     for an imported model too.
 *   - A combined hole cuts its own piece — the solids in the same top group —
 *     and nothing outside it, however far it reaches. `groups` is what says
 *     which piece is which.
 *   - `loose` mode pairs by overlap alone, whatever is combined with what. The
 *     example builder uses it to *find* the groups it is about to make — it
 *     has holes sitting in blocks and no groups yet, and "which does this hole
 *     reach into" is exactly the question. Nothing that draws or exports
 *     should ask it.
 *
 * Boxes first, and only then geometry: ten holes among a hundred blocks is a
 * thousand pairs, and all but a handful of them are nowhere near each other.
 * A pair whose bounding boxes miss cannot possibly intersect, and that test is
 * two comparisons per axis against a subtraction that is thousands of
 * triangles of work.
 *
 * Solids only — a hole is never cut, by another hole or by itself.
 */
export function cuttersByObject(objects, groups = [], { loose = false } = {}) {
  return trace('cuttersByObject', () => cuttersNow(objects, groups, loose))
}

function cuttersNow(objects, groups, loose) {
  const holes = objects.filter((o) => o.hole)
  const out = new Map()
  if (!holes.length) return out

  const pieceOf = (o) => (o.parentGroupId ? rootGroupOf(o.parentGroupId, groups) : null)
  const holePieces = holes.map(pieceOf)
  const holeBoxes = holes.map((hole) => worldBox(hole, new THREE.Box3()))

  for (const object of objects) {
    if (object.hole) continue
    const piece = pieceOf(object)
    worldBox(object, _boxB)
    let near = null
    for (let i = 0; i < holes.length; i++) {
      // Combined: its own piece, and only that. Loose: anything it reaches.
      if (!loose && holePieces[i] && holePieces[i] !== piece) continue
      if (!_boxB.intersectsBox(holeBoxes[i])) continue
      ;(near ??= []).push(holes[i])
    }
    if (near) out.set(object.id, near)
  }
  return out
}

/**
 * Whether a hole has been combined, and so has done its job and stepped back.
 *
 * `cutting` says whether the cut it was combined for actually happened. It
 * usually did, and then the hole gets out of the way and leaves the solid with
 * the bite taken out of it. Where the solid was too detailed to cut live it
 * did not, and a hole that hid anyway would leave a block that looks whole,
 * with nothing on screen to say a hole is in it and nothing left to select.
 * It stays visible instead, which is exactly what an uncombined hole looks
 * like, and is the truth: the cut is waiting for the export.
 */
export const isFinished = (object, cutting = true) =>
  Boolean(object.hole && object.parentGroupId && cutting)

// Words built while a typeface was still downloading are in the wrong face,
// and nothing about their parameters says so. See `shapes/fontStore`.
onFaceLoaded(() => forgetCutsOf('text'))
