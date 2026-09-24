import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import { useScene } from './sceneStore'
import { meshes } from './meshRegistry'
import { PLATE_HALF } from '../constants'

/**
 * The tape measure: press two places, read how far apart they are.
 *
 * Everything else in this app measures a block — how big it is, how far it is
 * from its neighbour — and all of those are answers to questions the app chose.
 * This answers the one it did not: how far is *that* from *this*. Across a gap
 * that has nothing in it, from a corner of one part to a face of another,
 * between two points on the same block.
 *
 * **It works on the surfaces, not the boxes.** The clearance readout in the
 * gizmo measures between bounding boxes, because it has to recompute every
 * frame for everything on the plate. This fires twice per measurement, so it
 * can afford to ask where the pointer actually landed — which for a ball is a
 * point on the ball, not on the invisible cube around it.
 *
 * **The plate counts as a surface.** Measuring to a spot on the floor is how
 * you answer "how far is this from the edge", and there is nothing there to
 * hit, so the floor is added to the raycast as a plane of its own.
 *
 * **It never selects anything.** While the tape is out, a press is a
 * measurement and nothing else — `SceneObject` stands down, so pressing a
 * block takes a point on it rather than picking it up.
 */

const FLOOR = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)

/** A round number of millimetres, to a tenth, without a trailing nought. */
const mm = (n) => {
  const fixed = n.toFixed(1)
  return fixed.endsWith('.0') ? fixed.slice(0, -2) : fixed
}

export default function MeasureTool() {
  const points = useScene((s) => s.measurePoints)
  const addMeasurePoint = useScene((s) => s.addMeasurePoint)
  const { camera, gl } = useThree()

  // Where the pointer is now, so a half-made measurement follows it rather
  // than sitting there as a dot with nothing to say.
  const [hover, setHover] = useState(null)

  const line = useRef()
  const tip = useRef()
  const markerA = useRef()
  const markerB = useRef()
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(6), 3))
    return g
  }, [])
  const dot = useMemo(() => new THREE.SphereGeometry(1, 16, 12), [])

  useEffect(() => {
    const el = gl.domElement
    const raycaster = new THREE.Raycaster()
    const ndc = new THREE.Vector2()

    /** Where the pointer meets the build, or the plate if it meets nothing. */
    const pointAt = (event) => {
      const rect = el.getBoundingClientRect()
      ndc.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1
      )
      raycaster.setFromCamera(ndc, camera)

      const targets = []
      for (const mesh of meshes.values()) if (mesh.visible) targets.push(mesh)
      const hit = raycaster.intersectObjects(targets, false)[0]
      if (hit) return hit.point.clone()

      // Nothing under the pointer: fall back to the plate, and only where the
      // plate actually is. Beyond its edge there is no surface to measure to
      // and a point on the infinite plane would be a made-up answer.
      const onFloor = raycaster.ray.intersectPlane(FLOOR, new THREE.Vector3())
      if (!onFloor) return null
      const reach = PLATE_HALF + 1
      if (Math.abs(onFloor.x) > reach || Math.abs(onFloor.z) > reach) return null
      return onFloor
    }

    const onMove = (event) => setHover(pointAt(event))
    const onDown = (event) => {
      // Left button only: the right and middle ones belong to the camera, and
      // turning the view is not a measurement.
      if (event.button !== 0) return
      const point = pointAt(event)
      if (point) addMeasurePoint(point.toArray())
    }

    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerdown', onDown)
    return () => {
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerdown', onDown)
    }
  }, [camera, gl, addMeasurePoint])

  // The pair being shown: two taken points, or one taken and the pointer.
  const a = points[0] ? new THREE.Vector3(...points[0]) : null
  const b = points[1] ? new THREE.Vector3(...points[1]) : points.length === 1 ? hover : null

  useFrame(({ camera: cam }) => {
    const span = line.current
    if (span) {
      span.visible = Boolean(a && b)
      if (a && b) {
        const pos = span.geometry.attributes.position
        pos.setXYZ(0, a.x, a.y, a.z)
        pos.setXYZ(1, b.x, b.y, b.z)
        pos.needsUpdate = true
      }
    }
    if (tip.current && a && b) {
      tip.current.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2)
    }
    // The end markers hold their size on screen, like every other handle.
    for (const [node, at] of [[markerA.current, a], [markerB.current, b]]) {
      if (!node) continue
      node.visible = Boolean(at)
      if (at) {
        node.position.copy(at)
        node.scale.setScalar(cam.position.distanceTo(at) * 0.006)
      }
    }
  })

  const gap = a && b ? a.distanceTo(b) : null

  return (
    <group>
      <lineSegments ref={line} geometry={geometry} visible={false} raycast={() => null}>
        <lineBasicMaterial color="#C8B6FF" transparent opacity={0.95} depthTest={false} />
      </lineSegments>

      {[markerA, markerB].map((ref, i) => (
        <mesh key={i} ref={ref} geometry={dot} visible={false} raycast={() => null} renderOrder={6}>
          <meshBasicMaterial color="#C8B6FF" depthTest={false} />
        </mesh>
      ))}

      {gap !== null && (
        <group ref={tip}>
          <Html zIndexRange={[30, 20]} style={{ pointerEvents: 'none' }}>
            <div className="measure-tip">
              {mm(gap)} mm
              {/* The three sides of it as well, since "how far across" and
                  "how far up" are usually the numbers somebody is after and
                  working them back out of a diagonal is nobody's idea of a
                  good time. */}
              <em>
                {mm(Math.abs(b.x - a.x))} · {mm(Math.abs(b.z - a.z))} · {mm(Math.abs(b.y - a.y))}
              </em>
            </div>
          </Html>
        </group>
      )}
    </group>
  )
}
