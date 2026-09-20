/**
 * A small extruder, used by every shape whose cross-section is easier to draw
 * in 2D than to write out in 3D — the pipe, the star, the gear.
 *
 * It exists instead of three's `ExtrudeGeometry` for two reasons:
 *
 *  - **Twist.** A helical gear and a twisted star are the same operation as a
 *    straight extrude with the layers rotated on the way up, and `Extrude`
 *    can't do it.
 *  - **Creases.** `ExtrudeGeometry` emits flat-shaded walls, so a 48-sided
 *    pipe reads as a faceted barrel. Here each contour vertex is smoothed or
 *    split by comparing its two edge normals against a crease angle, which
 *    leaves a gear's involute flanks smooth and its tooth tips sharp.
 *
 * Contours are arrays of `{x, y}` in the cross-section plane, which maps onto
 * world (x, z); the extrusion runs up +y and is centred on the origin. The
 * outer contour must wind counter-clockwise and holes clockwise (see
 * `windContours`, which fixes either for you).
 */
import * as THREE from 'three'

const DEFAULT_CREASE = 35 // degrees; above this a contour corner stays sharp
const TWIST_STEP = Math.PI / 18 // one layer per 10° of twist

/**
 * @param {Array<{x,y}>} contour outer boundary
 * @param {Array<Array<{x,y}>>} holes inner boundaries
 * @param {{height, twist, crease}} opts twist is total radians across `height`
 */
export function extrudeProfile(contour, holes = [], opts = {}) {
  const { height = 1, twist = 0, crease = DEFAULT_CREASE } = opts
  const creaseCos = Math.cos(THREE.MathUtils.degToRad(crease))
  const layers = twist ? Math.max(2, Math.ceil(Math.abs(twist) / TWIST_STEP) + 1) : 2

  const position = []
  const normal = []
  const index = []
  const y0 = -height / 2

  const push = (x, y, z, nx, ny, nz) => {
    position.push(x, y, z)
    normal.push(nx, ny, nz)
  }

  /* ------------------------------------------------------------- walls -- */

  for (const ring of [contour, ...holes]) {
    const n = ring.length
    if (n < 3) continue

    // Outward normal of the edge leaving each vertex. For a CCW contour that
    // points out of the solid; for a CW hole it points into the hole, which is
    // the same thing seen from the material side.
    const edge = []
    for (let i = 0; i < n; i++) {
      const a = ring[i]
      const b = ring[(i + 1) % n]
      const dx = b.x - a.x
      const dy = b.y - a.y
      const len = Math.hypot(dx, dy) || 1
      edge.push({ x: dy / len, y: -dx / len })
    }

    // Two normals per vertex: the wall arriving and the wall leaving. Equal
    // when the corner is shallow enough to smooth over.
    const arriving = []
    const leaving = []
    for (let i = 0; i < n; i++) {
      const a = edge[(i - 1 + n) % n]
      const b = edge[i]
      if (a.x * b.x + a.y * b.y > creaseCos) {
        const len = Math.hypot(a.x + b.x, a.y + b.y) || 1
        const merged = { x: (a.x + b.x) / len, y: (a.y + b.y) / len }
        arriving.push(merged)
        leaving.push(merged)
      } else {
        arriving.push(a)
        leaving.push(b)
      }
    }

    const base = position.length / 3
    for (let j = 0; j < layers; j++) {
      const t = j / (layers - 1)
      const angle = twist * t
      const c = Math.cos(angle)
      const s = Math.sin(angle)
      const y = y0 + height * t
      for (let i = 0; i < n; i++) {
        const p = ring[i]
        const x = p.x * c - p.y * s
        const z = p.x * s + p.y * c
        // Vertex 2i is the copy the leaving wall uses, 2i+1 the arriving one.
        for (const nv of [leaving[i], arriving[i]]) {
          push(x, y, z, nv.x * c - nv.y * s, 0, nv.x * s + nv.y * c)
        }
      }
    }

    const stride = 2 * n
    for (let j = 0; j < layers - 1; j++) {
      for (let i = 0; i < n; i++) {
        const a0 = base + j * stride + 2 * i
        const b0 = base + j * stride + 2 * ((i + 1) % n) + 1
        index.push(a0, b0 + stride, b0, a0, a0 + stride, b0 + stride)
      }
    }
  }

  /* -------------------------------------------------------------- caps -- */

  const toV2 = (p) => new THREE.Vector2(p.x, p.y)
  const faces = THREE.ShapeUtils.triangulateShape(
    contour.map(toV2),
    holes.map((h) => h.map(toV2))
  )
  const flat = [contour, ...holes].flat()

  for (const top of [false, true]) {
    const angle = top ? twist : 0
    const c = Math.cos(angle)
    const s = Math.sin(angle)
    const y = top ? y0 + height : y0
    const base = position.length / 3
    for (const p of flat) push(p.x * c - p.y * s, y, p.x * s + p.y * c, 0, top ? 1 : -1, 0)
    for (const f of faces) {
      if (top) index.push(base + f[2], base + f[1], base + f[0])
      else index.push(base + f[0], base + f[1], base + f[2])
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3))
  geometry.setIndex(index)
  return geometry
}

/** Force the outer contour counter-clockwise and every hole clockwise. */
export function windContours(contour, holes = []) {
  const v2 = (ring) => ring.map((p) => new THREE.Vector2(p.x, p.y))
  const outer = THREE.ShapeUtils.isClockWise(v2(contour)) ? [...contour].reverse() : contour
  const inner = holes.map((h) => (THREE.ShapeUtils.isClockWise(v2(h)) ? h : [...h].reverse()))
  return [outer, inner]
}

/** Sample a circle (or an arc of one) as a contour, counter-clockwise. */
export function arcPoints(radius, sides, from = 0, sweep = Math.PI * 2, closed = true) {
  const pts = []
  const count = closed ? sides : sides + 1
  for (let i = 0; i < count; i++) {
    const a = from + (sweep * i) / sides
    pts.push({ x: radius * Math.cos(a), y: radius * Math.sin(a) })
  }
  return pts
}
