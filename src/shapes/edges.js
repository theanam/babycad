import * as THREE from 'three'

/**
 * Taking the edge off a corner.
 *
 * Every round shape here — the tube, the cone, the pipe — is a flat profile
 * turned about the up axis, so softening its edges is a two-dimensional job:
 * find the corner of the profile, come back along both walls, and join the two
 * points up. A bevel joins them with a straight line, a round with a curve.
 *
 * The curve is a quadratic Bézier with the corner itself as the control point.
 * For a right angle with equal legs that is within a percent of a true quarter
 * circle, and unlike an arc it needs no centre, no radius and no trigonometry
 * — which means it cannot fail on a corner that is nearly flat or nearly
 * folded back on itself. Those turn up as soon as a tube tapers.
 */

/**
 * Points replacing a square corner with a softened one.
 *
 * `corner` is where the two walls meet. `a` and `b` are unit directions
 * pointing away from it along each wall, given in the order the profile is
 * travelled. The result starts on the `a` wall and ends on the `b` wall.
 */
export function softCorner(corner, a, b, size, style, segments = 4) {
  const [cx, cy] = corner
  const p0 = [cx + a[0] * size, cy + a[1] * size]
  const p1 = [cx + b[0] * size, cy + b[1] * size]
  if (!(size > 0)) return [[cx, cy]]
  if (style === 'bevel') return [p0, p1]

  const out = []
  for (let i = 0; i <= segments; i++) {
    const t = i / segments
    const u = 1 - t
    out.push([
      u * u * p0[0] + 2 * u * t * cx + t * t * p1[0],
      u * u * p0[1] + 2 * u * t * cy + t * t * p1[1],
    ])
  }
  return out
}

/** Unit direction from one point to another, for the wall between them. */
export function dirTo(from, to) {
  const dx = to[0] - from[0]
  const dy = to[1] - from[1]
  const len = Math.hypot(dx, dy) || 1
  return [dx / len, dy / len]
}

/**
 * How much edge a shape can actually lose.
 *
 * The slider offers millimetres that suit a big block; a small one has to say
 * no. Anything at or below zero means leave the corner alone. The 0.49 keeps
 * two facing edges from eating the whole wall between them and meeting in the
 * middle, which is where a profile turns inside out.
 */
export function edgeFor(size, ...limits) {
  const room = Math.min(...limits) * 0.49
  const e = Math.min(size ?? 0, room)
  return e > 1e-4 ? e : 0
}

/* --------------------------------------------------------- closing up -- */

/**
 * Where a profile point lands once it has been spun round.
 *
 * Every round shape here is a flat profile turned about an axis, but three
 * does not agree with itself about which way an angle goes: a cylinder starts
 * its turn on +z, a sphere on −x, and a donut is spun about z and laid flat
 * afterwards. The cap has to sit exactly where the shape's own wall stopped,
 * so each shape says which of these it was built with rather than being
 * assumed to use the common one.
 */
export const SPIN = {
  /** Cylinder, cone and lathe: the turn begins on +z and swings toward +x. */
  lathe: (r, y, phi) => [r * Math.sin(phi), y, r * Math.cos(phi)],
  /** Sphere: the same turn, begun a quarter earlier and going the other way. */
  ball: (r, y, phi) => [-r * Math.cos(phi), y, r * Math.sin(phi)],
  /** Torus, which is spun about z and only laid flat afterwards. */
  ring: (r, z, phi) => [r * Math.cos(phi), r * Math.sin(phi), z],
}

/** Add triangles to a geometry without disturbing the normals it came with. */
function withFaces(geometry, positions, normals) {
  const flat = geometry.getIndex() ? geometry.toNonIndexed() : geometry
  const pos = flat.getAttribute('position')
  let nrm = flat.getAttribute('normal')
  if (!nrm) {
    flat.computeVertexNormals()
    nrm = flat.getAttribute('normal')
  }
  const n = pos.count * 3
  const mergedPos = new Float32Array(n + positions.length)
  mergedPos.set(pos.array.subarray(0, n), 0)
  mergedPos.set(positions, n)
  const mergedNrm = new Float32Array(n + normals.length)
  mergedNrm.set(nrm.array.subarray(0, n), 0)
  mergedNrm.set(normals, n)

  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.BufferAttribute(mergedPos, 3))
  out.setAttribute('normal', new THREE.BufferAttribute(mergedNrm, 3))
  if (flat !== geometry) flat.dispose()
  geometry.dispose()
  return out
}

