import { useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import { useScene } from './sceneStore'
import { alignBounds } from './align'
import { AXES } from './axes'
import { meshes } from './meshRegistry'

/**
 * The mirror handles: one per axis, around the selection.
 *
 * Mirroring works on one block as readily as on twenty, which is what sets it
 * apart from aligning — there is nothing to line a single block up against,
 * but flipping one over is an ordinary thing to want. So these appear as soon
 * as anything is picked.
 *
 * **Why they are not dots.** The align targets are dots, and a dot in this app
 * is something you take hold of: the resize corners, the turn levers and the
 * lift cone are all dots or balls you drag. These are pressed once and let go,
 * and giving them the same shape would be promising a drag that does nothing.
 * So each one is a flat plaque with two arrowheads facing apart along the axis
 * it flips — it reads as a button, and it shows which way the block is about
 * to turn over before it is pressed.
 *
 * The two lying on the plate point along the floor; the one for height stands
 * up and turns to face the camera, because a pair of up-and-down arrows drawn
 * flat on the floor says nothing at all. Hovering one ghosts the boxes where
 * the blocks are about to land, which matters more here than it does for
 * aligning: half the shapes in this app are symmetrical, and flipping one on
 * its own is a change you can only see in the numbers.
 */

/**
 * Where each handle sits: the axis it flips, and which face of the selection's
 * box it stands off, in units of the screen-constant gap.
 *
 * One to a side, and never a corner. They began on the same three anchors the
 * align rows use, two of which meet at the near corner — which put two plaques
 * in the same place and both of them over the block, so the thing you were
 * about to flip was behind the buttons that flip it. A side each keeps every
 * plaque out past the edge of the block with nothing but plate behind it, and
 * puts the widest possible distance between them when the selection is small
 * enough that the anchors all but collapse onto one point.
 */
const HANDLES = [
  // Left-to-right: out in front, where left and right are plain to see.
  { slot: 0, at: { y: 'min', z: 'max' }, off: { z: 1 } },
  // Front-to-back: off to the left, side on.
  { slot: 2, at: { x: 'min', y: 'min' }, off: { x: -1 } },
  // Top-to-bottom: off to the right at half height, standing up.
  { slot: 1, at: { x: 'max' }, off: { x: 1 } },
]

/** What each one does, in the words the rail uses for that axis. */
const FLIPS = {
  0: 'Flip it left to right',
  1: 'Flip it top to bottom',
  2: 'Flip it front to back',
}

const AXIS_KEY = ['x', 'y', 'z']
/**
 * Plaque size and stand-off, both held constant on screen.
 *
 * Taken in by the same seven tenths as every other handle — see `grabScale`.
 * A plaque reaches 1.35 of its own scale to either side, so at 0.019 it is
 * 0.026 wide from the middle — about the size of a fingertip on a phone and a
 * comfortable target with a mouse, without being a slab across the view. The
 * first attempt was nearly twice this and read as furniture rather than as
 * controls.
 *
 * With one handle to a side the stand-off no longer has to hold them apart —
 * even on a selection with no size at all they are a couple of gaps from one
 * another — so it can stay small and keep them beside the block they belong
 * to rather than floating off across the plate.
 */
const PLAQUE_SCREEN = 0.019 * 0.7
const GAP_SCREEN = 0.09
const HOVER_GROW = 1.25

const axisOf = (slot) => AXES.find((a) => a.slot === slot)
const edge = (box, axis, mode) =>
  mode === 'min' ? box.min[axis] : mode === 'max' ? box.max[axis] : (box.min[axis] + box.max[axis]) / 2

/** A unit box's twelve edges, scaled and placed per ghost. */
const unitEdges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1))

/**
 * Two arrowheads facing apart, with a line between them for the plane the flip
 * happens across. Built once, in the XY plane, pointing along x.
 */
function flipGlyph() {
  const head = (sign) => {
    const s = new THREE.Shape()
    s.moveTo(sign * 1, 0)
    s.lineTo(sign * 0.36, 0.56)
    s.lineTo(sign * 0.36, -0.56)
    s.closePath()
    return s
  }
  const bar = new THREE.Shape()
  bar.moveTo(-0.09, -0.74)
  bar.lineTo(0.09, -0.74)
  bar.lineTo(0.09, 0.74)
  bar.lineTo(-0.09, 0.74)
  bar.closePath()
  return new THREE.ShapeGeometry([head(1), head(-1), bar])
}

/** The same glyph again, a little larger, as the plaque it sits on. */
function plaqueBack() {
  const s = new THREE.Shape()
  const w = 1.35
  const h = 0.95
  const r = 0.3
  s.moveTo(-w + r, -h)
  s.lineTo(w - r, -h)
  s.quadraticCurveTo(w, -h, w, -h + r)
  s.lineTo(w, h - r)
  s.quadraticCurveTo(w, h, w - r, h)
  s.lineTo(-w + r, h)
  s.quadraticCurveTo(-w, h, -w, h - r)
  s.lineTo(-w, -h + r)
  s.quadraticCurveTo(-w, -h, -w + r, -h)
  return new THREE.ShapeGeometry(s)
}

