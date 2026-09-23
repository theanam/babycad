/**
 * Deciding what a drag box has caught.
 *
 * Kept apart from the component that draws the box because it is arithmetic
 * and nothing else: no React, no DOM, nothing that needs a browser to run —
 * which is what lets `tools/check-marquee` put a camera in front of it and ask
 * the questions that matter directly.
 *
 * A block counts as touched if its shape on screen overlaps the box, not if it
 * is swallowed whole: requiring full containment means a kid who drags across
 * four blocks gets none of them, because each pokes out slightly.
 *
 * *Its shape*, and not the upright rectangle drawn around that shape. Those
 * are the same thing for a cube seen face on and wildly different for anything
 * long lying at an angle: a 200 mm bar running corner to corner across the
 * view has a rectangle around it that covers most of the screen, so a box
 * drawn anywhere inside that span — around two small parts in the middle,
 * nowhere near the bar — swept the bar up with them.
 */
import * as THREE from 'three'

/** The eight corners of a mesh's box, in viewport pixels. */
const _v = new THREE.Vector3()
export function screenCornersOf(mesh, camera, rect) {
  const geometry = mesh.geometry
  if (!geometry.boundingBox) geometry.computeBoundingBox()
  const bb = geometry.boundingBox
  if (!bb) return null

  const points = []
  for (const x of [bb.min.x, bb.max.x]) {
    for (const y of [bb.min.y, bb.max.y]) {
      for (const z of [bb.min.z, bb.max.z]) {
        _v.set(x, y, z).applyMatrix4(mesh.matrixWorld).project(camera)
        // A corner behind the eye projects to nonsense — the perspective divide
        // flips it through the origin. Corners in front are enough to place the
        // block on screen, and a block with none is not on screen at all.
        if (_v.z > 1) continue
        points.push([
          rect.left + ((_v.x + 1) / 2) * rect.width,
          rect.top + ((1 - _v.y) / 2) * rect.height,
        ])
      }
    }
  }
  return points.length ? points : null
}

/**
 * The outline of a set of points, anticlockwise, by Andrew's monotone chain.
 *
 * A box is convex and so is its shadow, so the outline of the eight projected
 * corners is exactly the block's silhouette — nothing is being approximated
 * here, only the upright rectangle that used to stand in for it is being
 * dropped.
 */
export function hullOf(points) {
  if (points.length < 3) return points
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const turn = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const half = (order) => {
    const out = []
    for (const p of order) {
      while (out.length > 1 && turn(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop()
      out.push(p)
    }
    out.pop()
    return out
  }
  const hull = [...half(sorted), ...half([...sorted].reverse())]
  return hull.length >= 3 ? hull : points
}

/**
 * Do a convex outline and an upright rectangle touch?
 *
 * By separating axes: two convex shapes are apart exactly when some line can
 * be drawn between them, and the only lines worth trying are the ones square
 * to an edge of one or the other. The rectangle contributes two — across and
 * down — and the outline one per edge.
 */
export function hullHitsRect(hull, box) {
  if (!hull?.length) return false
  const corners = [
    [box.minX, box.minY],
    [box.maxX, box.minY],
    [box.maxX, box.maxY],
    [box.minX, box.maxY],
  ]
  const apart = (axis) => {
    let loA = Infinity
    let hiA = -Infinity
    for (const p of hull) {
      const d = p[0] * axis[0] + p[1] * axis[1]
      if (d < loA) loA = d
      if (d > hiA) hiA = d
    }
    let loB = Infinity
    let hiB = -Infinity
    for (const p of corners) {
      const d = p[0] * axis[0] + p[1] * axis[1]
      if (d < loB) loB = d
      if (d > hiB) hiB = d
    }
    return hiA < loB || hiB < loA
  }

  if (apart([1, 0]) || apart([0, 1])) return false
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i]
    const b = hull[(i + 1) % hull.length]
    const axis = [-(b[1] - a[1]), b[0] - a[0]]
    if (Math.hypot(axis[0], axis[1]) < 1e-9) continue
    if (apart(axis)) return false
  }
  return true
}
