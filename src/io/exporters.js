/**
 * Client-side export. The file is built in memory and handed to the browser
 * as a download — there is no server round-trip anywhere in here.
 *
 * The export scene is rebuilt from the plain scene JSON rather than lifted out
 * of the live viewport, so selection outlines, the grid and the gizmo can
 * never leak into the exported file.
 */
import * as THREE from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js'
import { acquireShape, cuttersByObject, relativeCutters, releaseShape } from '../shapes/csg'
import { cutForExport } from './solidCut'
import { fileFrom, shareFile } from './share'

/**
 * Build the export scene, plus the function that hands its geometries back.
 * Geometry is reference counted now, so an export has to let go of what it
 * borrowed — otherwise every export pins another copy of every shape.
 *
 * Anything with a hole in it is cut again on the way out. The cut the viewport
 * is drawing is the right shape but is not a properly joined solid, and a
 * slicer will not take it; `io/solidCut` explains why and what is done about
 * it. That is the one thing here that has to wait for something, which is what
 * makes this async.
 */
async function buildExportScene(objects, groups) {
  const root = new THREE.Group()
  root.name = 'BabyCAD'
  const borrowed = []
  const owned = []
  // Parts that had to fall back to the viewport's cut, which is the right
  // shape but not a solid a slicer will take. Counted so the person is told,
  // rather than being handed a file that quietly will not print.
  let rough = 0

  const groupNodes = new Map()
  for (const g of groups ?? []) {
    const node = new THREE.Group()
    node.name = `group-${g.id.slice(0, 8)}`
    groupNodes.set(g.id, node)
    root.add(node)
  }

  const cutters = cuttersByObject(objects, groups ?? [])

  for (const o of objects) {
    // A hole is a cutting tool, not a part. It shapes what it is combined with
    // and then has no business in the file — an exported hole would print as a
    // solid lump of exactly the thing it was there to remove.
    if (o.hole) continue

    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(o.color),
      roughness: 0.55,
      metalness: 0,
    })
    const holes = cutters.get(o.id) ?? null
    let geometry = holes?.length
      ? await cutForExport(o.type, o.params, relativeCutters(o, holes))
      : null
    if (geometry) owned.push(geometry)
    else {
      // Either nothing cuts this block, or rebuilding it properly did not come
      // off. Writing the viewport's own cut is what every earlier version did,
      // and is far better than leaving the part out of the file.
      geometry = acquireShape(o, holes)
      borrowed.push(geometry)
      if (holes?.length) rough++
    }
    if (isMirrored(o)) {
      const wound = reverseWinding(geometry)
      // The original is still the cache's or Manifold's; only the copy made
      // here belongs to the export and has to be let go of at the end.
      owned.push(wound)
      geometry = wound
    }
    const mesh = new THREE.Mesh(geometry, material)
    mesh.name = o.type
    mesh.position.fromArray(o.position)
    mesh.rotation.fromArray(o.rotation)
    mesh.scale.fromArray(o.scale)
    const parent = o.parentGroupId ? groupNodes.get(o.parentGroupId) : null
    ;(parent ?? root).add(mesh)
  }
  return {
    root,
    rough,
    done: () => {
      borrowed.forEach(releaseShape)
      owned.forEach((g) => g.dispose())
    },
  }
}

/**
 * Internal Y-up -> Z-up, for formats whose readers expect Z-up.
 *
 * `scene/axes` sets out the split: the scene graph is three.js-native Y-up,
 * while every axis the user is *shown* is named CAD-style Z-up. That naming
 * layer used to stop at the file, which is why a block sitting flat on the
 * plate arrived in the slicer standing on its edge.
 *
 * A +90 degree turn about X sends internal (x, y, z) to (x, -z, y) — exactly
 * the mapping AXES already describes: displayed X is internal x, displayed Y
 * is internal -z, displayed Z is internal y. So the file now agrees with the
 * numbers in the properties rail, rather than with the scene graph underneath.
 *
 * Only STL gets this. STL's own spec names no up axis, but every slicer ever
 * written treats +Z as up. glTF is the opposite case: its spec *mandates*
 * Y-up, so the internal frame is already right and turning it would be the bug.
 */
const Z_UP_X_ROTATION = Math.PI / 2

/**
 * The same triangles, wound the other way round.
 *
 * A mirrored block carries a negative number in its scale, because that is
 * what a reflection is. The renderer copes with that by itself — it flips
 * which way it considers a face to be pointing when a matrix turns space
 * inside out — but an exporter does not: it multiplies the corners through the
 * matrix and writes them down in the order they were already in, and that
 * order now runs the wrong way round the triangle. Every face of a mirrored
 * part would point into the solid, and a slicer reads that as a hole the size
 * of the model.
 *
 * Swapping two corners of each triangle before it goes out puts the winding
 * back, so the reflection and the fix cancel and the file is wound outward
 * like everything else in it.
 */
