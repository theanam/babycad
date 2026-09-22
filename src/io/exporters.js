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
import { acquireShape, cuttersByObject, releaseShape } from '../shapes/csg'

/**
 * Build the export scene, plus the function that hands its geometries back.
 * Geometry is reference counted now, so an export has to let go of what it
 * borrowed — otherwise every export pins another copy of every shape.
 */
function buildExportScene(objects, groups) {
  const root = new THREE.Group()
  root.name = 'BabyCAD'
  const borrowed = []

  const groupNodes = new Map()
  for (const g of groups ?? []) {
    const node = new THREE.Group()
    node.name = `group-${g.id.slice(0, 8)}`
    groupNodes.set(g.id, node)
    root.add(node)
  }

  const cutters = cuttersByObject(objects)

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
    const geometry = acquireShape(o, cutters.get(o.id) ?? null)
    borrowed.push(geometry)
    const mesh = new THREE.Mesh(geometry, material)
    mesh.name = o.type
    mesh.position.fromArray(o.position)
    mesh.rotation.fromArray(o.rotation)
    mesh.scale.fromArray(o.scale)
    const parent = o.parentGroupId ? groupNodes.get(o.parentGroupId) : null
    ;(parent ?? root).add(mesh)
  }
  return { root, done: () => borrowed.forEach(releaseShape) }
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

const safeName = (name) =>
  (name || 'babycad-build').trim().replace(/[^a-z0-9_-]+/gi, '-').replace(/^-|-$/g, '') ||
  'babycad-build'

/**
 * Primary export: binary glTF, which preserves colors and the scene graph.
 * Left in the internal Y-up frame on purpose — that is what the glTF spec asks
 * for. See `Z_UP_X_ROTATION`.
 */
export function exportGLB(objects, groups, name) {
  const { root, done } = buildExportScene(objects, groups)
  return new Promise((resolve, reject) => {
    new GLTFExporter().parse(
      root,
      (result) => {
        download(new Blob([result], { type: 'model/gltf-binary' }), `${safeName(name)}.glb`)
        resolve()
      },
      reject,
      { binary: true }
    )
  }).finally(done)
}

/**
 * Secondary export for 3D printing. STL carries geometry only, no color, and
 * is turned Z-up on the way out so it lands on the slicer's plate the way it
 * sat on the plate here. See `Z_UP_X_ROTATION`.
 */
export function exportSTL(objects, groups, name) {
  const { root, done } = buildExportScene(objects, groups)
  try {
    root.rotation.x = Z_UP_X_ROTATION
    root.updateMatrixWorld(true)
    const stl = new STLExporter().parse(root, { binary: true })
    download(new Blob([stl], { type: 'model/stl' }), `${safeName(name)}.stl`)
  } finally {
    done()
  }
}
