import { useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { useScene } from './sceneStore'
import { ALIGN_MODES, alignBounds } from './align'
import { axisColor } from './axes'
import { meshes } from './meshRegistry'

/**
 * The align targets: nine dots around the selection, three on each axis.
 *
 * Tinkercad's arrangement, because it is the one that reads without a legend —
 * the three dots along the front edge line the blocks up across, the three
 * down the left edge line them up in depth, and the three going up the near
 * corner line them up in height. Tapping the middle dot of a row centres the
 * selection on that axis; the outer two bring one set of faces together.
 *
 * They replace the box handles rather than joining them: the resize corners
 * and the three turn levers already occupy every side of the box a dot could
 * usefully sit on.
 *
 * Dots hold their size on screen, like every other handle here, so they stay
 * tappable with the camera pulled right back.
 */

// Each row: which internal axis it lines up, and where the row of dots sits on
// the other two. `off` is in units of the screen-constant gap, so a row clears
// the blocks by the same distance however far away the camera is.
const ROWS = [
  { slot: 0, along: 'x', at: { y: 'min', z: 'max' }, off: { z: 1 } },
  { slot: 2, along: 'z', at: { x: 'min', y: 'min' }, off: { x: -1 } },
  { slot: 1, along: 'y', at: { x: 'min', z: 'max' }, off: { x: -1, z: 1 } },
]

/**
 * The hover guide is one flat square built in XZ; this turns it into the plane
 * the faces are about to meet in, and says which two of the selection's
 * dimensions its own x and z should take.
 */
const GUIDE_PLANE = {
  x: { rotation: [0, 0, Math.PI / 2], spans: ['y', 'z'] },
  y: { rotation: [0, 0, 0], spans: ['x', 'z'] },
  z: { rotation: [Math.PI / 2, 0, 0], spans: ['x', 'y'] },
}

const DOT_SCREEN = 0.012
const GAP_SCREEN = 0.055
const HOVER_GROW = 1.45

const edge = (box, axis, mode) =>
  mode === 'min' ? box.min[axis] : mode === 'max' ? box.max[axis] : (box.min[axis] + box.max[axis]) / 2

export default function AlignGizmo() {
  const selectedIds = useScene((s) => s.selectedIds)
  const alignSelection = useScene((s) => s.alignSelection)
  const objects = useScene((s) => s.objects)

  const [hover, setHover] = useState(null) // `${slot}:${mode}`

  const dots = useRef({})
  const guide = useRef()
  const group = useRef()

  const sphere = useMemo(() => new THREE.SphereGeometry(1, 16, 12), [])

  // A hairline square drawn at the target, so hovering a dot shows where the
  // faces are about to meet rather than only which dot is lit.
  const guideGeometry = useMemo(() => {
    const g = new THREE.BufferGeometry()
    // prettier-ignore
    g.setAttribute('position', new THREE.Float32BufferAttribute([
      -1, 0, -1,  1, 0, -1,
       1, 0, -1,  1, 0,  1,
       1, 0,  1, -1, 0,  1,
      -1, 0,  1, -1, 0, -1,
    ], 3))
    return g
  }, [])

  const selected = useMemo(() => {
    const ids = new Set(selectedIds)
    return objects.filter((o) => ids.has(o.id))
  }, [objects, selectedIds])

  useFrame(({ camera }) => {
    if (!group.current || selected.length < 2) return
    const { whole } = alignBounds(selected, meshes)
    if (whole.isEmpty()) return

    const centre = whole.getCenter(new THREE.Vector3())
    const k = camera.position.distanceTo(centre)
    const gap = k * GAP_SCREEN
    const size = k * DOT_SCREEN

    for (const row of ROWS) {
      for (const mode of ALIGN_MODES) {
        const dot = dots.current[`${row.slot}:${mode}`]
        if (!dot) continue
        const at = new THREE.Vector3(
          row.along === 'x' ? edge(whole, 'x', mode) : edge(whole, 'x', row.at.x),
          row.along === 'y' ? edge(whole, 'y', mode) : edge(whole, 'y', row.at.y),
          row.along === 'z' ? edge(whole, 'z', mode) : edge(whole, 'z', row.at.z)
        )
        at.x += (row.off.x ?? 0) * gap
        at.y += (row.off.y ?? 0) * gap
        at.z += (row.off.z ?? 0) * gap
        dot.position.copy(at)
        const lit = hover === `${row.slot}:${mode}`
        dot.scale.setScalar(size * (lit ? HOVER_GROW : 1))
      }
    }

    // The guide follows whichever dot is under the pointer.
    const ring = guide.current
    if (!ring) return
    ring.visible = Boolean(hover)
    if (!hover) return
    const [slot, mode] = hover.split(':')
    const axis = ['x', 'y', 'z'][Number(slot)]
    const span = whole.getSize(new THREE.Vector3()).multiplyScalar(0.5).addScalar(gap * 0.5)
    const plane = GUIDE_PLANE[axis]
    ring.position.copy(centre)
    ring.position[axis] = edge(whole, axis, mode)
    ring.rotation.set(...plane.rotation)
    ring.scale.set(span[plane.spans[0]], 1, span[plane.spans[1]])
  })

  if (selected.length < 2) return null

  return (
    <group ref={group}>
      <lineSegments ref={guide} geometry={guideGeometry} visible={false} raycast={() => null}>
        <lineBasicMaterial color="#C8B6FF" transparent opacity={0.75} depthTest={false} />
      </lineSegments>

      {ROWS.map((row) =>
        ALIGN_MODES.map((mode) => {
          const key = `${row.slot}:${mode}`
          const lit = hover === key
          return (
            <mesh
              key={key}
              ref={(m) => {
                dots.current[key] = m
              }}
              geometry={sphere}
              renderOrder={5}
              onPointerOver={(e) => {
                e.stopPropagation()
                setHover(key)
              }}
              onPointerOut={() => setHover((h) => (h === key ? null : h))}
              onPointerDown={(e) => {
                e.stopPropagation()
                alignSelection(row.slot, mode)
              }}
            >
              <meshBasicMaterial
                color={lit ? '#FFFFFF' : axisColor(row.slot)}
                depthTest={false}
                transparent
                opacity={mode === 'center' ? 1 : 0.85}
              />
            </mesh>
          )
        })
      )}
    </group>
  )
}
