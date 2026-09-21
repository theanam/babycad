/**
 * Orbit / pan / zoom camera, the way betterScad does it.
 *
 * Ported from that project's `viewport/controls.ts` rather than reusing
 * three's OrbitControls, for the same reasons it gave: a CAD camera wants a
 * turntable whose axis is the model's up axis, a target that can be moved
 * deliberately and otherwise stays put, and no roll — ever. The previous rig
 * here swung the camera rigidly about whatever was under the cursor and then
 * re-aimed OrbitControls at the result, which felt clever for one drag and
 * drifted into a tilted horizon over several.
 *
 * **Y-up spherical.** The scene is three.js-native Y-up (see scene/axes for
 * why the rail calls that axis Z), so the pose is azimuth around +Y measured
 * from +X, and polar from +Y. Angles are kept explicitly and the camera is
 * rebuilt from them every frame, which is what makes roll impossible: there is
 * no roll in the parameterisation to accumulate.
 *
 * Input, as in every CAD tool people will already have used:
 *   - left-drag on empty space orbits (a block drag is the gizmo's, not ours)
 *   - right-drag, middle-drag or shift-drag pans
 *   - wheel zooms, toward the target
 *   - one finger orbits, two fingers pinch to zoom and slide to pan
 */
import * as THREE from 'three'
import { gesture } from './gesture'

// Kept just inside both poles, where `lookAt` would have no defined roll. The
// full range otherwise: the underside of a build is a real thing to want to
// see, and the plate is single-sided so from below it simply isn't in the way.
const POLAR_MIN = 1e-3
const POLAR_MAX = Math.PI - POLAR_MIN

const ROTATE_SPEED = 0.0045 // radians per pixel
const ZOOM_SPEED = 0.0015
const FLIGHT_MS = 280
// Movement past this is a drag, not a click.
const CLICK_SLOP = 4

const UP = new THREE.Vector3(0, 1, 0)

export class OrbitCamera {
  target = new THREE.Vector3()
  azimuth = Math.PI / 4
  polar = Math.PI / 3
  radius = 200

  minDistance = 50
  maxDistance = 900

  /** Set while a gizmo owns the pointer, so the viewport does not also orbit. */
  enabled = true

  #pointers = new Map()
  #lastSingle = new THREE.Vector2()
  #lastPinch = 0
  #lastCentroid = new THREE.Vector2()
  #mode = 'none' // 'none' | 'orbit' | 'pan' | 'touch'
  #armed = false // past the click slop, so this press is a drag
  #animation = null

