/**
 * A sketch document, flattened into what the extruder eats.
 *
 * Three jobs, in order: turn every node into rings of points; work out which
 * rings are material and which are holes; hand back islands wound the way
 * `extrudeProfile` and `ShapeUtils.triangulateShape` both require and neither
 * will tell you about.
 *
 * **The plane, and the one sign that matters.** A drawing's +y is the plate's
 * Y — the name `scene/axes` puts on it — and the scene underneath is y-up with
 * displayed Y running along internal −z. `extrudeProfile` lays a contour's
 * (x, y) onto internal (x, z). So a drawing's y is negated on the way through
 * here, and that is the whole of the mapping; get it wrong and every drawing
 * arrives mirrored, which reads as correct right up until the first letter.
 *
 * Handedness flips with that negation, which is harmless: `windContours` is
 * asked afterwards and it fixes either direction.
 */
import * as THREE from 'three'
import { windContours } from '../extrude'
import { valueOf } from './doc'
import { unionIslands } from './union'

/** Two points closer than this are one point. */
const WELD = 1e-4
/** A ring enclosing less than this, in square millimetres, is not a shape. */
const TINY_AREA = 1e-3

/**
 * How finely a free curve is sampled: one point per this many millimetres of
 * it at the default smoothness, finer or coarser as that is turned. A circle
 * gets exactly `sides` points; a cubic has no radius to count against, so it
 * is measured by the length of its control polygon instead.
 */
const CURVE_MM = 0.5
const CURVE_AT = 32
const MAX_CURVE_POINTS = 64

const clamp = (n, lo, hi) => (n < lo ? lo : n > hi ? hi : n)

/* -------------------------------------------------------------- rings -- */

/** One point, taken out of the drawing's plane into the extruder's. */
const at = (x, y) => ({ x, y: -y })

function pushPoint(pts, p) {
  const last = pts[pts.length - 1]
  if (last && Math.abs(last.x - p.x) < WELD && Math.abs(last.y - p.y) < WELD) return
  pts.push(p)
}

function sampleCubic(pts, x0, y0, x1, y1, x2, y2, x3, y3, sides) {
  const span =
    Math.hypot(x1 - x0, y1 - y0) + Math.hypot(x2 - x1, y2 - y1) + Math.hypot(x3 - x2, y3 - y2)
  const n = clamp(Math.ceil(span / ((CURVE_MM * CURVE_AT) / sides)), 2, MAX_CURVE_POINTS)
  for (let i = 1; i <= n; i++) {
    const t = i / n
    const u = 1 - t
    const a = u * u * u
    const b = 3 * u * u * t
    const c = 3 * u * t * t
    const d = t * t * t
    pushPoint(pts, at(a * x0 + b * x1 + c * x2 + d * x3, a * y0 + b * y1 + c * y2 + d * y3))
  }
}

function sampleQuadratic(pts, x0, y0, x1, y1, x2, y2, sides) {
  // A quadratic is a cubic with its two handles two thirds of the way out.
  sampleCubic(
    pts,
    x0, y0,
    x0 + (2 / 3) * (x1 - x0), y0 + (2 / 3) * (y1 - y0),
    x2 + (2 / 3) * (x1 - x2), y2 + (2 / 3) * (y1 - y2),
    x2, y2,
    sides
  )
}

/**
 * An elliptical arc, given the way `THREE.EllipseCurve` gives it. `sides`
 * points to a whole turn, so an arc gets its share of them and a circle drawn
 * as an arc and one drawn as a circle come out with the same smoothness.
 */
function sampleArc(pts, cx, cy, rx, ry, a0, a1, clockwise, rotation, sides, skipFirst) {
  let span = a1 - a0
  if (clockwise && span > 0) span -= Math.PI * 2
  if (!clockwise && span < 0) span += Math.PI * 2
  const n = clamp(Math.ceil((sides * Math.abs(span)) / (Math.PI * 2)), 2, sides * 2)
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)
  for (let i = skipFirst ? 1 : 0; i <= n; i++) {
    const a = a0 + (span * i) / n
    const ex = rx * Math.cos(a)
    const ey = ry * Math.sin(a)
    pushPoint(pts, at(cx + ex * cos - ey * sin, cy + ex * sin + ey * cos))
  }
}

