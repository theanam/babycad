/**
 * The parametric primitives.
 *
 * Every builder returns a geometry centred on the origin, with +y up, and the
 * default parameters reproduce exactly the fixed shapes the app shipped with —
 * so a build saved before shapes had parameters still looks identical.
 */
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { arcPoints, extrudeProfile, windContours } from '../extrude'
import { dirTo, edgeFor, softCorner } from '../edges'

/**
 * Turn a profile into a solid by spinning it about the up axis.
 *
 * The profile is (radius, height) pairs; `sides` is how many facets go round.
 * Lathe wants Vector2s and gives back smooth normals, which is what a turned
 * shape wants everywhere except a bevel — a flat chamfer shaded smoothly reads
 * as a soft one. Repeating a profile point splits the normal there, so a bevel
 * gets a crease at each end and stays visibly flat.
 */
function revolve(profile, sides, style) {
  const pts = []
  for (const [r, y] of profile) {
    const last = pts[pts.length - 1]
    if (last && Math.abs(last.x - r) < 1e-9 && Math.abs(last.y - y) < 1e-9) continue
    pts.push(new THREE.Vector2(Math.max(r, 0), y))
  }
  const g = new THREE.LatheGeometry(pts, sides)
  // A bevel is meant to catch the light as its own facet.
  if (style === 'bevel') {
    const flat = g.toNonIndexed()
    flat.computeVertexNormals()
    g.dispose()
    return flat
  }
  return g
}

const rad = THREE.MathUtils.degToRad
const TAU = Math.PI * 2

export function buildCube({ width, height, depth, edge, edgeStyle }) {
  const e = edgeFor(edge, width, height, depth)
  if (!e) return new THREE.BoxGeometry(width, height, depth)
  // RoundedBoxGeometry's segment count is the whole difference between the two
  // styles: one segment across a corner is a flat chamfer, several is a
  // fillet. It rounds all twelve edges, which is what a rounded block means.
  return new RoundedBoxGeometry(width, height, depth, edgeStyle === 'bevel' ? 1 : 4, e)
}

export function buildSphere({ radius, segments, rings, slice }) {
  return new THREE.SphereGeometry(radius, segments, rings, 0, rad(slice))
}

export function buildCone({ radius, height, sides, sweep, edge, edgeStyle }) {
  // Only a full turn is softened. A sliced cone's flat faces are cut surfaces,
  // and a cut edge is sharp by definition — rounding it would be describing
  // something the slice did not do.
  const e = sweep >= 359.5 ? edgeFor(edge, radius, height) : 0
  if (!e) return new THREE.ConeGeometry(radius, height, sides, 1, false, 0, rad(sweep))

  const hh = height / 2
  const base = [radius, -hh]
  const apex = [0, hh]
  return revolve(
    [[0, -hh], ...softCorner(base, [-1, 0], dirTo(base, apex), e, edgeStyle), apex],
    sides,
    edgeStyle
  )
}

export function buildCylinder({ topRadius, bottomRadius, height, sides, sweep, edge, edgeStyle }) {
  const plain = () =>
    new THREE.CylinderGeometry(topRadius, bottomRadius, height, sides, 1, false, 0, rad(sweep))
  // A tube closed to a point at one end has no rim there to soften, so that
  // end's radius is left out of what limits the edge.
  const ends = [bottomRadius, topRadius].filter((r) => r > 1e-4)
  const e = sweep >= 359.5 ? edgeFor(edge, ...ends, height) : 0
  if (!e) return plain()

  const hh = height / 2
  const low = [bottomRadius, -hh]
  const high = [topRadius, hh]
  const up = dirTo(low, high)
  const down = [-up[0], -up[1]]
  return revolve(
    [
      [0, -hh],
      ...(bottomRadius > 1e-4 ? softCorner(low, [-1, 0], up, e, edgeStyle) : [low]),
      ...(topRadius > 1e-4 ? softCorner(high, down, [-1, 0], e, edgeStyle) : [high]),
      [0, hh],
    ],
    sides,
    edgeStyle
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
export function buildPipe({ radius, wall, height, sides, sweep, edge, edgeStyle }) {
  const outer = radius
  const inner = Math.max(0.01, radius - wall)
  const arc = rad(sweep)

  // A full ring is a turned shape, so all four of its rims can be softened at
  // once by spinning a closed profile. A swept one is a cut channel and keeps
  // its cut faces sharp, as a cut face is.
  const e = sweep >= 359.5 ? edgeFor(edge, outer - inner, height) : 0
  if (e) {
    const hh = height / 2
    const loop = [
      ...softCorner([inner, -hh], [0, 1], [1, 0], e, edgeStyle),
      ...softCorner([outer, -hh], [-1, 0], [0, 1], e, edgeStyle),
      ...softCorner([outer, hh], [0, -1], [-1, 0], e, edgeStyle),
      ...softCorner([inner, hh], [1, 0], [0, -1], e, edgeStyle),
    ]
    return revolve([...loop, loop[0]], sides, edgeStyle)
  }

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
