/**
 * Where an imported model's triangles live.
 *
 * Every other shape in this app is rebuilt from numbers: a cube is its width,
 * height and depth, and the geometry is thrown away and made again whenever
 * one of them changes. An imported STL has no numbers to be rebuilt from —
 * the triangles *are* the shape — so they have to be kept somewhere, and that
 * somewhere cannot be the object's parameters. A parameter list is compared,
 * hashed and used as a cache key on every frame, and doing any of that to two
 * megabytes of vertices would be a disaster.
 *
 * So an object keeps a short id and the triangles live here, in a map beside
 * the scene rather than inside it. `io/persistence` writes the ones a build
 * actually refers to into its file and registers them again on the way back
 * in, which is what makes a `.babycad` with an imported part self-contained:
 * send it to somebody and it opens as you saw it, with no second file to find.
 *
 * Stored as positions only, deliberately. Normals are recomputed on load —
 * they are derivable, and derivable data in a file is a chance for the file to
 * disagree with itself. Colours and materials are dropped on import: a part
 * here takes a swatch like every other block.
 */
import * as THREE from 'three'

/** id -> { name, positions: Float32Array, triangles } */
const meshes = new Map()

/** A short, stable id. Content-addressed, so importing the same file twice
 *  costs one copy in the file rather than two. */
function hashOf(positions) {
  // FNV-1a over the bytes, which is enough to tell two models apart and cheap
  // enough to run on a few million floats without anybody noticing.
  const bytes = new Uint8Array(positions.buffer, positions.byteOffset, positions.byteLength)
  let h = 0x811c9dc5
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i]
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36) + bytes.length.toString(36)
}

/** Take a geometry into the store and hand back the id an object refers to. */
export function registerMesh(name, positions) {
  const id = hashOf(positions)
  if (!meshes.has(id)) {
    meshes.set(id, { name, positions, triangles: positions.length / 9 })
  }
  return id
}

export const meshInfo = (id) => meshes.get(id) ?? null
export const hasMesh = (id) => meshes.has(id)

/**
 * The geometry for an id, as a fresh object each time.
 *
 * A copy rather than the stored one because the geometry cache owns what it is
 * given: it reference counts it and disposes it when the last block using it
 * goes away, which would take the master copy with it and leave every other
 * block referring to a model that no longer exists.
 */
export function geometryFor(id) {
  const entry = meshes.get(id)
  const g = new THREE.BufferGeometry()
  // An id with nothing behind it draws nothing rather than throwing: a file
  // hand-edited to refer to a missing model should open, not fail.
  const positions = entry ? entry.positions.slice() : new Float32Array(0)
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  if (positions.length) g.computeVertexNormals()
  g.computeBoundingBox()
  return g
}

/* ------------------------------------------------------------ the file -- */

/**
 * Float32Array <-> base64. JSON has no way to say "a few hundred thousand
 * floats" that is not a few hundred thousand decimal strings, which is several
 * times the size and loses the last bits of precision on the way. Base64 of
 * the raw bytes is exact and about a third the size of the number list.
 */
function toBase64(floats) {
  const bytes = new Uint8Array(floats.buffer, floats.byteOffset, floats.byteLength)
  let binary = ''
  // In chunks: `String.fromCharCode(...bytes)` on a million-element array
  // overflows the argument stack.
  const step = 0x8000
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step))
  }
  return btoa(binary)
}

function fromBase64(text) {
  const binary = atob(text)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  // The byte length must divide into whole floats, and whole triangles.
  if (bytes.length % 12 !== 0) return null
  return new Float32Array(bytes.buffer, 0, bytes.length / 4)
}

/** The stored models a set of objects actually refers to, ready for a file. */
export function meshesFor(objects) {
  const out = {}
  for (const o of objects ?? []) {
    const id = o?.params?.mesh
    if (!id || out[id]) continue
    const entry = meshes.get(id)
    if (entry) out[id] = { name: entry.name, positions: toBase64(entry.positions) }
  }
  return out
}

/** Put a file's models back in the store. Returns how many arrived. */
export function adoptMeshes(stored) {
  if (!stored || typeof stored !== 'object') return 0
  let n = 0
  for (const [id, entry] of Object.entries(stored)) {
    if (meshes.has(id) || typeof entry?.positions !== 'string') continue
    const positions = fromBase64(entry.positions)
    if (!positions || !positions.length) continue
    meshes.set(id, {
      name: typeof entry.name === 'string' ? entry.name : 'Model',
      positions,
      triangles: positions.length / 9,
    })
    n++
  }
  return n
}
