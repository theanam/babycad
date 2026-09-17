import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { useScene } from '../scene/sceneStore'
import { viewport } from '../scene/viewportApi'
import { FitIcon, IsoIcon, ResetIcon } from './icons'

/* Widget geometry, in the SVG's own units. */
const VIEW = 150
const MID = { x: 75, y: 72 }
const S = 23 // half-edge of the cube

/** Axis arrows spring from this corner of the box: left, bottom, front. */
const ORIGIN = [-1, -1, 1]

/**
 * The six faces. `n` is the outward normal, `u` and `v` the in-plane axes the
 * label is laid out along, all in the cube's own space.
 */
const FACES = [
  { key: 'front', label: 'FRONT', n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  { key: 'back', label: 'BACK', n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
  { key: 'right', label: 'RIGHT', n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },
  { key: 'left', label: 'LEFT', n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  { key: 'top', label: 'TOP', n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] },
  { key: 'bottom', label: 'BOTTOM', n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
]

/**
 * Arm lengths differ on purpose. X and Y start at the far side of the box and
 * run along its edges, so they need to span it; Z starts on the front face
 * already and only has to poke out towards the viewer.
 */
const AXES = [
  { key: 'x', vec: [1, 0, 0], color: '#FF5A47', arm: 2.3 },
  { key: 'y', vec: [0, 1, 0], color: '#35C46B', arm: 2.3 },
  { key: 'z', vec: [0, 0, 1], color: '#2E7DF6', arm: 1.05 },
]

// Past this, a press is a turn of the view rather than a tap on a face.
const DRAG_SLOP = 4
// A full turn per this many pixels. Much tighter than the canvas, so a short
// drag across a small cube swings the view a useful amount.
const TURN_SPAN = 240

/**
 * Viewport mover: an orientation cube with the axis arrows springing off its
 * front-bottom-left corner, and the camera buttons beneath.
 *
 * Tap a face to look from that side; drag the cube to turn the view. Drawn by
 * projecting the eight corners by hand rather than with CSS 3D — a CSS cube
 * sweeps out about 1.7x its own face size as it turns and spills out of any
 * frame tight enough to sit in a screen corner. Projecting keeps everything
 * inside a fixed viewBox and lets the arrows share the exact same rotation, so
 * cube and axes read as one object.
 *
 * A cube is convex, so at most three faces ever point at you and they never
 * overlap: hiding the back faces is all the sorting this needs. The arrows are
 * drawn last so they stay legible whichever way they point.
 */
export default function ViewCube() {
  const selectedIds = useScene((s) => s.selectedIds)
  const parts = useRef({})
  const drag = useRef(null)
  const turned = useRef(false)

  /* ------------------------------------------------- follow the camera -- */

  useEffect(() => {
    let raf = 0
    const q = new THREE.Quaternion()
    const v = new THREE.Vector3()
    const N = new THREE.Vector3()
    const U = new THREE.Vector3()
    const V = new THREE.Vector3()
    const from = new THREE.Vector3()
    const to = new THREE.Vector3()

    // Cube space to SVG space. SVG y grows downward, hence the negation.
    const sx = (n) => MID.x + n * S
    const sy = (n) => MID.y - n * S

    const tick = () => {
      raf = requestAnimationFrame(tick)
      const camera = viewport.camera
      if (!camera) return

      // The cube shows what the camera sees, so it wears the camera's
      // rotation backwards.
      q.copy(camera.quaternion).invert()

      for (const face of FACES) {
        const part = parts.current[face.key]
        if (!part) continue

        N.set(...face.n).applyQuaternion(q)
        if (N.z <= 0.02) {
          // Facing away: there is nothing to draw in front.
          part.poly.setAttribute('display', 'none')
          part.label.setAttribute('display', 'none')
          continue
        }
        part.poly.setAttribute('display', '')
        part.label.setAttribute('display', '')

        U.set(...face.u).applyQuaternion(q)
        V.set(...face.v).applyQuaternion(q)

        const points = [
          [1, 1],
          [-1, 1],
          [-1, -1],
          [1, -1],
        ]
          .map(([a, b]) => {
            v.copy(N).addScaledVector(U, a).addScaledVector(V, b)
            return `${sx(v.x).toFixed(1)},${sy(v.y).toFixed(1)}`
          })
          .join(' ')
        part.poly.setAttribute('points', points)
        // Faces square-on to the camera read brightest.
        part.poly.setAttribute('fill-opacity', (0.5 + 0.45 * N.z).toFixed(2))

        // Lay the label flat on the face: x along u, y down the reverse of v.
        part.label.setAttribute(
          'transform',
          `matrix(${(U.x * S).toFixed(3)},${(-U.y * S).toFixed(3)},${(-V.x * S).toFixed(3)},${(V.y * S).toFixed(3)},${sx(N.x).toFixed(1)},${sy(N.y).toFixed(1)})`
        )
        part.label.setAttribute('fill-opacity', (0.55 + 0.45 * N.z).toFixed(2))
      }

      // Arrows, from the box corner outwards along each axis.
      from.set(...ORIGIN).applyQuaternion(q)
      const ox = sx(from.x)
      const oy = sy(from.y)

      for (const axis of AXES) {
        const part = parts.current[axis.key]
        if (!part) continue
        to.set(...ORIGIN).addScaledVector(v.set(...axis.vec), axis.arm).applyQuaternion(q)
        const tx = sx(to.x)
        const ty = sy(to.y)

        // Direction of the arrow once flattened onto the screen.
        let dx = tx - ox
        let dy = ty - oy
        const len = Math.hypot(dx, dy) || 1
        dx /= len
        dy /= len
        const head = 6
        const wing = 3.2
        // Stop the shaft short so it doesn't poke through the arrowhead.
        part.line.setAttribute('x1', ox.toFixed(1))
        part.line.setAttribute('y1', oy.toFixed(1))
        part.line.setAttribute('x2', (tx - dx * head).toFixed(1))
        part.line.setAttribute('y2', (ty - dy * head).toFixed(1))
        part.head.setAttribute(
          'points',
          [
            `${tx.toFixed(1)},${ty.toFixed(1)}`,
            `${(tx - dx * head - dy * wing).toFixed(1)},${(ty - dy * head + dx * wing).toFixed(1)}`,
            `${(tx - dx * head + dy * wing).toFixed(1)},${(ty - dy * head - dx * wing).toFixed(1)}`,
          ].join(' ')
        )
        part.label.setAttribute('x', (tx + dx * 8).toFixed(1))
        part.label.setAttribute('y', (ty + dy * 8).toFixed(1))

        // Arrows pointing away from the viewer fade back.
        const depth = (0.45 + 0.55 * (to.z * 0.5 + 0.5)).toFixed(2)
        part.line.setAttribute('opacity', depth)
        part.head.setAttribute('opacity', depth)
        part.label.setAttribute('opacity', depth)
      }
    }

    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  /* ------------------------------------------- drag the box, turn the view -- */

  const onPointerDown = (event) => {
    if (event.target.closest('button.vc-btn')) return
    turned.current = false
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  const onPointerMove = (event) => {
    const d = drag.current
    if (!d || event.pointerId !== d.id) return
    const dx = event.clientX - d.x
    const dy = event.clientY - d.y
    if (!turned.current && Math.hypot(dx, dy) <= DRAG_SLOP) return
    turned.current = true
    viewport.orbitBy(dx, dy, TURN_SPAN)
    d.x = event.clientX
    d.y = event.clientY
  }

  const onPointerUp = (event) => {
    if (!drag.current || event.pointerId !== drag.current.id) return
    drag.current = null
    event.currentTarget.releasePointerCapture?.(event.pointerId)
  }

  const bind = (key, part) => (node) => {
    if (!node) return
    parts.current[key] = { ...parts.current[key], [part]: node }
  }

  /** A drag that happened to start on a face must not also snap the camera. */
  const lookFrom = (face) => {
    if (turned.current) return
    const dir = [...face.n]
    // Looking exactly along the up axis leaves the camera with no idea which
    // way is up, so tip it a hair off vertical.
    if (Math.abs(dir[1]) > 0.99) dir[2] = 0.001
    viewport.lookFrom(dir)
  }

  return (
    <div className="viewcube">
      <svg
        className="viewcube-art"
        viewBox={`0 0 ${VIEW} ${VIEW}`}
        role="group"
        aria-label="Turn the view"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {/* cube */}
        {FACES.map((face) => (
          <g key={face.key}>
            <polygon
              ref={bind(face.key, 'poly')}
              className="cube-face"
              points=""
              fill="#232936"
              stroke="#3A4254"
              strokeWidth="1"
              strokeLinejoin="round"
              onClick={() => lookFrom(face)}
            >
              <title>Look from the {face.label.toLowerCase()}</title>
            </polygon>
            <text
              ref={bind(face.key, 'label')}
              className="cube-label"
              fontSize="0.36"
              fill="#E7EAF0"
              fontFamily="'JetBrains Mono', monospace"
              textAnchor="middle"
              dominantBaseline="middle"
            >
              {face.label}
            </text>
          </g>
        ))}

        {/* axis arrows, drawn over the box so they stay readable */}
        {AXES.map((axis) => (
          <g key={axis.key} className="axis-arrow">
            <line
              ref={bind(axis.key, 'line')}
              stroke={axis.color}
              strokeWidth="2"
              strokeLinecap="round"
            />
            <polygon ref={bind(axis.key, 'head')} points="" fill={axis.color} />
            <text
              ref={bind(axis.key, 'label')}
              fill={axis.color}
              fontSize="10"
              fontFamily="'JetBrains Mono', monospace"
              textAnchor="middle"
              dominantBaseline="middle"
            >
              {axis.key}
            </text>
          </g>
        ))}
      </svg>

      <div className="viewcube-btns">
        <button className="vc-btn" onClick={() => viewport.resetView()} title="Reset the view">
          <ResetIcon size={18} stroke="#C3CAD9" />
        </button>
        <button
          className="vc-btn"
          onClick={() => viewport.fit(selectedIds)}
          title={selectedIds.length ? 'Fit the selection' : 'Fit the whole build'}
        >
          <FitIcon size={18} stroke="#C3CAD9" />
        </button>
        <button className="vc-btn" onClick={() => viewport.isoView()} title="Corner view">
          <IsoIcon size={18} stroke="#C3CAD9" />
        </button>
      </div>
    </div>
  )
}
