import { useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { mark, trace } from '../debug/trace'
import { Html } from '@react-three/drei'
import { useScene } from './sceneStore'
import { ALIGN_MODES, alignBounds, alignOffsets } from './align'
import { AXES } from './axes'
import { grabScale } from './gizmoMath'
import { meshes } from './meshRegistry'

/**
 * The align targets: nine dots around the selection, three on each axis, in
 * Tinkercad's arrangement — three along the front edge line the blocks up
 * across, three down the left edge line them up in depth, three going up the
 * near corner line them up in height.
 *
 * Nine unlabelled dots is a puzzle, so everything here is about saying what a
 * dot does before it is pressed:
 *
 *   - each row of three sits on a rail in its axis's colour, with the axis's
 *     letter at the end, so the rows read as three controls rather than nine
 *   - hovering a dot names it ("Line up the left sides"), draws the plane the
 *     sides will meet in, and ghosts every block's box where it is about to
 *     land — the move is shown before it is made
 *
 * The dots replace the box handles rather than joining them: the resize
 * corners and the three turn levers already occupy every side of the box a
 * dot could usefully sit on. Handles hold their size on screen, like every
 * other handle here, so they stay tappable with the camera pulled right back.
 */

// Each row: which internal axis it lines up, where the row sits on the other
// two, the offset (in units of the screen-constant gap) that clears the blocks
// by the same distance however far away the camera is, and which end the
// letter hangs off. The depth row's letter goes at the *far* end: its near end
// is the corner all three rows meet at, where a letter would sit on top of
// the height row's bottom dot.
const ROWS = [
  { slot: 0, along: 'x', at: { y: 'min', z: 'max' }, off: { z: 1 }, tag: 'max' },
  { slot: 2, along: 'z', at: { x: 'min', y: 'min' }, off: { x: -1 }, tag: 'min' },
  { slot: 1, along: 'y', at: { x: 'min', z: 'max' }, off: { x: -1, z: 1 }, tag: 'max' },
]

// What the outer dots bring together, in the axis names the rail uses. The
// depth axis is internal z, whose low end is *away* from the viewer.
const SIDES = {
  0: { min: 'left sides', max: 'right sides' },
  1: { min: 'bottoms', max: 'tops' },
  2: { min: 'backs', max: 'fronts' },
}

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

const AXIS_KEY = ['x', 'y', 'z']
/**
 * Dot size, before `grabScale` trims it for a cursor.
 *
 * These went without that trim, so they were drawn at fingertip size whatever
 * was pointing at them — nine of them, at full size, sitting over the build on
 * every desktop. With a mouse they now come out at a little under two thirds,
 * which is still a comfortable target and no longer a row of blots.
 */
const DOT_SCREEN = 0.014
const GAP_SCREEN = 0.06
const HOVER_GROW = 1.5
/**
 * The shortest a row of three dots is allowed to be, in the same
 * screen-constant units as the dots themselves.
 *
 * It scales with the dots, since it exists to keep them off one another: a
 * hovered dot is `DOT_SCREEN` × 1.5 across the radius, and at this the three
 * centres sit far enough apart that the row still reads as three targets
 * however small the blocks are.
 */
const MIN_ROW_SCREEN = 0.11

const axisOf = (slot) => AXES.find((a) => a.slot === slot)
const edge = (box, axis, mode) =>
  mode === 'min' ? box.min[axis] : mode === 'max' ? box.max[axis] : (box.min[axis] + box.max[axis]) / 2

/** A unit box's twelve edges, scaled and placed per ghost. */
const unitEdges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1))

const squareLines = () => {
  const g = new THREE.BufferGeometry()
  // prettier-ignore
  g.setAttribute('position', new THREE.Float32BufferAttribute([
    -1, 0, -1,  1, 0, -1,   1, 0, -1,  1, 0,  1,
     1, 0,  1, -1, 0,  1,  -1, 0,  1, -1, 0, -1,
  ], 3))
  return g
}
const squareFill = () => {
  const g = new THREE.BufferGeometry()
  // prettier-ignore
  g.setAttribute('position', new THREE.Float32BufferAttribute([
    -1, 0, -1,  -1, 0, 1,  1, 0, 1,
    -1, 0, -1,   1, 0, 1,  1, 0, -1,
  ], 3))
  g.computeVertexNormals()
  return g
}
const railLine = () => {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(6), 3))
  return g
}