/**
 * Close the two flat faces a partial sweep leaves open.
 *
 * three takes a partial sweep by simply leaving triangles out: a tube turned a
 * quarter of the way round is the curved wall and two pie-slice ends, with
 * nothing at all across the two flat faces where it was cut. On screen that is
 * a shape you can see straight through — the sides look unshaded because there
 * is no side there — and in an STL it is not a solid, so a slicer either
 * refuses it or fills it with something nobody asked for.
 *
 * The missing faces are not guessed at from the hole they leave. A hole can be
 * closed in more than one way, and for a cut cone the two ways differ by a
 * third of its volume, so there is nothing in the opening itself that says
 * which was meant. Instead each shape hands over the profile it was spun from,
 * which is exactly the outline of one cut face; placing that outline at each
 * end of the sweep and filling it in gives back precisely the surface the cut
 * took away.
 *
 * Normals are set flat across each face and the wall's own are kept, so a
 * sliced ball stays smooth everywhere except where it was cut.
 */
export function sweepFaces(geometry, profile, sweep, spin = SPIN.lathe) {
  if (!(sweep < 359.5)) return geometry

  const pts = []
  for (const [r, y] of profile) {
    const last = pts[pts.length - 1]
    if (last && Math.abs(last[0] - r) < 1e-9 && Math.abs(last[1] - y) < 1e-9) continue
    pts.push([r, y])
  }
  if (pts.length < 3) return geometry

  const positions = []
  const normals = []
  for (const far of [false, true]) {
    const phi = far ? (sweep * Math.PI) / 180 : 0
    // A cut face looks straight along the sweep at the far end and back down
    // it at the near one, which is the turn's own direction there. Taking it
    // from the spin rather than working it out by hand means it stays right
    // whichever way round that particular shape turns.
    const here = spin(1, 0, phi)
    const ahead = spin(1, 0, phi + 1e-4)
    const d = [ahead[0] - here[0], ahead[1] - here[1], ahead[2] - here[2]]
    const len = Math.hypot(d[0], d[1], d[2]) || 1
    const n = d.map((v) => (far ? v : -v) / len)

    const ring = pts.map(([r, y]) => spin(r, y, phi))
    const mid = [0, 1, 2].map((i) => ring.reduce((sum, p) => sum + p[i], 0) / ring.length)
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]
      const b = ring[(i + 1) % ring.length]
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
      const v = [mid[0] - a[0], mid[1] - a[1], mid[2] - a[2]]
      const facing =
        (u[1] * v[2] - u[2] * v[1]) * n[0] +
        (u[2] * v[0] - u[0] * v[2]) * n[1] +
        (u[0] * v[1] - u[1] * v[0]) * n[2]
      if (facing >= 0) positions.push(...a, ...b, ...mid)
      else positions.push(...a, ...mid, ...b)
      normals.push(...n, ...n, ...n)
    }
  }
  return withFaces(geometry, positions, normals)
}

/** Rebuild a geometry from a chosen subset of its triangles, attributes and all. */
function keepTriangles(geometry, keep) {
  const flat = geometry.getIndex() ? geometry.toNonIndexed() : geometry
  const count = flat.getAttribute('position').count / 3
  const wanted = []
  for (let t = 0; t < count; t++) if (keep(t)) wanted.push(t)
  if (wanted.length === count) {
    if (flat !== geometry) {
      geometry.dispose()
      return flat
    }
    return geometry
  }

  const out = new THREE.BufferGeometry()
  for (const name of Object.keys(flat.attributes)) {
    const from = flat.getAttribute(name)
    const size = from.itemSize
    const to = new Float32Array(wanted.length * 3 * size)
    wanted.forEach((t, at) => {
      for (let j = 0; j < 3 * size; j++) to[at * 3 * size + j] = from.array[t * 3 * size + j]
    })
    out.setAttribute(name, new THREE.BufferAttribute(to, size))
  }
  if (flat !== geometry) flat.dispose()
  geometry.dispose()
  return out
}