/** A rectangle, with its corners taken off if it has a radius. */
function rectRing(node, sides) {
  const x = valueOf(node.x)
  const y = valueOf(node.y)
  const w = valueOf(node.w)
  const h = valueOf(node.h)
  const r = clamp(valueOf(node.r), 0, Math.min(w, h) / 2)
  const pts = []
  if (r <= WELD) {
    for (const [px, py] of [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]) pushPoint(pts, at(px, py))
    return { pts, closed: true }
  }
  // Anticlockwise from the bottom-left corner, in the drawing's own plane.
  const corners = [
    [x + r, y + r, Math.PI, Math.PI * 1.5],
    [x + w - r, y + r, Math.PI * 1.5, Math.PI * 2],
    [x + w - r, y + h - r, 0, Math.PI * 0.5],
    [x + r, y + h - r, Math.PI * 0.5, Math.PI],
  ]
  for (const [cx, cy, a0, a1] of corners) {
    sampleArc(pts, cx, cy, r, r, a0, a1, false, 0, sides, false)
  }
  return { pts, closed: true }
}

/**
 * Every ring a node draws. A path can hold several; everything else is one.
 *
 * Exported because the drawing editor draws these rather than drawing its own
 * idea of a rectangle: what is on screen is then the same polygon the solid
 * is made of, down to the facet count, and there is no second renderer to
 * disagree with this one.
 */
export function ringsOfNode(node, sides) {
  switch (node.kind) {
    case 'rect':
      return [rectRing(node, sides)]

    case 'circle': {
      const r = valueOf(node.r)
      const pts = []
      sampleArc(pts, valueOf(node.cx), valueOf(node.cy), r, r, 0, Math.PI * 2, false, 0, sides, false)
      // The sweep comes back round to where it started; a closed ring does
      // not repeat its first point.
      pts.pop()
      return [{ pts, closed: true }]
    }

    case 'poly': {
      const pts = []
      for (const [x, y] of node.pts) pushPoint(pts, at(x, y))
      return [{ pts, closed: node.closed }]
    }

    case 'path': {
      const rings = []
      let pts = null
      let cx = 0
      let cy = 0
      let sx = 0
      let sy = 0
      const finish = (closed) => {
        if (pts && pts.length) rings.push({ pts, closed })
        pts = null
      }
      for (const seg of node.segs) {
        const [op] = seg
        if (op === 'M') {
          finish(false)
          pts = []
          cx = sx = seg[1]
          cy = sy = seg[2]
          pushPoint(pts, at(cx, cy))
        } else if (!pts) {
          continue
        } else if (op === 'L') {
          cx = seg[1]
          cy = seg[2]
          pushPoint(pts, at(cx, cy))
        } else if (op === 'Q') {
          sampleQuadratic(pts, cx, cy, seg[1], seg[2], seg[3], seg[4], sides)
          cx = seg[3]
          cy = seg[4]
        } else if (op === 'C') {
          sampleCubic(pts, cx, cy, seg[1], seg[2], seg[3], seg[4], seg[5], seg[6], sides)
          cx = seg[5]
          cy = seg[6]
        } else if (op === 'E') {
          const [, ax, ay, rx, ry, a0, a1, cw, rot] = seg
          sampleArc(pts, ax, ay, rx, ry, a0, a1, cw === 1, rot, sides, true)
          const end = pts[pts.length - 1]
          cx = end.x
          cy = -end.y
        } else if (op === 'Z') {
          finish(true)
          cx = sx
          cy = sy
        }
      }
      finish(false)
      return rings
    }

    default:
      return []
  }
}

