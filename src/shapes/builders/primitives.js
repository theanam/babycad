/**
 * The parametric primitives.
 *
 * Every builder returns a geometry centred on the origin, with +y up, and the
 * default parameters reproduce exactly the fixed shapes the app shipped with —
 * so a build saved before shapes had parameters still looks identical.
 */
import * as THREE from 'three'
import { arcPoints, extrudeProfile, windContours } from '../extrude'

const rad = THREE.MathUtils.degToRad
const TAU = Math.PI * 2

export function buildCube({ width, height, depth }) {
  return new THREE.BoxGeometry(width, height, depth)
}

export function buildSphere({ radius, segments, rings, slice }) {
  return new THREE.SphereGeometry(radius, segments, rings, 0, rad(slice))
}

export function buildCone({ radius, height, sides, sweep }) {
  return new THREE.ConeGeometry(radius, height, sides, 1, false, 0, rad(sweep))
}

export function buildCylinder({ topRadius, bottomRadius, height, sides, sweep }) {
  return new THREE.CylinderGeometry(
    topRadius,
    bottomRadius,
    height,
    sides,
    1,
    false,
    0,
    rad(sweep)
  )
}

export function buildPyramid({ radius, height, sides }) {
  // A cone with few sides is a pyramid; turn it so a face points at the camera
  // rather than an edge, whatever the side count.
  const g = new THREE.ConeGeometry(radius, height, sides)
  g.rotateY(Math.PI / sides)
  return g
}

export function buildTorus({ radius, tube, sides, segments, sweep }) {
  // Lay the donut flat on the floor rather than standing it on edge.
  const g = new THREE.TorusGeometry(radius, tube, sides, segments, rad(sweep))
  g.rotateX(-Math.PI / 2)
  return g
}

/** A ramp: full height along the back edge, tapering to nothing at the front. */
export function buildWedge({ width, height, depth }) {
  const x = width / 2
  const y = height / 2
  const z = depth / 2
  // back-top, back-bottom, front-bottom, on each side
  const L = [
    [-x, y, -z],
    [-x, -y, -z],
    [-x, -y, z],
  ]
  const R = [
    [x, y, -z],
    [x, -y, -z],
    [x, -y, z],
  ]
  const tri = []
  const face = (...pts) => pts.forEach((p) => tri.push(...p))

  face(L[0], L[1], L[2]) // left triangle
  face(R[0], R[2], R[1]) // right triangle
  face(L[1], R[2], L[2]) // floor
  face(L[1], R[1], R[2])
  face(L[0], R[1], L[1]) // back wall
  face(L[0], R[0], R[1])
  face(L[0], R[2], R[0]) // slope
  face(L[0], L[2], R[2])

  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(tri, 3))
  g.computeVertexNormals() // non-indexed, so this comes out flat-shaded
  return g
}

/** A hollow tube. A partial sweep gives a capped channel rather than a ring. */
export function buildPipe({ radius, wall, height, sides, sweep }) {
  const outer = radius
  const inner = Math.max(0.01, radius - wall)
  const arc = rad(sweep)

  let contour
  let holes = []
  if (sweep >= 359.5) {
    contour = arcPoints(outer, sides)
    holes = [arcPoints(inner, sides).reverse()]
  } else {
    // One closed loop: out along the outer arc, back along the inner one.
    const steps = Math.max(2, Math.round((sides * arc) / TAU))
    contour = [
      ...arcPoints(outer, steps, 0, arc, false),
      ...arcPoints(inner, steps, arc, -arc, false),
    ]
  }
  const [c, h] = windContours(contour, holes)
  return extrudeProfile(c, h, { height })
}

/** A star prism, optionally wrung round its own axis on the way up. */
export function buildStar({ points, radius, innerRadius, height, twist }) {
  const inner = Math.min(innerRadius, radius * 0.98)
  const contour = []
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 ? inner : radius
    const a = (TAU * i) / (points * 2) + Math.PI / 2
    contour.push({ x: r * Math.cos(a), y: r * Math.sin(a) })
  }
  const [c] = windContours(contour)
  return extrudeProfile(c, [], { height, twist: rad(twist) })
}
