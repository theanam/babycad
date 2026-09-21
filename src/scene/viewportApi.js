/**
 * A tiny imperative bridge to the live viewport, so chrome that lives outside
 * the R3F <Canvas> (the top bar, the tray, the view cube) can ask the 3D scene
 * for things: where to drop a new block, a thumbnail, or a camera move. The
 * camera itself is an OrbitCamera (see scene/orbit); everything here that
 * moves the view goes through it.
 */
import * as THREE from 'three'
import { FOOTPRINT, PLATE_HALF, SNAP } from '../constants'
import { restingHeight } from '../shapes/geometryCache'
import { meshes } from './meshRegistry'
import { boxOfMesh } from './gizmoMath'

// Framed close enough that a fresh 20 mm block reads as a real object, not a
// speck on an endless floor.
export const HOME_CAMERA = { position: [150, 120, 150], target: [0, 15, 0] }

export const viewport = {
  camera: null,
  gl: null,
  controls: null, // the OrbitCamera

  /** Ease the camera to a new spot — see OrbitCamera.flyTo. */
  flyTo(position, target) {
    this.controls?.flyTo(position, target)
  },

  cancelFlight() {
    this.controls?.cancelFlight()
  },

  /**
   * Turn the view by a pointer delta. This is what dragging the view cube
   * does; `span` is how many pixels make a full turn, so the little cube can
   * spin the view round over its own width.
   */
  orbitBy(dx, dy, span = 220) {
    this.controls?.orbitBy(dx, dy, (2 * Math.PI) / span)
  },

  /** Glide back to the default framing. */
  resetView() {
    this.flyTo(new THREE.Vector3(...HOME_CAMERA.position), new THREE.Vector3(...HOME_CAMERA.target))
  },

  /**
   * Look from a given world direction, keeping the current target and
   * distance. This is what the view cube's faces do.
   */
  lookFrom(direction) {
    if (!this.controls) return
    const target = this.controls.target.clone()
    const dir = new THREE.Vector3(...direction).normalize()
    this.flyTo(target.clone().addScaledVector(dir, this.controls.radius), target)
  },

  /** Back to the three-quarter angle, without changing where or how close. */
  isoView() {
    if (!this.camera || !this.controls) return
    const target = this.controls.target.clone()
    // Keep whichever corner the camera is nearest, so it turns the short way.
    const here = this.camera.position.clone().sub(target)
    const dir = new THREE.Vector3(Math.sign(here.x) || 1, 1, Math.sign(here.z) || 1).normalize()
    this.flyTo(target.clone().addScaledVector(dir, this.controls.radius), target)
  },

  /**
   * Frame a set of blocks (or everything, if none are given) from the angle
   * the camera is already at.
   */
  fit(ids) {
    if (!this.camera || !this.controls) return
    const list = (
      ids?.length ? ids.map((id) => meshes.get(id)) : [...meshes.values()]
    ).filter((m) => m && m.visible)
    if (!list.length) return this.resetView()

    const box = new THREE.Box3()
    const each = new THREE.Box3()
    for (const mesh of list) box.union(boxOfMesh(mesh, each))
    if (box.isEmpty()) return this.resetView()

    const center = box.getCenter(new THREE.Vector3())
    const radius = Math.max(16, box.getBoundingSphere(new THREE.Sphere()).radius)
    const fov = (this.camera.fov * Math.PI) / 180
    // A little headroom so the build isn't flush against the edges.
    const distance = (radius / Math.sin(fov / 2)) * 1.2

    const dir = this.camera.position.clone().sub(this.controls.target).normalize()
    this.flyTo(center.clone().addScaledVector(dir, distance), center)
  },

  /**
   * Where a new block should land: the point the camera is looking at on the
   * ground plane, snapped to the grid. Falls back to the origin before the
   * canvas has mounted.
   */
  placementPoint(type, objects = [], params) {
    const t = this.controls?.target
    const snap = (n) => Math.round(n / SNAP.move) * SNAP.move
    const limit = PLATE_HALF - FOOTPRINT
    const clamp = (n) => Math.max(-limit, Math.min(limit, n))
    let x = clamp(t ? snap(t.x) : 0)
    let z = clamp(t ? snap(t.z) : 0)

    // Every shape drops with a 20 mm footprint, so that is the square this
    // keeps clear: a block already inside it means this spot is taken, and
    // the search steps out a whole footprint at a time. Two shapes dropped in
    // a row land side by side on the grid rather than inside one another.
    const taken = (px, pz) =>
      objects.some(
        (o) =>
          Math.abs(o.position[0] - px) < FOOTPRINT / 2 &&
          Math.abs(o.position[2] - pz) < FOOTPRINT / 2
      )

    if (taken(x, z)) {
      outward: for (let ring = 1; ring <= 8; ring++) {
        for (let dx = -ring; dx <= ring; dx++) {
          for (let dz = -ring; dz <= ring; dz++) {
            if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue
            const nx = clamp(x + dx * FOOTPRINT)
            const nz = clamp(z + dz * FOOTPRINT)
            if (!taken(nx, nz)) {
              x = nx
              z = nz
              break outward
            }
          }
        }
      }
    }
    return [x, restingHeight(type, params), z]
  }

}