/* ---------------------------------------------------------- the sieve -- */

const areaOf = (pts) => {
  let a = 0
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    a += (pts[j].x + pts[i].x) * (pts[j].y - pts[i].y)
  }
  return a / 2
}

const boundsOf = (pts) => {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of pts) {
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
  }
  return { minX, minY, maxX, maxY }
}

const inside = (p, ring) => {
  let hit = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]
    const b = ring[j]
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) hit = !hit
  }
  return hit
}

/**
 * Does this ring cross itself?
 *
 * `triangulateShape` does not refuse a figure-of-eight; it returns a mess of
 * triangles, which is a solid that looks wrong rather than an error anybody
 * can act on. So a ring that crosses itself is dropped and the count is
 * reported — not a repair, because repairing one means deciding what the
 * person meant, but a missing outline you can see beats a part that will not
 * slice.
 *
 * Every pair of edges, which is quadratic, so it is only asked of rings small
 * enough for that to be free. Above the limit are flattened curves out of an
 * imported file, where the crossing risk is the author's and the cost here
 * would be seconds on every smoothness nudge.
 */
const CROSS_LIMIT = 600

function crosses(pts) {
  if (pts.length > CROSS_LIMIT) return false
  const n = pts.length
  for (let i = 0; i < n; i++) {
    const a1 = pts[i]
    const a2 = pts[(i + 1) % n]
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue // neighbours around the seam
      if (segmentsCross(a1, a2, pts[j], pts[(j + 1) % n])) return true
    }
  }
  return false
}

const side = (a, b, c) => Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x))

function segmentsCross(a1, a2, b1, b2) {
  const d1 = side(a1, a2, b1)
  const d2 = side(a1, a2, b2)
  const d3 = side(b1, b2, a1)
  const d4 = side(b1, b2, a2)
  // Proper crossings only. Touching at a point is what a drawn shape does at
  // its own corners and is not an error.
  return d1 !== d2 && d3 !== d4 && d1 !== 0 && d2 !== 0 && d3 !== 0 && d4 !== 0
}

/* ------------------------------------------------------------ islands -- */

/**
 * Flatten a document.
 *
 * @returns `{ islands, dropped, rings }`:
 *
 *  - `islands` — each `{ contour, holes }`, wound for the extruder. This is
 *    what the builder uses and the only part of the answer it looks at.
 *  - `dropped` — a tally of what was left out, which the properties rail says
 *    out loud so a missing outline is not a mystery.
 *  - `rings` — every ring that was considered, saying which node it came from
 *    and what became of it: `solid`, `hole`, or why it was left out. The
 *    editor draws off this, so the picture on screen and the solid that gets
 *    built cannot disagree about which ring is a hole.
 */
