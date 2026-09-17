/**
 * A tiny imperative bridge to the live viewport, so chrome that lives outside
 * the R3F <Canvas> (the top bar, the tray) can ask the 3D scene for things:
 * where to drop a new block, a thumbnail, or a camera reset.
 */
import * as THREE from 'three'
import { PLATE_HALF, SNAP } from '../constants'
import { restingHeight } from './geometry'
import { meshes } from './meshRegistry'
import { boxOfMesh } from './gizmoMath'

const FLIGHT_MS = 260

const UP = new THREE.Vector3(0, 1, 0)
// Keep the camera above the plate and stop it tipping past straight down.
const MIN_CAMERA_Y = 0.5
const MAX_LOOK_UP = -0.02
const MAX_LOOK_DOWN = -0.995

/**
 * Swing the camera rigidly about a pivot: position and view direction turn
 * together, then the target is parked back on the new view axis at the same
 * distance so OrbitControls' own `lookAt` agrees with where the camera already
 * points. Nothing jumps, and pan, zoom and damping keep working.
 *
 * `height` is the pixel span a full turn is spread over — the canvas height
 * when dragging the scene, something much smaller for the little view cube.
 */
export function orbitCamera(camera, controls, pivot, dx, dy, height) {
  const speed = (2 * Math.PI) / height
  const distance = camera.position.distanceTo(controls.target)

  const forward = new THREE.Vector3()
  camera.getWorldDirection(forward)
  const right = new THREE.Vector3().crossVectors(forward, UP).normalize()

  const yaw = new THREE.Quaternion().setFromAxisAngle(UP, -dx * speed)
  const pitch = new THREE.Quaternion().setFromAxisAngle(right, -dy * speed)

  const swing = (q) => ({
    position: new THREE.Vector3().subVectors(camera.position, pivot).applyQuaternion(q).add(pivot),
    forward: forward.clone().applyQuaternion(q),
  })

  let next = swing(yaw.clone().multiply(pitch))
  // If tilting would put us under the plate or past vertical, yaw only — the
  // horizontal half of the drag still works.
  if (
    next.position.y < MIN_CAMERA_Y ||
    next.forward.y > MAX_LOOK_UP ||
    next.forward.y < MAX_LOOK_DOWN
  ) {
    next = swing(yaw)
  }

  camera.position.copy(next.position)
  controls.target.copy(next.position).addScaledVector(next.forward, distance)
}

// Framed close enough that a fresh one-unit block reads as a real object, not
// a speck on an endless floor.
export const HOME_CAMERA = { position: [7.5, 6, 7.5], target: [0, 0.75, 0] }