export function reverseWinding(geometry) {
  const out = geometry.index ? geometry.toNonIndexed() : geometry.clone()
  for (const name of Object.keys(out.attributes)) {
    const attribute = out.getAttribute(name)
    const size = attribute.itemSize
    const data = attribute.array
    // Second and third corner change places; the first stays where it is.
    for (let t = 0; t < attribute.count; t += 3) {
      for (let i = 0; i < size; i++) {
        const b = (t + 1) * size + i
        const c = (t + 2) * size + i
        const swap = data[b]
        data[b] = data[c]
        data[c] = swap
      }
    }
    attribute.needsUpdate = true
  }
  return out
}

/** A block is mirrored if its scale turns space inside out. */
const isMirrored = (object) => object.scale[0] * object.scale[1] * object.scale[2] < 0

function download(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Give the browser a beat to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/**
 * Ask where the file should go, before anything is built.
 *
 * Before, rather than after, because the picker needs the click that opened it
 * to still be fresh, and building the scene can take a moment — a die is cut
 * again with Manifold on the way out. Asked afterwards, a big build would
 * spend its activation and the picker would be refused.
 *
 * Returns a handle to write to, `null` where the browser has no picker and a
 * download is the answer, or `false` if the dialog was dismissed — which is
 * somebody changing their mind, not a failure.
 */
async function askWhere(filename, type, extension) {
  if (typeof window === 'undefined' || typeof window.showSaveFilePicker !== 'function') return null
  try {
    return await window.showSaveFilePicker({
      suggestedName: filename,
      types: [{ description: extension.slice(1).toUpperCase(), accept: { [type]: [extension] } }],
    })
  } catch (error) {
    if (error?.name === 'AbortError') return false
    // Any other trouble with the picker is not worth losing the export over;
    // fall back to a download, which always works.
    return null
  }
}

/**
 * Put the bytes where `askWhere` said — or, on a touch device, into the share
 * sheet.
 *
 * The share is offered after the file is built rather than before, which is
 * the opposite of what `askWhere` does and for the opposite reason: a picker
 * can be opened early and written to late, a share sheet needs the bytes in
 * hand. That costs it the tap's activation on a build slow enough to matter,
 * and a share refused on those grounds quietly becomes a download — see
 * io/share. Backing out of the sheet is a change of mind and says so.
 *
 * @returns 'saved' | 'shared' | 'downloaded' | null (dismissed)
 */
async function writeOut(handle, blob, filename, { share = false, type } = {}) {
  if (share && !handle) {
    const result = await shareFile(fileFrom(blob, filename, type), { title: filename })
    if (result === 'dismissed') return null
    if (result === 'shared') return 'shared'
  }
  if (!handle) {
    download(blob, filename)
    return 'downloaded'
  }
  const stream = await handle.createWritable()
  await stream.write(blob)
  await stream.close()
  return 'saved'
}

const safeName = (name) =>
  (name || 'babycad-build').trim().replace(/[^a-z0-9_-]+/gi, '-').replace(/^-|-$/g, '') ||
  'babycad-build'

/**
 * Primary export: binary glTF, which preserves colors and the scene graph.
 * Left in the internal Y-up frame on purpose — that is what the glTF spec asks
 * for. See `Z_UP_X_ROTATION`.
 */
export async function exportGLB(objects, groups, name, { share = false } = {}) {
  const filename = `${safeName(name)}.glb`
  // A share sheet wants the bytes, so there is nothing to ask first.
  const where = share ? null : await askWhere(filename, 'model/gltf-binary', '.glb')
  if (where === false) return null

  const { root, rough, done } = await buildExportScene(objects, groups)
  try {
    const bytes = await new Promise((resolve, reject) => {
      new GLTFExporter().parse(root, resolve, reject, { binary: true })
    })
    const how = await writeOut(where, new Blob([bytes], { type: 'model/gltf-binary' }), filename, {
      share,
      type: 'model/gltf-binary',
    })
    return how ? { rough, how } : null
  } finally {
    done()
  }
}

/**
 * Secondary export for 3D printing. STL carries geometry only, no color, and
 * is turned Z-up on the way out so it lands on the slicer's plate the way it
 * sat on the plate here. See `Z_UP_X_ROTATION`.
 */
export async function exportSTL(objects, groups, name, { share = false } = {}) {
  const filename = `${safeName(name)}.stl`
  const where = share ? null : await askWhere(filename, 'model/stl', '.stl')
  if (where === false) return null

  const { root, rough, done } = await buildExportScene(objects, groups)
  try {
    root.rotation.x = Z_UP_X_ROTATION
    root.updateMatrixWorld(true)
    const stl = new STLExporter().parse(root, { binary: true })
    const how = await writeOut(where, new Blob([stl], { type: 'model/stl' }), filename, {
      share,
      type: 'model/stl',
    })
    return how ? { rough, how } : null
  } finally {
    done()
  }
}