export default function MirrorGizmo() {
  const selectedIds = useScene((s) => s.selectedIds)
  const mirrorSelection = useScene((s) => s.mirrorSelection)
  const objects = useScene((s) => s.objects)

  const [hover, setHover] = useState(null) // the slot, as a number
  const [ghosts, setGhosts] = useState([])

  const plaques = useRef({})
  const tip = useRef()

  const glyph = useMemo(flipGlyph, [])
  const back = useMemo(plaqueBack, [])

  const selected = useMemo(() => {
    const ids = new Set(selectedIds)
    return objects.filter((o) => ids.has(o.id))
  }, [objects, selectedIds])

  /** Where every block's box lands if this handle is pressed. */
  const enter = (slot) => {
    setHover(slot)
    const { units, whole } = alignBounds(selected, meshes)
    if (whole.isEmpty()) return
    const axis = AXIS_KEY[slot]
    const middle = (whole.min[axis] + whole.max[axis]) / 2
    setGhosts(
      units.map(({ box }) => {
        const centre = box.getCenter(new THREE.Vector3())
        centre[axis] = 2 * middle - centre[axis]
        return { centre, size: box.getSize(new THREE.Vector3()) }
      })
    )
  }
  const leave = (slot) => {
    setHover((h) => (h === slot ? null : h))
    setGhosts([])
  }

  useFrame(({ camera }) => {
    if (!selected.length) return
    const { whole } = alignBounds(selected, meshes)
    if (whole.isEmpty()) return

    const centre = whole.getCenter(new THREE.Vector3())
    const k = camera.position.distanceTo(centre)
    const gap = k * GAP_SCREEN
    const size = k * PLAQUE_SCREEN

    for (const handle of HANDLES) {
      const node = plaques.current[handle.slot]
      if (!node) continue
      node.position.set(
        handle.at.x ? edge(whole, 'x', handle.at.x) + (handle.off.x ?? 0) * gap : centre.x,
        handle.at.y ? edge(whole, 'y', handle.at.y) + (handle.off.y ?? 0) * gap : centre.y,
        handle.at.z ? edge(whole, 'z', handle.at.z) + (handle.off.z ?? 0) * gap : centre.z
      )
      // The glyph is drawn pointing along x in its own plane. The two floor
      // handles are laid down flat, one of them turned a quarter so it points
      // into the screen instead of across it. The height handle stays standing
      // and swings to face the camera, since arrows drawn flat on the floor
      // cannot say "up".
      if (handle.slot === 1) {
        node.rotation.set(0, Math.atan2(camera.position.x - node.position.x, camera.position.z - node.position.z), Math.PI / 2)
      } else {
        node.rotation.set(-Math.PI / 2, 0, handle.slot === 2 ? Math.PI / 2 : 0)
      }
      node.scale.setScalar(size * (hover === handle.slot ? HOVER_GROW : 1))
    }

    if (hover !== null && tip.current) {
      const node = plaques.current[hover]
      if (node) tip.current.position.copy(node.position)
    }
  })

  if (!selected.length) return null

  return (
    <group>
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

      {HANDLES.map((handle) => {
        const axis = axisOf(handle.slot)
        const lit = hover === handle.slot
        return (
          <group
            key={handle.slot}
            ref={(g) => {
              plaques.current[handle.slot] = g
            }}
            renderOrder={5}
            onPointerOver={(e) => {
              e.stopPropagation()
              enter(handle.slot)
            }}
            onPointerOut={() => leave(handle.slot)}
            onPointerDown={(e) => {
              // Left button only: the right one is the camera's, and a flip is
              // not something to do by accident while looking round.
              if (e.button !== 0) return
              e.stopPropagation()
              mirrorSelection(handle.slot)
              // The handles move with what they just flipped; work the preview
              // out again for where things are now.
              enter(handle.slot)
            }}
          >
            <mesh geometry={back}>
              <meshBasicMaterial
                color={lit ? axis.color : '#171B24'}
                transparent
                opacity={lit ? 0.95 : 0.82}
                depthTest={false}
                side={THREE.DoubleSide}
              />
            </mesh>
            <mesh geometry={glyph} position={[0, 0, 0.001]}>
              <meshBasicMaterial
                color={lit ? '#FFFFFF' : axis.color}
                transparent
                depthTest={false}
                side={THREE.DoubleSide}
              />
            </mesh>
          </group>
        )
      })}

      {hover !== null && (
        <group ref={tip}>
          <Html zIndexRange={[30, 20]} style={{ pointerEvents: 'none' }}>
            <div className="align-tip">
              {FLIPS[hover]} · <em>{axisOf(hover).label}</em>
            </div>
          </Html>
        </group>
      )}
    </group>
  )
}
