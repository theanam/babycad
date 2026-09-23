/**
 * Rebuilding a cut solid, for the file rather than for the screen.
 *
 * `shapes/csg` cuts holes with three-bvh-csg, which is quick enough to run
 * while a hole is still being dragged about. What it hands back is the right
 * *shape* — measure the volume of a die and it is right to four figures — but
 * not a properly built solid. Where a pip breaks through a face, that face is
 * re-tiled around the rim of the hole and the tiling does not meet the
 * triangles already along the edge of the face: one side of the join is a run
 * of small triangles, the other is one long one going straight past them.
 *
 * That is a T-junction. Nothing leaks through it, so a renderer does not care
 * and the app looked right. A slicer cares a great deal: it rebuilds solid
 * from shared edges, and an edge with a face on only one side is a hole in the
 * model as far as it is concerned. An exported die had four thousand of them
 * and would not print.
 *
 * Patching that after the fact does not really work — the rim comes back
 * strewn with slivers a hundredth of a millimetre across, and splitting
 * triangles around those makes more mess than it clears. So the export does
 * the cutting again, with Manifold, which is built around the guarantee the
 * file needs: its output is always a closed, properly joined solid. It costs a
 * WASM module and about a tenth of a second for a whole die, which is nothing
 * for something that happens when you press Save.
 *
 * The viewport keeps the old cut. It is faster, it is already there, and on
 * screen a T-junction is invisible.
 */
import * as THREE from 'three'
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { acquireGeometry, releaseGeometry } from '../shapes/geometryCache'

/**
 * Past this angle between two faces, the edge between them is a real edge and
 * is shaded as one. Below it the two are the same curved surface. 50 degrees
 * sits well clear of both cases: a cube's corners are 90, and a tube with as
 * few as twelve sides only bends 30 at a time.
 */
const CREASE = (50 * Math.PI) / 180

let loading = null

/**
 * Where the WASM file is.
 *
 * Left to itself the module looks for `manifold.wasm` beside its own script,
 * which is right under node and wrong in the browser: the bundler moves the
 * script and gives the wasm a fingerprinted name, so the lookup lands on a URL
 * that is not there. A dev server answers a miss with the app's own index.html,
 * so what came back was a page of HTML being fed to the WebAssembly compiler —
 * it failed, the export quietly fell back to the viewport's cut, and the file
 * was as broken as before while still saying it had downloaded. Asking the
 * bundler where it actually put the file is the whole fix.
 */
async function wasmPath() {
  // `import.meta.env` is the bundler's; under node there is none, and the
  // module's own guess is correct there.
  if (typeof import.meta.env === 'undefined') return null
  const asset = await import('manifold-3d/manifold.wasm?url')
  return asset.default
}

/** The WASM module, started on first use and then kept. */
function manifold() {
  if (!loading) {
    loading = Promise.all([import('manifold-3d'), wasmPath()])
      .then(([m, url]) => (m.default ?? m)(url ? { locateFile: () => url } : {}))
      .then((wasm) => {
        wasm.setup()
        return wasm
      })
      .catch((error) => {
        // Let the next export try again rather than failing for the session.
        loading = null
        throw error
      })
  }
  return loading
}

/** A three geometry as a Manifold solid, welded so its corners are shared. */
function asManifold(wasm, geometry, matrix) {
  const flat = geometry.getIndex() ? geometry.toNonIndexed() : geometry
  const pos = flat.getAttribute('position')
  const points = new Float32Array(pos.count * 3)
  const v = new THREE.Vector3()
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i)
    if (matrix) v.applyMatrix4(matrix)
    points[i * 3] = v.x
    points[i * 3 + 1] = v.y
    points[i * 3 + 2] = v.z
  }
  const triangles = new Uint32Array(pos.count)
  for (let i = 0; i < pos.count; i++) triangles[i] = i
  const mesh = new wasm.Mesh({ numProp: 3, vertProperties: points, triVerts: triangles })
  // Our shapes arrive as loose triangles — three builds a cube's corner three
  // times over, once per face. Manifold wants them joined up before it will
  // treat the thing as a solid.
  mesh.merge()
  if (flat !== geometry) flat.dispose()
  return new wasm.Manifold(mesh)
}

/** A Manifold solid back as a three geometry, shaded. */
function asGeometry(solid) {
  const mesh = solid.getMesh()
  const stride = mesh.numProp
  const count = mesh.vertProperties.length / stride
  const points = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    points[i * 3] = mesh.vertProperties[i * stride]
    points[i * 3 + 1] = mesh.vertProperties[i * stride + 1]
    points[i * 3 + 2] = mesh.vertProperties[i * stride + 2]
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(points, 3))
  geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(mesh.triVerts), 1))
  // Manifold hands back geometry only. Shading it by the angle between faces
  // keeps a ball round and a cube's corners sharp, which is what the cut
  // geometry it replaces was carrying in its own normals.
  const shaded = toCreasedNormals(geometry, CREASE)
  geometry.dispose()
  return shaded
}

/**
 * The geometry to write out for one solid: the shape with its holes taken out
 * of it, built as a solid a slicer will accept. `holes` is what
 * `cuttersByObject` gave for this block, each with the transform that puts it
 * where it sits relative to the block — the same arrangement `shapes/csg` cuts
 * with, so the result lands in the same place.
 *
 * Returns null if Manifold cannot be loaded or will not accept the shapes, and
 * the caller falls back to the viewport's own cut: a file with T-junctions in
 * it is worth having, and is what every earlier version wrote.
 */
export async function cutForExport(type, params, holes) {
  let wasm
  try {
    wasm = await manifold()
  } catch {
    return null
  }

  const borrowed = []
  const solids = []
  try {
    const base = acquireGeometry(type, params)
    borrowed.push([type, params, base])
    let result = asManifold(wasm, base, null)
    solids.push(result)

    for (const { hole, matrix } of holes) {
      const geometry = acquireGeometry(hole.type, hole.params)
      borrowed.push([hole.type, hole.params, geometry])
      const cutter = asManifold(wasm, geometry, matrix)
      solids.push(cutter)
      result = result.subtract(cutter)
      solids.push(result)
    }

    // An empty result means the holes ate the whole block, which is a real
    // answer, but there is nothing to write and nothing to check.
    if (result.isEmpty()) return null
    return asGeometry(result)
  } catch {
    return null
  } finally {
    for (const solid of solids) solid.delete?.()
    for (const [, , geometry] of borrowed) releaseGeometry(geometry)
  }
}