/**
 * Throw away triangles with no area in them.
 *
 * A lathe makes these wherever its profile touches the axis: every facet round
 * the turn gets a quad, and at the axis two of that quad's corners are the
 * same point, so half of the ring comes out as slivers with no area. On screen
 * they draw nothing. In an exported file they are a fault a slicer will report
 * — and the ring of real triangles beside them already closes the end, so
 * there is nothing to put in their place.
 */
export function dropDegenerate(geometry) {
  const pos = (geometry.getIndex() ? geometry.toNonIndexed() : geometry).getAttribute('position')
  const area = (t) => {
    const at = (j) => [pos.getX(t * 3 + j), pos.getY(t * 3 + j), pos.getZ(t * 3 + j)]
    const [a, b, c] = [at(0), at(1), at(2)]
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
    return Math.hypot(
      u[1] * v[2] - u[2] * v[1],
      u[2] * v[0] - u[0] * v[2],
      u[0] * v[1] - u[1] * v[0]
    ) / 2
  }
  return keepTriangles(geometry, (t) => area(t) > 1e-12)
}

/**
 * Close the flat rims a shape has been left open at.
 *
 * For a shape swept round its own axis use `sweepFaces` instead: the two faces
 * a part-turn cuts meet along that axis and leave one loop folded down the
 * middle, which cannot be filled in by looking at it. This is for the simpler
 * case of genuinely flat, separate rims — the two ends of a length of tube —
 * where the loop is one flat ring and filling it is unambiguous.
 */
export function capRims(geometry) {
  const flat = geometry.getIndex() ? geometry.toNonIndexed() : geometry
  const pos = flat.getAttribute('position')
  const key = (i) =>
    `${Math.round(pos.getX(i) * 1e4)},${Math.round(pos.getY(i) * 1e4)},${Math.round(pos.getZ(i) * 1e4)}`

  // An edge travelled only one way was never travelled back, so it is a rim.
  const seen = new Map()
  for (let t = 0; t < pos.count; t += 3)
    for (let i = 0; i < 3; i++) {
      const a = key(t + i)
      const b = key(t + ((i + 1) % 3))
      if (a !== b) seen.set(`${a}>${b}`, (seen.get(`${a}>${b}`) ?? 0) + 1)
    }
  const where = new Map()
  for (let i = 0; i < pos.count; i++)
    if (!where.has(key(i))) where.set(key(i), [pos.getX(i), pos.getY(i), pos.getZ(i)])

  // The missing triangle runs the other way, so that is the way to build it.
  const next = new Map()
  for (const [edge, times] of seen) {
    const [a, b] = edge.split('>')
    if (times === 1 && !seen.get(`${b}>${a}`)) next.set(b, a)
  }
  if (!next.size) return geometry

  const positions = []
  const normals = []
  const walked = new Set()
  for (const start of next.keys()) {
    if (walked.has(start)) continue
    const loop = []
    let at = start
    while (at && !walked.has(at) && loop.length <= next.size) {
      walked.add(at)
      loop.push(where.get(at))
      at = next.get(at)
    }
    if (loop.length < 3) continue

    const mid = [0, 1, 2].map((k) => loop.reduce((s, p) => s + p[k], 0) / loop.length)
    const fan = []
    for (let i = 0; i < loop.length; i++) fan.push([loop[i], loop[(i + 1) % loop.length], mid])
    // The rim is flat, so one normal does for the whole cap — taken from the
    // triangles just built rather than worked out again, so it agrees with the
    // way round they wind. The wall keeps the normals it came with: recomputing
    // those would average them over the whole tube and turn a smoothly coiled
    // wire into a faceted one.
    let face = [0, 0, 0]
    for (const [a, b, c] of fan) {
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
      const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
      face = [
        face[0] + u[1] * v[2] - u[2] * v[1],
        face[1] + u[2] * v[0] - u[0] * v[2],
        face[2] + u[0] * v[1] - u[1] * v[0],
      ]
    }
    const len = Math.hypot(face[0], face[1], face[2]) || 1
    const unit = face.map((k) => k / len)
    for (const [a, b, c] of fan) {
      positions.push(...a, ...b, ...c)
      normals.push(...unit, ...unit, ...unit)
    }
  }
  if (!positions.length) return geometry
  if (flat !== geometry) flat.dispose()
  return withFaces(geometry, positions, normals)
}