export const viewport = {
  camera: null,
  gl: null,
  controls: null,

  _flight: null,

  /**
   * Ease the camera to a new spot. Snapping instantly from one face of the
   * view cube to another is disorienting; a short glide keeps a kid oriented.
   * Any interaction cancels it — see cancelFlight.
   */
  flyTo(position, target) {
    if (!this.camera || !this.controls) return
    const camera = this.camera
    const controls = this.controls
    const from = { position: camera.position.clone(), target: controls.target.clone() }
    const started = performance.now()
    this.cancelFlight()

    const step = () => {
      const t = Math.min(1, (performance.now() - started) / FLIGHT_MS)
      // easeOutCubic: quick off the mark, settles gently
      const e = 1 - Math.pow(1 - t, 3)
      camera.position.lerpVectors(from.position, position, e)
      controls.target.lerpVectors(from.target, target, e)
      controls.update()
      this._flight = t < 1 ? requestAnimationFrame(step) : null
    }
    this._flight = requestAnimationFrame(step)
  },

  cancelFlight() {
    if (this._flight) cancelAnimationFrame(this._flight)
    this._flight = null
  },

  /**
   * Turn the view by a pointer delta, pivoting on what the camera is looking
   * at. This is what dragging the view cube does.
   */
  orbitBy(dx, dy, height = 220) {
    if (!this.camera || !this.controls) return
    this.cancelFlight()
    orbitCamera(this.camera, this.controls, this.controls.target.clone(), dx, dy, height)
    this.controls.update()
  },

  /** Snap the camera back to the default framing. */
  resetView() {
    if (!this.camera || !this.controls) return
    this.flyTo(
      new THREE.Vector3(...HOME_CAMERA.position),
      new THREE.Vector3(...HOME_CAMERA.target)
    )
  },

  /**
   * Look from a given world direction, keeping the current target and
   * distance. This is what the view cube's faces do.
   */
  lookFrom(direction) {
    if (!this.camera || !this.controls) return
    const target = this.controls.target.clone()
    const distance = this.camera.position.distanceTo(target)
    const dir = new THREE.Vector3(...direction).normalize()
    this.flyTo(target.clone().addScaledVector(dir, distance), target)
  },

  /** Back to the three-quarter angle, without changing where or how close. */
  isoView() {
    if (!this.camera || !this.controls) return
    const target = this.controls.target.clone()
    const distance = this.camera.position.distanceTo(target)
    // Keep whichever corner the camera is nearest, so it turns the short way.
    const here = this.camera.position.clone().sub(target)
    const dir = new THREE.Vector3(
      Math.sign(here.x) || 1,
      1,
      Math.sign(here.z) || 1
    ).normalize()
    this.flyTo(target.clone().addScaledVector(dir, distance), target)
  },

  /**
   * Frame a set of blocks (or everything, if none are given) from the angle
   * the camera is already at.
   */
  fit(ids) {
    if (!this.camera || !this.controls) return
    const list = ids?.length ? ids.map((id) => meshes.get(id)).filter(Boolean) : [...meshes.values()]
    if (!list.length) return this.resetView()

    const box = new THREE.Box3()
    const each = new THREE.Box3()
    for (const mesh of list) box.union(boxOfMesh(mesh, each))
    if (box.isEmpty()) return this.resetView()

    const center = box.getCenter(new THREE.Vector3())
    const radius = Math.max(0.8, box.getBoundingSphere(new THREE.Sphere()).radius)
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
  placementPoint(type, objects = []) {
    const t = this.controls?.target
    const snap = (n) => Math.round(n / SNAP.move) * SNAP.move
    const limit = PLATE_HALF - 1
    const clamp = (n) => Math.max(-limit, Math.min(limit, n))
    let x = clamp(t ? snap(t.x) : 0)
    let z = clamp(t ? snap(t.z) : 0)

    // Don't drop a block exactly on top of one that's already there.
    const taken = (px, pz) =>
      objects.some((o) => Math.abs(o.position[0] - px) < 0.5 && Math.abs(o.position[2] - pz) < 0.5)

    if (taken(x, z)) {
      outward: for (let ring = 1; ring <= 8; ring++) {
        for (let dx = -ring; dx <= ring; dx++) {
          for (let dz = -ring; dz <= ring; dz++) {
            if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue
            const nx = clamp(x + dx)
            const nz = clamp(z + dz)
            if (!taken(nx, nz)) {
              x = nx
              z = nz
              break outward
            }
          }
        }
      }
    }
    return [x, restingHeight(type), z]
  },

  /** A small JPEG of the current scene, used as a saved-build thumbnail. */
  capture(width = 320, height = 180) {
    const source = this.gl?.domElement
    if (!source) return null
    try {
      // Force a fresh frame so the drawing buffer definitely holds the scene.
      this.gl.render(this.gl.__blockyardScene, this.camera)
      const out = document.createElement('canvas')
      out.width = width
      out.height = height
      const ctx = out.getContext('2d')
      const scale = Math.max(width / source.width, height / source.height)
      const w = source.width * scale
      const h = source.height * scale
      ctx.drawImage(source, (width - w) / 2, (height - h) / 2, w, h)
      return out.toDataURL('image/jpeg', 0.6)
    } catch {
      return null
    }
  },
}