export default function AlignGizmo() {
  const selectedIds = useScene((s) => s.selectedIds)
  const alignSelection = useScene((s) => s.alignSelection)
  const objects = useScene((s) => s.objects)

  const [hover, setHover] = useState(null) // `${slot}:${mode}`
  // Where every block would land for the hovered dot, worked out once on
  // hover rather than every frame: the scene stands still while you hover.
  const [ghosts, setGhosts] = useState([])

  const dots = useRef({})
  const rails = useRef({})
  const tags = useRef({})
  const tip = useRef()
  const guide = useRef()

  const sphere = useMemo(() => new THREE.SphereGeometry(1, 16, 12), [])
  const guideLines = useMemo(squareLines, [])
  const guideFill = useMemo(squareFill, [])
  const railGeometries = useMemo(() => Object.fromEntries(ROWS.map((r) => [r.slot, railLine()])), [])

  const selected = useMemo(() => {
    const ids = new Set(selectedIds)
    return objects.filter((o) => ids.has(o.id))
  }, [objects, selectedIds])

  const enter = (key, slot, mode) => {
    setHover(key)
    mark(`align hover: ${key}`)
    const offsets = trace('align hover: alignOffsets', () => alignOffsets(selected, meshes, slot, mode))
    const { units } = trace('align hover: alignBounds', () => alignBounds(selected, meshes))
    const axis = AXIS_KEY[slot]
    setGhosts(
      units
        .map(({ members, box }) => {
          const delta = offsets.get(members[0].id)
          if (delta === undefined) return null
          const centre = box.getCenter(new THREE.Vector3())
          centre[axis] += delta
          return { centre, size: box.getSize(new THREE.Vector3()) }
        })
        .filter(Boolean)
    )
  }
  const leave = (key) => {
    setHover((h) => (h === key ? null : h))
    setGhosts([])
  }

  useFrame(({ camera }) => {
    if (selected.length < 2) return
    const { whole } = alignBounds(selected, meshes)
    if (whole.isEmpty()) return

    const centre = whole.getCenter(new THREE.Vector3())
    const k = camera.position.distanceTo(centre)
    // Fingers need a bigger target than a cursor does; both need the row to
    // stay long enough that the three dots do not touch.
    const grab = grabScale()
    const gap = k * GAP_SCREEN
    const size = k * DOT_SCREEN * grab

    for (const row of ROWS) {
      // Where along the fixed two axes this row of dots sits.
      const base = new THREE.Vector3(
        row.along === 'x' ? 0 : edge(whole, 'x', row.at.x) + (row.off.x ?? 0) * gap,
        row.along === 'y' ? 0 : edge(whole, 'y', row.at.y) + (row.off.y ?? 0) * gap,
        row.along === 'z' ? 0 : edge(whole, 'z', row.at.z) + (row.off.z ?? 0) * gap
      )
      // Where the three dots sit along the row.
      //
      // They mark the selection's low, middle and high edges — which is the
      // right place for them until the selection is barely any size in this
      // direction, when all three edges are nearly the same point and the dots
      // land on top of one another. Three small balls in a line came out as
      // one smudge per axis, with no way to tell which dot was which or to hit
      // the one you wanted.
      //
      // A dot's meaning is which dot it is, not where it sits: pressing it
      // calls `alignSelection` with the row's axis and this mode, and never
      // reads its position. So a short row can simply be opened out to a
      // length that stays readable, and nothing it does changes.
      const low = edge(whole, row.along, 'min')
      const high = edge(whole, row.along, 'max')
      const middle = (low + high) / 2
      const reach = Math.max((high - low) / 2, (k * MIN_ROW_SCREEN * grab) / 2)
      const along = { min: middle - reach, center: middle, max: middle + reach }
      const at = (mode) => {
        const p = base.clone()
        p[row.along] = along[mode]
        return p
      }

      for (const mode of ALIGN_MODES) {
        const key = `${row.slot}:${mode}`
        const dot = dots.current[key]
        if (!dot) continue
        dot.position.copy(at(mode))
        dot.scale.setScalar(size * (hover === key ? HOVER_GROW : 1))
      }

      // The rail runs a little past the outer dots, and the letter sits just
      // beyond one end of it.
      const lo = at('min')
      const hi = at('max')
      lo[row.along] -= gap * 0.35
      hi[row.along] += gap * 0.35
      const rail = rails.current[row.slot]
      if (rail) {
        const pos = rail.geometry.attributes.position
        pos.setXYZ(0, lo.x, lo.y, lo.z)
        pos.setXYZ(1, hi.x, hi.y, hi.z)
        pos.needsUpdate = true
      }
      const tag = tags.current[row.slot]
      if (tag) {
        const p = (row.tag === 'max' ? hi : lo).clone()
        p[row.along] += (row.tag === 'max' ? 1 : -1) * gap * 0.45
        tag.position.copy(p)
      }
    }

    // The tooltip rides on the hovered dot; the guide plane sits where the
    // sides are about to meet.
    const ring = guide.current
    if (ring) ring.visible = Boolean(hover)
    if (!hover) return
    const [slot, mode] = hover.split(':')
    const axis = AXIS_KEY[Number(slot)]
    if (tip.current) {
      const dot = dots.current[hover]
      if (dot) tip.current.position.copy(dot.position)
    }
    if (ring) {
      const span = whole.getSize(new THREE.Vector3()).multiplyScalar(0.5).addScalar(gap * 0.5)
      const plane = GUIDE_PLANE[axis]
      ring.position.copy(centre)
      ring.position[axis] = edge(whole, axis, mode)
      ring.rotation.set(...plane.rotation)
      ring.scale.set(span[plane.spans[0]], 1, span[plane.spans[1]])
    }
  })

  if (selected.length < 2) return null

  const hovered = hover ? hover.split(':') : null
  const hoveredAxis = hovered ? axisOf(Number(hovered[0])) : null

  return (
    <group>
      {/* the plane the sides will meet in */}
      <group ref={guide} visible={false}>
        <mesh geometry={guideFill} raycast={() => null}>
          <meshBasicMaterial
            color="#7C4DFF"
            transparent
            opacity={0.14}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>
        <lineSegments geometry={guideLines} raycast={() => null}>
          <lineBasicMaterial color="#C8B6FF" transparent opacity={0.9} depthTest={false} />
        </lineSegments>
      </group>

      {/* where each block is about to land */}
      {ghosts.map((g, i) => (
        <lineSegments
          key={i}
          geometry={unitEdges}
          position={g.centre}
          scale={g.size}
          raycast={() => null}
        >
          <lineBasicMaterial color="#C8B6FF" transparent opacity={0.85} depthTest={false} />
        </lineSegments>
      ))}

      {ROWS.map((row) => {
        const axis = axisOf(row.slot)
        return (
          <group key={row.slot}>
            <lineSegments
              ref={(l) => {
                rails.current[row.slot] = l
              }}
              geometry={railGeometries[row.slot]}
              raycast={() => null}
            >
              <lineBasicMaterial color={axis.color} transparent opacity={0.55} depthTest={false} />
            </lineSegments>

            <group
              ref={(g) => {
                tags.current[row.slot] = g
              }}
            >
              <Html zIndexRange={[20, 10]} style={{ pointerEvents: 'none' }}>
                <div className="align-axis" style={{ color: axis.color }}>
                  {axis.label}
                </div>
              </Html>
            </group>

            {ALIGN_MODES.map((mode) => {
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
                    enter(key, row.slot, mode)
                  }}
                  onPointerOut={() => leave(key)}
                  onPointerDown={(e) => {
                    e.stopPropagation()
                    alignSelection(row.slot, mode)
                    // The dots move with the selection; work the preview out
                    // again for where they are now.
                    enter(key, row.slot, mode)
                  }}
                >
                  <meshBasicMaterial
                    color={lit ? '#FFFFFF' : axis.color}
                    depthTest={false}
                    transparent
                    opacity={mode === 'center' ? 1 : 0.85}
                  />
                </mesh>
              )
            })}
          </group>
        )
      })}

      {hovered && (
        <group ref={tip}>
          <Html zIndexRange={[30, 20]} style={{ pointerEvents: 'none' }}>
            <div className="align-tip">
              {hovered[1] === 'center'
                ? <>Centre them on <em>{hoveredAxis.label}</em></>
                : <>Line up the {SIDES[hovered[0]][hovered[1]]} · <em>{hoveredAxis.label}</em></>}
            </div>
          </Html>
        </group>
      )}
    </group>
  )
}
