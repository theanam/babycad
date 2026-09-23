/**
 * Bringing somebody else's model onto the plate.
 *
 * Three formats, all of them printing formats and all of them plain geometry,
 * which is what this app is made of: STL, OBJ and 3MF. What arrives is
 * triangles and nothing else — colours, materials and any scene graph are
 * dropped on the way in, because a block here takes a swatch like every other
 * block and has one transform of its own.
 *
 * Everything is flattened to a single position array in one pass:
 *
 *  - **Every mesh in the file, baked into one.** An OBJ or a 3MF can hold
 *    dozens of parts in a tree of transforms. Keeping that tree would mean
 *    teaching the whole app about nested objects; baking each part's world
 *    matrix into its vertices gives one block that behaves like every other.
 *  - **Non-indexed.** An index buffer would have to be stored too, and the
 *    saving is not worth a second array in the file.
 *  - **Centred on its own middle**, because every builder here returns
 *    geometry centred on the origin, and `restingHeight` is what then sets it
 *    down on the plate. A model that kept the file's origin would arrive
 *    somewhere off the yard as often as not.
 *
 * Units are taken as millimetres, which is what STL and 3MF are written in and
 * what this app measures in. Nothing is scaled: a part that comes in the wrong
 * size was the wrong size, and the gizmo can rescale it.
 *
 * **Which way is up depends on the format.** STL and 3MF are printing formats
 * and are written Z-up, the way a slicer reads them; the scene graph here is
 * three.js-native Y-up (see `scene/axes`). So those two are turned a quarter
 * circle on the way in, which is exactly the turn `io/exporters` applies on the
 * way out, read backwards: a file's (X, Y, Z) is this scene's (X, Z, −Y). Skip
 * it and a printable part arrives lying on its side. OBJ is left alone,
 * because OBJ is conventionally Y-up already.
 */
import * as THREE from 'three'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { ThreeMFLoader } from 'three/examples/jsm/loaders/3MFLoader.js'
import { registerMesh } from '../shapes/meshStore'

export const MODEL_EXTENSIONS = ['.stl', '.obj', '.3mf']

/** Past this a model is more triangles than the rest of a build put together. */
const BUSY_TRIANGLES = 250_000

const extensionOf = (name) => {
  const at = String(name ?? '').lastIndexOf('.')
  return at < 0 ? '' : name.slice(at).toLowerCase()
}

/** Parse one file's bytes into whatever three hands back for that format. */
function parse(extension, buffer, name) {
  if (extension === '.stl') return new STLLoader().parse(buffer)
  if (extension === '.3mf') return new ThreeMFLoader().parse(buffer)
  if (extension === '.obj') return new OBJLoader().parse(new TextDecoder().decode(buffer))
  throw new Error(`${name}: not a kind of model this can open`)
}

/** Every triangle in a parsed result, in world space, as one position array. */
function flatten(parsed) {
  const chunks = []
  let total = 0

  const take = (geometry, matrix) => {
    let g = geometry
    if (g.getIndex()) g = g.toNonIndexed()
    const position = g.getAttribute('position')
    if (!position) return
    const floats = new Float32Array(position.count * 3)
    const v = new THREE.Vector3()
    for (let i = 0; i < position.count; i++) {
      v.fromBufferAttribute(position, i)
      if (matrix) v.applyMatrix4(matrix)
      floats[i * 3] = v.x
      floats[i * 3 + 1] = v.y
      floats[i * 3 + 2] = v.z
    }
    if (g !== geometry) g.dispose()
    chunks.push(floats)
    total += floats.length
  }

  if (parsed?.isBufferGeometry) {
    take(parsed, null)
  } else if (parsed?.isObject3D) {
    parsed.updateMatrixWorld(true)
    parsed.traverse((node) => {
      if (node.isMesh && node.geometry) take(node.geometry, node.matrixWorld)
    })
  }

  if (!total) return null
  const all = new Float32Array(total)
  let at = 0
  for (const chunk of chunks) {
    all.set(chunk, at)
    at += chunk.length
  }
  return all
}

/**
 * Z-up into Y-up, in place: (X, Y, Z) becomes (X, Z, −Y).
 *
 * The inverse of the turn the STL exporter applies, so a part exported from
 * here and brought straight back in stands the same way up it started.
 */
function zUpToYUp(positions) {
  for (let i = 0; i < positions.length; i += 3) {
    const y = positions[i + 1]
    positions[i + 1] = positions[i + 2]
    positions[i + 2] = -y
  }
}

/** Move the triangles so their own middle is the origin. */
function centre(positions) {
  const box = new THREE.Box3()
  const v = new THREE.Vector3()
  for (let i = 0; i < positions.length; i += 3) {
    box.expandByPoint(v.set(positions[i], positions[i + 1], positions[i + 2]))
  }
  const mid = box.getCenter(new THREE.Vector3())
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] -= mid.x
    positions[i + 1] -= mid.y
    positions[i + 2] -= mid.z
  }
  return box.getSize(new THREE.Vector3())
}

/**
 * Read one file into the mesh store.
 *
 * Returns what the caller needs to place it and to say what happened:
 * `{ id, name, triangles, size, busy }`, or throws with a message worth
 * showing somebody.
 */
export async function readModelFile(file) {
  const extension = extensionOf(file.name)
  if (!MODEL_EXTENSIONS.includes(extension)) {
    throw new Error(`${file.name} is not an STL, OBJ or 3MF`)
  }
  const buffer = await file.arrayBuffer()
  let parsed
  try {
    parsed = parse(extension, buffer, file.name)
  } catch (error) {
    throw new Error(`${file.name} could not be read — ${error.message ?? 'it may be damaged'}`)
  }

  const positions = flatten(parsed)
  if (!positions) throw new Error(`${file.name} has no triangles in it`)
  // A stray vertex would make the whole model unbuildable, so it is caught
  // here rather than left to surface as an invisible block.
  for (let i = 0; i < positions.length; i++) {
    if (!Number.isFinite(positions[i])) throw new Error(`${file.name} has broken coordinates in it`)
  }

  // OBJ is already the way up this scene works in; the two printing formats
  // are not.
  if (extension !== '.obj') zUpToYUp(positions)

  const size = centre(positions)
  const triangles = positions.length / 9
  return {
    id: registerMesh(file.name, positions),
    name: file.name,
    triangles,
    size,
    busy: triangles > BUSY_TRIANGLES,
  }
}

/** Ask for model files. Returns [] if the picker was dismissed. */
export async function pickModelFiles() {
  if (typeof window !== 'undefined' && window.showOpenFilePicker) {
    try {
      const handles = await window.showOpenFilePicker({
        multiple: true,
        types: [
          {
            description: 'Models',
            accept: { 'model/stl': ['.stl'], 'model/3mf': ['.3mf'], 'text/plain': ['.obj'] },
          },
        ],
      })
      return Promise.all(handles.map((h) => h.getFile()))
    } catch (error) {
      if (error?.name === 'AbortError') return []
      throw error
    }
  }

  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = MODEL_EXTENSIONS.join(',')
    input.multiple = true
    const done = () => {
      const files = [...(input.files ?? [])]
      input.remove()
      resolve(files)
    }
    input.addEventListener('change', done, { once: true })
    input.addEventListener('cancel', () => {
      input.remove()
      resolve([])
    }, { once: true })
    input.click()
  })
}