export function flattenSketch(doc, sides = 32) {
  const dropped = { open: 0, tiny: 0, crossing: 0 }
  const kept = []
  const rings = []

  let index = -1
  for (const node of doc?.nodes ?? []) {
    index++
    for (const ring of ringsOfNode(node, sides)) {
      // An open run has no thickness to give it, and closing one behind
      // somebody's back makes a shape nobody drew. The editor draws these
      // dashed so it is plain which lines are not part of the part.
      if (!ring.closed) {
        dropped.open++
        rings.push({ node: index, pts: ring.pts, state: 'open' })
        continue
      }
      const pts = ring.pts
      // A closed ring's last point is its first; welding leaves it in when a
      // path spells it out with an explicit L back to the start.
      if (pts.length > 1) {
        const a = pts[0]
        const b = pts[pts.length - 1]
        if (Math.abs(a.x - b.x) < WELD && Math.abs(a.y - b.y) < WELD) pts.pop()
      }
      if (pts.length < 3) {
        dropped.tiny++
        rings.push({ node: index, pts, state: 'tiny' })
        continue
      }
      // Crossing is asked before area, not after. A figure-of-eight encloses
      // as much one way as the other and so measures as nothing at all —
      // reported as "too small" it would send somebody looking for a
      // dimension when what is wrong is the shape.
      if (crosses(pts)) {
        dropped.crossing++
        rings.push({ node: index, pts, state: 'crossing' })
        continue
      }
      if (Math.abs(areaOf(pts)) < TINY_AREA) {
        dropped.tiny++
        rings.push({ node: index, pts, state: 'tiny' })
        continue
      }
      kept.push({ node: index, pts, box: boundsOf(pts), area: Math.abs(areaOf(pts)) })
    }
  }

  /* Nesting decides material from hole, and parity is the rule: depth 0 is
     material, depth 1 is a hole, depth 2 is material again — which is how the
     middle of an O works. */
  depthOf(kept)
  for (const ring of kept) {
    rings.push({ node: ring.node, pts: ring.pts, state: ring.depth % 2 ? 'hole' : 'solid' })
  }

  /* Overlapping outlines are one shape, not two standing in the same place.
     Containment says which ring is a hole and cannot say anything about two
     rings crossing, so that is a boolean, and `./union` does it in 2D before
     anything is extruded. Until Manifold is up it answers null and this falls
     back to plain nesting — which is right for every drawing whose outlines
     do not overlap, and is what this did before. */
  const merged = unionIslands(kept)
  if (!merged) return { islands: islandsFrom(kept), dropped, rings }

  const clean = merged.map((pts) => ({ pts, box: boundsOf(pts), area: Math.abs(areaOf(pts)) }))
  depthOf(clean)
  return { islands: islandsFrom(clean), dropped, rings }
}

/**
 * How deep each ring sits inside the others, and which ring is immediately
 * around it.
 *
 * A ring's container is the innermost ring that holds it, found by area,
 * which is sound because rings that reach this have already been checked for
 * crossing themselves and — once the union has run — do not cross each other
 * either.
 */
function depthOf(rings) {
  for (const ring of rings) {
    ring.depth = 0
    ring.parent = null
    for (const other of rings) {
      if (other === ring) continue
      if (
        other.box.minX > ring.box.minX ||
        other.box.maxX < ring.box.maxX ||
        other.box.minY > ring.box.minY ||
        other.box.maxY < ring.box.maxY
      ) {
        continue
      }
      if (!inside(ring.pts[0], other.pts)) continue
      ring.depth++
      if (!ring.parent || other.area < ring.parent.area) ring.parent = other
    }
  }
}

/** Every even-depth ring, with the odd-depth rings sitting directly in it. */
function islandsFrom(rings) {
  const islands = []
  for (const ring of rings) {
    if (ring.depth % 2 !== 0) continue
    const holes = rings.filter((h) => h.depth % 2 === 1 && h.parent === ring)
    const [contour, wound] = windContours(
      ring.pts,
      holes.map((h) => h.pts)
    )
    islands.push({ contour, holes: wound })
  }
  return islands
}



/**
 * The drawing's own extent, in millimetres, for the properties rail. Measured
 * in the drawing's plane rather than the extruder's, because it is about to be
 * read out beside the words "wide" and "deep".
 */
export function sketchBounds(doc, sides = 32) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const node of doc?.nodes ?? []) {
    for (const ring of ringsOfNode(node, sides)) {
      for (const p of ring.pts) {
        if (p.x < minX) minX = p.x
        if (p.x > maxX) maxX = p.x
        if (-p.y < minY) minY = -p.y
        if (-p.y > maxY) maxY = -p.y
      }
    }
  }
  if (minX > maxX) return null
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY }
}

/** The islands as `THREE.Shape`s, for the one build path that needs them. */
export function shapesFrom(islands) {
  return islands.map(({ contour, holes }) => {
    const shape = new THREE.Shape(contour.map((p) => new THREE.Vector2(p.x, p.y)))
    for (const hole of holes) {
      shape.holes.push(new THREE.Path(hole.map((p) => new THREE.Vector2(p.x, p.y))))
    }
    return shape
  })
}
