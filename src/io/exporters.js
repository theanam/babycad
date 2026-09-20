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
import { acquireGeometry, releaseGeometry } from '../shapes/geometryCache'

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

  for (const o of objects) {
    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(o.color),
      roughness: 0.55,
      metalness: 0,
    })
    const geometry = acquireGeometry(o.type, o.params)
    borrowed.push(geometry)
    const mesh = new THREE.Mesh(geometry, material)
    mesh.name = o.type
    mesh.position.fromArray(o.position)
    mesh.rotation.fromArray(o.rotation)
    mesh.scale.fromArray(o.scale)
    const parent = o.parentGroupId ? groupNodes.get(o.parentGroupId) : null
    ;(parent ?? root).add(mesh)
  }
  return { root, done: () => borrowed.forEach(releaseGeometry) }
}

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

/** Primary export: binary glTF, which preserves colors and the scene graph. */
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

/** Secondary export for 3D printing. STL carries geometry only, no color. */
export function exportSTL(objects, groups, name) {
  const { root, done } = buildExportScene(objects, groups)
  try {
    root.updateMatrixWorld(true)
    const stl = new STLExporter().parse(root, { binary: true })
    download(new Blob([stl], { type: 'model/stl' }), `${safeName(name)}.stl`)
  } finally {
    done()
  }
}

/** The scene JSON itself, so a build can move between browsers or devices. */
export function exportJSON(scene, name) {
  const blob = new Blob([JSON.stringify(scene, null, 2)], { type: 'application/json' })
  download(blob, `${safeName(name)}.babycad`)
}