  constructor(camera, element) {
    this.camera = camera
    this.element = element
    element.addEventListener('pointerdown', this.#onPointerDown)
    element.addEventListener('pointermove', this.#onPointerMove)
    element.addEventListener('pointerup', this.#onPointerUp)
    element.addEventListener('pointercancel', this.#onPointerUp)
    element.addEventListener('wheel', this.#onWheel, { passive: false })
    element.addEventListener('contextmenu', this.#onContextMenu)
    this.apply()
  }

  dispose() {
    const el = this.element
    el.removeEventListener('pointerdown', this.#onPointerDown)
    el.removeEventListener('pointermove', this.#onPointerMove)
    el.removeEventListener('pointerup', this.#onPointerUp)
    el.removeEventListener('pointercancel', this.#onPointerUp)
    el.removeEventListener('wheel', this.#onWheel)
    el.removeEventListener('contextmenu', this.#onContextMenu)
  }

  /* ------------------------------------------------------------- pose -- */

  offsetFor(azimuth, polar, radius = this.radius) {
    const s = Math.sin(polar)
    return new THREE.Vector3(
      radius * s * Math.cos(azimuth),
      radius * Math.cos(polar),
      radius * s * Math.sin(azimuth)
    )
  }

  /** The pose that puts the camera at `position` looking at `target`. */
  poseFor(position, target) {
    const d = new THREE.Vector3().subVectors(position, target)
    const radius = Math.max(d.length(), 1e-3)
    return {
      radius,
      polar: Math.acos(THREE.MathUtils.clamp(d.y / radius, -1, 1)),
      azimuth: Math.atan2(d.z, d.x),
    }
  }

  apply() {
    this.radius = THREE.MathUtils.clamp(this.radius, this.minDistance, this.maxDistance)
    this.polar = THREE.MathUtils.clamp(this.polar, POLAR_MIN, POLAR_MAX)
    this.camera.up.copy(UP)
    this.camera.position.copy(this.target).add(this.offsetFor(this.azimuth, this.polar))
    this.camera.lookAt(this.target)
    this.camera.updateMatrixWorld()
  }

  /** OrbitControls had one of these; the gizmo still calls it. Nothing to do. */
  update() {}

  /**
   * Glide to a new pose. Snapping instantly from one face of the view cube to
   * another is disorienting; a short ease keeps a kid oriented. Any drag or
   * wheel cancels it.
   */
  flyTo(position, target, animate = true) {
    const to = { ...this.poseFor(position, target), target: target.clone() }
    // The short way round, so a snap never spins the long way.
    to.azimuth = this.azimuth + shortestAngle(this.azimuth, to.azimuth)
    if (!animate) {
      Object.assign(this, { azimuth: to.azimuth, polar: to.polar, radius: to.radius })
      this.target.copy(to.target)
      this.#animation = null
      this.apply()
      return
    }
    this.#animation = {
      from: { azimuth: this.azimuth, polar: this.polar, radius: this.radius, target: this.target.clone() },
      to,
      start: performance.now(),
    }
  }

  cancelFlight() {
    this.#animation = null
  }

  /** Advances a running glide. Returns true while more frames are needed. */
  tick() {
    const a = this.#animation
    if (!a) return false
    const t = Math.min(1, (performance.now() - a.start) / FLIGHT_MS)
    // easeInOutQuad: quick off the mark, settles gently.
    const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
    this.azimuth = a.from.azimuth + (a.to.azimuth - a.from.azimuth) * e
    this.polar = a.from.polar + (a.to.polar - a.from.polar) * e
    this.radius = a.from.radius + (a.to.radius - a.from.radius) * e
    this.target.lerpVectors(a.from.target, a.to.target, e)
    if (t >= 1) this.#animation = null
    this.apply()
    return this.#animation !== null
  }

  /**
   * Orbit by a screen-space drag, in pixels. Public so the view cube can drive
   * the same turntable the viewport does; `speed` lets it turn a full circle
   * over its own small width rather than over a screen's worth of drag.
   */
  orbitBy(dx, dy, speed = ROTATE_SPEED) {
    this.#animation = null
    // Dragging right turns the model right; dragging down lifts the eye.
    this.azimuth += dx * speed
    this.polar -= dy * speed
    this.apply()
  }

  /**
   * Pan the target in the camera's screen plane, scaled by distance and field
   * of view so a drag moves the model by the same number of pixels whatever
   * the zoom.
   */
  panBy(dx, dy) {
    this.#animation = null
    const height = this.element.clientHeight || 1
    const worldPerPixel =
      (2 * this.radius * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2)) / height
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 0)
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 1)
    this.target.addScaledVector(right, -dx * worldPerPixel).addScaledVector(up, dy * worldPerPixel)
    this.apply()
  }

  zoomBy(factor) {
    this.#animation = null
    this.radius *= factor
    this.apply()
  }

  /* ------------------------------------------------------------ input -- */

  #onContextMenu = (event) => event.preventDefault()

  #onPointerDown = (event) => {
    this.#animation = null // touching the scene wins over a glide in flight
    gesture.moved = false
    this.#armed = false
    this.#pointers.set(event.pointerId, new THREE.Vector2(event.clientX, event.clientY))
    this.element.setPointerCapture?.(event.pointerId)

    if (this.#pointers.size === 1) {
      this.#lastSingle.set(event.clientX, event.clientY)
      // Middle and right drag pan, as in every other CAD tool; shift-drag too,
      // for a trackpad with no middle button.
      this.#mode = event.button === 0 && !event.shiftKey ? 'orbit' : 'pan'
    } else if (this.#pointers.size === 2) {
      this.#mode = 'touch'
      this.#lastPinch = this.#pinchDistance()
      this.#centroid(this.#lastCentroid)
    }
  }

  #onPointerMove = (event) => {
    const was = this.#pointers.get(event.pointerId)
    if (!was) return
    this.#pointers.set(event.pointerId, new THREE.Vector2(event.clientX, event.clientY))

    // Two fingers: pinch to zoom, slide together to pan.
    if (this.#mode === 'touch' && this.#pointers.size === 2) {
      if (!this.enabled) return
      const pinch = this.#pinchDistance()
      if (this.#lastPinch > 0) this.radius *= this.#lastPinch / Math.max(pinch, 1)
      this.#lastPinch = pinch
      const centroid = this.#centroid(new THREE.Vector2())
      this.panBy(centroid.x - this.#lastCentroid.x, centroid.y - this.#lastCentroid.y)
      this.#lastCentroid.copy(centroid)
      gesture.moved = true
      return
    }
    if (this.#pointers.size !== 1) return

    // Nothing until the press has clearly become a drag: it keeps a click from
    // twitching the view, and it is what lets the miss handler tell the two
    // apart when it decides whether to clear the selection.
    if (!this.#armed) {
      if (Math.hypot(event.clientX - this.#lastSingle.x, event.clientY - this.#lastSingle.y) <= CLICK_SLOP) {
        return
      }
      this.#armed = true
      gesture.moved = true
      this.#lastSingle.set(event.clientX, event.clientY)
      return
    }

    // A block or gizmo drag owns the pointer. Checked here as well as on the
    // way in, because the gizmo may only claim it after our pointerdown ran.
    if (!this.enabled) return

    const dx = event.clientX - this.#lastSingle.x
    const dy = event.clientY - this.#lastSingle.y
    this.#lastSingle.set(event.clientX, event.clientY)
    if (this.#mode === 'orbit') this.orbitBy(dx, dy)
    else if (this.#mode === 'pan') this.panBy(dx, dy)
  }

  #onPointerUp = (event) => {
    this.#pointers.delete(event.pointerId)
    if (this.element.hasPointerCapture?.(event.pointerId)) {
      this.element.releasePointerCapture(event.pointerId)
    }
    if (this.#pointers.size === 0) this.#mode = 'none'
    else if (this.#pointers.size === 1) {
      // Lifting one of two fingers carries on as an orbit with the other.
      const [remaining] = [...this.#pointers.values()]
      this.#lastSingle.copy(remaining)
      this.#armed = true
      this.#mode = 'orbit'
    }
  }

  #onWheel = (event) => {
    if (!this.enabled) return
    event.preventDefault()
    // Line-mode deltas are about one per notch; normalise so both feel the same.
    const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY
    this.zoomBy(Math.exp(delta * ZOOM_SPEED))
  }

  #pinchDistance() {
    const [a, b] = [...this.#pointers.values()]
    return a && b ? a.distanceTo(b) : 0
  }

  #centroid(target) {
    const [a, b] = [...this.#pointers.values()]
    return a && b ? target.copy(a).add(b).multiplyScalar(0.5) : target.copy(a ?? new THREE.Vector2())
  }
}

/** Signed angle from `a` to `b`, wrapped into (-PI, PI]. */
function shortestAngle(a, b) {
  let delta = (b - a) % (Math.PI * 2)
  if (delta > Math.PI) delta -= Math.PI * 2
  if (delta <= -Math.PI) delta += Math.PI * 2
  return delta
}
