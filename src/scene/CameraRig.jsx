import { useEffect } from 'react'
import * as THREE from 'three'
import { useThree } from '@react-three/fiber'
import { meshes } from './meshRegistry'
import { useLive } from './liveStore'
import { gesture } from './gesture'
import { orbitCamera, viewport } from './viewportApi'
import { PLATE_HALF } from '../constants'

const UP = new THREE.Vector3(0, 1, 0)
// Movement past this is a camera drag, not a click.
const CLICK_SLOP = 4

/**
 * Orbiting about whatever is under the cursor.
 *
 * OrbitControls can't do this: it always re-aims the camera at its target, so
 * moving the target to the cursor would swing the view before the drag even
 * starts. Instead this rotates the whole camera rigidly about the pivot — the
 * point under the cursor when the drag began — and then parks the target back
 * on the new view axis at the same distance. OrbitControls' own `lookAt` then
 * agrees with where the camera is already pointing, so nothing jumps and pan,
 * zoom and damping keep working normally.
 *
 * Zoom-to-cursor is OrbitControls' own `zoomToCursor`; see Viewport.
 */
export default function CameraRig() {
  const { camera, gl, controls } = useThree()

  useEffect(() => {
    if (!controls) return
    const el = gl.domElement
    const raycaster = new THREE.Raycaster()
    const ndc = new THREE.Vector2()
    const ground = new THREE.Plane(UP, 0)
    const pointers = new Set()
    let state = null

    const toNdc = (clientX, clientY) => {
      const rect = el.getBoundingClientRect()
      ndc.set(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1
      )
      return ndc
    }

    /** The point under the cursor: a block if there is one, else the floor. */
    const pivotAt = (clientX, clientY) => {
      raycaster.setFromCamera(toNdc(clientX, clientY), camera)
      const hit = raycaster.intersectObjects([...meshes.values()], false)[0]
      if (hit) return hit.point.clone()

      const point = new THREE.Vector3()
      if (raycaster.ray.intersectPlane(ground, point)) {
        // Aiming at the horizon gives a pivot miles away; fall back instead.
        const reach = PLATE_HALF * 1.6
        if (Math.abs(point.x) <= reach && Math.abs(point.z) <= reach) return point
      }
      return controls.target.clone()
    }

    const onDown = (event) => {
      // Touching the scene wins over any camera move still in flight.
      viewport.cancelFlight()
      pointers.add(event.pointerId)
      gesture.moved = false
      if (pointers.size > 1) {
        // Two fingers belong to OrbitControls: pinch-zoom and pan.
        state = null
        return
      }
      state = {
        id: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        x: event.clientX,
        y: event.clientY,
        pivot: null,
      }
    }

    const onMove = (event) => {
      if (!state || event.pointerId !== state.id) return

      if (!gesture.moved) {
        const travelled = Math.hypot(event.clientX - state.startX, event.clientY - state.startY)
        if (travelled <= CLICK_SLOP) return
        gesture.moved = true
      }

      // A block or gizmo drag owns the gesture; both switch these off.
      if (useLive.getState().dragging || !controls.enabled) return

      if (!state.pivot) {
        // Pivot on what was under the cursor when the press started.
        state.pivot = pivotAt(state.startX, state.startY)
      }

      orbitCamera(
        camera,
        controls,
        state.pivot,
        event.clientX - state.x,
        event.clientY - state.y,
        el.clientHeight
      )
      state.x = event.clientX
      state.y = event.clientY
    }

    const onUp = (event) => {
      pointers.delete(event.pointerId)
      if (state && state.id === event.pointerId) state = null
    }

    const onWheel = () => viewport.cancelFlight()

    el.addEventListener('pointerdown', onDown)
    el.addEventListener('wheel', onWheel, { passive: true })
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('wheel', onWheel)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [camera, gl, controls])

  return null
}
