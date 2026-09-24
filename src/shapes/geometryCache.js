/**
 * Geometry cache, keyed on shape type *and* parameters.
 *
 * Before shapes had parameters this was one geometry per type, built once and
 * kept forever. That no longer works: dragging a slider mints a new geometry
 * every frame, and a geometry that is dropped without `dispose()` leaves its
 * buffers on the GPU until the tab closes.
 *
 * So entries are reference counted. A scene object holds a reference for as
 * long as it is mounted with those parameters; when the last holder lets go
 * the entry moves to a small idle pool, where it survives long enough for an
 * undo or a slider nudged back where it was to reuse it, and is disposed once
 * it falls out of the pool.
 */
import * as THREE from 'three'
import { getShapeDef, keyOfParams, normalizeParams } from './index'
import { onFaceLoaded } from './fontStore'

const IDLE_MAX = 48

const entries = new Map() // key -> { key, geometry, refs }
const byGeometry = new WeakMap() // geometry -> entry
const idle = [] // keys with no holders, oldest first

/**
 * A block with no shape to it: valid, measurable, and nothing to draw.
 *
 * Handed back when a builder cannot make anything — words in a face that has
 * no glyph for them, or a builder that threw. It has a real position attribute
 * with nothing in it and a box of zero size at the origin, so everything that
 * measures a shape keeps working: the block still sits on the plate at height
 * nought, still appears in the panel, and can still be selected, retyped or
 * deleted. What it must not be is a geometry with no attributes at all, which
 * is what an empty `BufferGeometry` is — the first thing to ask that for its
 * vertex count brings the app down.
 */
function nothingToDraw() {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3))
  return geometry
}

/**
 * Build one, uncached and unowned. The caller disposes it.
 *
 * A builder is the one place in this app where somebody else's data — a
 * typeface off the internet, a model out of a file — meets code that runs
 * inside a render. A throw here used to unmount everything: picking one of
 * three particular Google fonts took the whole app down, because opentype.js
 * throws on a substitution table it has not implemented. Shapes are
 * independent of one another, so one that cannot be built is one bad block,
 * not a bad session. The block comes back empty and the rest of the build is
 * left alone.
 */
export function buildGeometry(type, params) {
  const def = getShapeDef(type)
  let geometry
  try {
    geometry = def.build(normalizeParams(def.type, params))
    if (!geometry?.getAttribute?.('position')) {
      geometry?.dispose?.()
      geometry = nothingToDraw()
    }
  } catch (error) {
    console.error(`BabyCAD could not build a ${type}:`, error)
    geometry = nothingToDraw()
  }

  return measured(geometry)
}

/**
 * Give a geometry its bounds, and never infinite ones.
 *
 * An empty geometry measures as a box from +infinity to -infinity, and that
 * spreads: anything that reads the box gets NaN out of it — `restingHeight`
 * turns it into a NaN position, and a block with a NaN transform takes the
 * renderer with it. Every arrangement that reads bounds is downstream of this,
 * so the infinity is stopped here rather than guarded against in each of them.
 *
 * Exported because there are two ways to arrive at an empty geometry and they
 * are in different files: a builder that produced nothing (just above), and a
 * hole big enough to swallow the solid it is cutting, which leaves a cut with
 * no triangles in it at all (`shapes/csg`). Both have to be pinned, and a
 * second copy of the reasoning is a second chance to fix only one of them.
 */
export function measured(geometry) {
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  const box = geometry.boundingBox
  if (!box || !Number.isFinite(box.min.x) || !Number.isFinite(box.max.x)) {
    box?.min.set(0, 0, 0)
    box?.max.set(0, 0, 0)
    if (geometry.boundingSphere) geometry.boundingSphere.radius = 0
  }
  return geometry
}

/**
 * Forget every cached geometry of one type, so the next ask rebuilds it.
 *
 * For things that change what a shape *is* without changing any of its
 * parameters — a typeface arriving after the words were first drawn. The key
 * is built from the parameters, so without this the cache would hand back the
 * letters in the fallback face forever, and only editing the words would look
 * like it fixed the typeface.
 *
 * Entries still held by something on screen are dropped from the map but not
 * disposed: their holders are still drawing them, and will release them in the
 * usual way. Only the lookup is forgotten.
 */
export function forgetType(type) {
  for (const key of [...entries.keys()]) {
    if (!key.startsWith(type)) continue
    const entry = entries.get(key)
    entries.delete(key)
    const at = idle.indexOf(key)
    if (at !== -1) idle.splice(at, 1)
    if (entry && entry.refs === 0) entry.geometry.dispose()
  }
}

export function acquireGeometry(type, params) {
  const key = keyOfParams(type, params)
  let entry = entries.get(key)
  if (!entry) {
    entry = { key, geometry: buildGeometry(type, params), refs: 0 }
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

export function releaseGeometry(geometry) {
  const entry = geometry && byGeometry.get(geometry)
  if (!entry || entry.refs === 0) return
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
 * Read a measurement without taking a lasting reference. Goes through the
 * cache, so repeated calls during placement don't rebuild anything.
 */
export function measure(type, params) {
  const geometry = acquireGeometry(type, params)
  const box = geometry.boundingBox
  const out = { min: box.min.clone(), max: box.max.clone() }
  releaseGeometry(geometry)
  return out
}

/**
 * How far the shape reaches below its own origin — i.e. how high to place it
 * so it sits flat on the floor. Not simply half the height: a shape is only
 * centred on its origin if its builder made it so.
 */
export function restingHeight(type, params) {
  return -measure(type, params).min.y
}

// Words built while a typeface was still downloading are in the wrong face,
// and nothing about their parameters says so. See `shapes/fontStore`.
onFaceLoaded(() => forgetType('text'))
