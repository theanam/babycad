/**
 * One outline at a time: what it looks like, what you can grab on it, what
 * numbers it carries, and what typing a new one does.
 *
 * All of it pure, and none of it React — the editor is the thing with the
 * pointer events in it, and this is the thing `check:sketch` can ask
 * questions of. See `docs/sketches.md`.
 *
 * **Nothing here draws.** Every outline on screen comes from
 * `ringsOfNode`, the same function the builder flattens with, so the picture
 * and the solid cannot disagree about where a curve goes or how many facets
 * it has. That is also why bounds are measured off the rings rather than
 * worked out per kind: one answer, one place.
 */
import { ringsOfNode } from '../../shapes/sketch/flatten'
import { transformNode, valueOf } from '../../shapes/sketch/doc'

/** How near a click has to be to a line to count as on it, in millimetres. */
export const TOUCH_MM = 1.2

const v = valueOf
const round = (n) => Math.round(n * 1000) / 1000

/* -------------------------------------------------------- making them -- */

/** A rectangle from two opposite corners, whichever way they were dragged. */
export const rectFrom = (a, b) => ({
  kind: 'rect',
  x: round(Math.min(a.x, b.x)),
  y: round(Math.min(a.y, b.y)),
  w: round(Math.abs(b.x - a.x)),
  h: round(Math.abs(b.y - a.y)),
  r: 0,
})

/** A circle from its middle out, which is how a hole gets drawn. */
export const circleFrom = (centre, edge) => ({
  kind: 'circle',
  cx: round(centre.x),
  cy: round(centre.y),
  r: round(Math.hypot(edge.x - centre.x, edge.y - centre.y)),
})

/**
 * A run of straight lines.
 *
 * Closed once there are three points, because a closed ring is the only kind
 * of thing that extrudes and nobody draws three corners meaning to stop. Two
 * points cannot enclose anything, so that one stays open — and is drawn
 * dashed, and says so, rather than being quietly turned into a sliver.
 */
export const polyFrom = (pts) => ({
  kind: 'poly',
  pts: pts.map(({ x, y }) => [round(x), round(y)]),
  closed: pts.length > 2,
})

/**
 * A run of curves, from the anchors the pen laid down.
 *
 * An anchor is `{ x, y, hx, hy }`, where the handle is an offset from the
 * anchor and stands for *both* sides of it: the curve leaves along `+h` and
 * arrives along `−h`. That is a smooth node, and it is what dragging as you
 * click gives you. A corner is an anchor with no handle, and the segment
 * between two of those is a straight line rather than a curve with its
 * controls sitting on top of its ends — a real `L`, so it measures and
 * flattens as one.
 *
 * Handles that pull independently are the other half of a proper pen and are
 * not here. They want a modifier to grab one on its own, and a smooth node is
 * what almost every curve anybody draws is made of.
 */
export function pathFrom(anchors, closed) {
  if (!anchors?.length) return null
  const segs = [['M', round(anchors[0].x), round(anchors[0].y)]]
  const link = (p, q) => {
    if (flat(p) && flat(q)) return ['L', round(q.x), round(q.y)]
    return [
      'C',
      round(p.x + p.hx), round(p.y + p.hy),
      round(q.x - q.hx), round(q.y - q.hy),
      round(q.x), round(q.y),
    ]
  }
  for (let i = 1; i < anchors.length; i++) segs.push(link(anchors[i - 1], anchors[i]))
  if (closed && canClose(anchors)) {
    segs.push(link(anchors[anchors.length - 1], anchors[0]))
    segs.push(['Z'])
  }
  return segs.length > 1 ? { kind: 'path', segs } : null
}

const flat = (a) => Math.hypot(a.hx ?? 0, a.hy ?? 0) < 1e-6

/**
 * Is there a shape here to close?
 *
 * Three corners, as with a run of straight lines — or **two anchors, if
 * either of them is curved**, which is a leaf: out along one curve and back
 * along the other. Straight lines need three points to enclose anything and
 * curves do not, and taking the polyline's rule for the pen was what stopped
 * the simplest curved shape anybody would draw from closing at all.
 */
export const canClose = (anchors) =>
  anchors?.length > 2 || (anchors?.length === 2 && anchors.some((a) => !flat(a)))

/* ------------------------------------------------------------- reading -- */

export function boundsOf(node, sides = 32) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const ring of ringsOfNode(node, sides)) {
    for (const p of ring.pts) {
      // Rings come back in the extruder's plane, where y is the other way up.
      const y = -p.y
      if (p.x < minX) minX = p.x
      if (p.x > maxX) maxX = p.x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  if (minX > maxX) return null
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY }
}

/** The outlines, in the drawing's own plane, ready to be drawn. */
export const outlinesOf = (node, sides = 32) =>
  ringsOfNode(node, sides).map((ring) => ({
    closed: ring.closed,
    pts: ring.pts.map((p) => ({ x: p.x, y: -p.y })),
  }))

/**
 * Is this point on or in this outline?
 *
 * Inside counts, because clicking the middle of a shape to pick it up is what
 * anybody expects — including the middle of a ring that happens to be a hole,
 * since a hole is still an outline you drew and still has to be selectable.
 * Near the line counts too, at `near` millimetres, so a thin shape is not a
 * target you have to be precise about.
 */
export function hitTest(node, point, near, sides = 32) {
  for (const { pts, closed } of outlinesOf(node, sides)) {
    if (closed && inside(point, pts)) return true
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]
      const b = pts[(i + 1) % pts.length]
      if (!closed && i === pts.length - 1) break
      if (distanceToSegment(point, a, b) <= near) return true
    }
  }
  return false
}

function inside(p, ring) {
  let hit = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]
    const b = ring[j]
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) hit = !hit
  }
  return hit
}

export function distanceToSegment(p, a, b) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = dx * dx + dy * dy
  const t = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/* ------------------------------------------------------------- handles -- */

/**
 * Where each segment of a path ends — its anchors, in order.
 *
 * `null` for anything this cannot take apart safely: a path holding arcs,
 * which an import is full of and whose endpoints are not written down in the
 * segment, and a path long enough that grips would be a swarm rather than a
 * set of handles.
 */
const MAX_GRIPS = 24
const END_OF = { M: [1, 2], L: [1, 2], Q: [3, 4], C: [5, 6] }

export function anchorsOf(node) {
  if (node.kind !== 'path') return null
  const out = []
  for (const seg of node.segs) {
    if (seg[0] === 'Z') continue
    const end = END_OF[seg[0]]
    if (!end) return null // an arc: not ours to pull apart
    out.push({ x: seg[end[0]], y: seg[end[1]] })
  }
  // A closed run comes back round to where it started; that is one anchor,
  // written twice.
  if (out.length > 1) {
    const a = out[0]
    const b = out[out.length - 1]
    if (Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6) out.pop()
  }
  return out.length && out.length <= MAX_GRIPS ? out : null
}

/**
 * The dots you can grab, in the drawing's own plane.
 *
 * A path offers its anchors, so a curve drawn with the pen can be pushed
 * about afterwards — but only while there are few enough of them to be
 * handles rather than a swarm. A logo's hundreds of control points are
 * somebody else's bezier net, and dragging one of those is not editing a
 * drawing, it is vandalising a curve; those move and resize as a whole,
 * which is what anybody wants from an import.
 *
 * What is not here is a grip on the *curvature* — the handle that says how
 * far a curve bulges. Moving an anchor takes its handles with it, so the
 * shape follows; changing them is the next piece of work.
 */
export function handlesOf(node) {
  switch (node.kind) {
    case 'rect': {
      const x = v(node.x)
      const y = v(node.y)
      const w = v(node.w)
      const h = v(node.h)
      return [
        { id: 'c0', x, y },
        { id: 'c1', x: x + w, y },
        { id: 'c2', x: x + w, y: y + h },
        { id: 'c3', x, y: y + h },
      ]
    }
    case 'circle':
      return [{ id: 'r', x: v(node.cx) + v(node.r), y: v(node.cy) }]
    case 'poly':
      return node.pts.map(([x, y], i) => ({ id: `p${i}`, x, y }))
    case 'path': {
      const anchors = anchorsOf(node)
      return anchors ? anchors.map((a, i) => ({ id: `a${i}`, x: a.x, y: a.y })) : []
    }
    default:
      return []
  }
}

/** Drag one of those to a point. Returns the node it becomes. */
export function moveHandle(node, id, to) {
  switch (node.kind) {
    case 'rect': {
      // The corner opposite the one being dragged stays where it is, which is
      // the same bargain the 3D gizmo strikes with its bottom corners.
      const corners = handlesOf(node)
      const at = corners.findIndex((c) => c.id === id)
      if (at < 0) return node
      const anchor = corners[(at + 2) % 4]
      return { ...node, ...rectFrom(anchor, to), r: node.r }
    }
    case 'circle':
      return { ...node, r: round(Math.max(0.01, Math.hypot(to.x - v(node.cx), to.y - v(node.cy)))) }
    case 'poly': {
      const at = Number(id.slice(1))
      if (!Number.isInteger(at) || !node.pts[at]) return node
      const pts = node.pts.map((p, i) => (i === at ? [round(to.x), round(to.y)] : p))
      return { ...node, pts }
    }
    case 'path':
      return moveAnchor(node, Number(id.slice(1)), to)
    default:
      return node
  }
}

/**
 * Drag one anchor of a path, and bring its curve with it.
 *
 * Three things move together, or the curve tears away from the point it is
 * supposed to be arriving at: the anchor, the control point the curve comes
 * *in* on (which lives in the same segment), and the one it goes *out* on
 * (which lives in the next). Both controls shift by the same amount as the
 * anchor, so the curve is carried along with its shape intact rather than
 * being stretched.
 *
 * A closed run writes its first anchor twice — once as the `M` and again as
 * the end of the segment that comes back round — so the move is applied to
 * every segment that ends where this one does rather than to one index.
 */
function moveAnchor(node, at, to) {
  const anchors = anchorsOf(node)
  const anchor = anchors?.[at]
  if (!anchor) return node
  const dx = to.x - anchor.x
  const dy = to.y - anchor.y
  if (!dx && !dy) return node

  const here = (x, y) => Math.abs(x - anchor.x) < 1e-6 && Math.abs(y - anchor.y) < 1e-6
  const segs = node.segs.map((seg) => [...seg])
  const live = segs.filter((seg) => seg[0] !== 'Z')

  for (let i = 0; i < live.length; i++) {
    const seg = live[i]
    const end = END_OF[seg[0]]
    if (!end || !here(seg[end[0]], seg[end[1]])) continue
    seg[end[0]] = round(seg[end[0]] + dx)
    seg[end[1]] = round(seg[end[1]] + dy)
    // The handle the curve arrives on.
    if (seg[0] === 'C') {
      seg[3] = round(seg[3] + dx)
      seg[4] = round(seg[4] + dy)
    }
    // And the one it leaves on, which belongs to whatever comes next — round
    // the end of the list for a closed run.
    const next = live[(i + 1) % live.length]
    if (next && next !== seg && next[0] === 'C') {
      next[1] = round(next[1] + dx)
      next[2] = round(next[2] + dy)
    }
  }
  return { ...node, segs }
}

export const translateNode = (node, dx, dy) => transformNode(node, { dx, dy })

/* ---------------------------------------------------------- dimensions -- */

/**
 * The numbers on screen, and where to put them.
 *
 * `x, y` is the anchor in the drawing's own millimetres; `ox, oy` nudge the
 * label off it in *screen* units, because a label wants to sit a fixed few
 * pixels clear of its line however far the view is zoomed in.
 *
 * What typing one does is decided per kind and is deliberately simple —
 * `applyDimension` below is the whole of it. There is no constraint solver
 * here and pretending with half of one would be worse than being plain that
 * these are numbers you type.
 */
export function dimensionsOf(node, sides = 32, picked = false) {
  switch (node.kind) {
    case 'rect': {
      const x = v(node.x)
      const y = v(node.y)
      const w = v(node.w)
      const h = v(node.h)
      const out = [
        { key: 'w', label: 'Width', value: w, x: x + w / 2, y, ox: 0, oy: 1 },
        { key: 'h', label: 'Height', value: h, x: x + w, y: y + h / 2, ox: 1, oy: 0 },
      ]
      // The corner radius shows once it is something, and on the box being
      // worked on whatever it is — otherwise there is no way to round a
      // corner in the first place, since a zero you cannot see is a zero you
      // cannot type over. Every other box on the board stays quiet about it.
      if (picked || v(node.r) > 0) {
        out.push({ key: 'r', label: 'Corner', value: v(node.r), x, y: y + h, ox: -1, oy: -1 })
      }
      return out
    }
    case 'circle':
      return [
        {
          key: 'd',
          label: 'Across',
          value: v(node.r) * 2,
          x: v(node.cx),
          y: v(node.cy),
          ox: 0,
          oy: 0,
        },
      ]
    case 'poly': {
      const out = []
      const n = node.pts.length
      const last = node.closed ? n : n - 1
      const box = boundsOf(node, sides)
      const mid = { x: box ? (box.minX + box.maxX) / 2 : 0, y: box ? (box.minY + box.maxY) / 2 : 0 }
      for (let i = 0; i < last; i++) {
        const [ax, ay] = node.pts[i]
        const [bx, by] = node.pts[(i + 1) % n]
        const len = Math.hypot(bx - ax, by - ay)
        if (len < 0.01) continue
        const at = { x: (ax + bx) / 2, y: (ay + by) / 2 }
        // Clear of the line, on whichever side is away from the middle of the
        // shape — so the labels ring the outside of it rather than piling up
        // in the hole in the middle. Which way round a ring was drawn is not
        // something to rely on here; the shape's own middle is.
        let nx = -(by - ay) / len
        let ny = (bx - ax) / len
        if ((at.x - mid.x) * nx + (at.y - mid.y) * ny < 0) {
          nx = -nx
          ny = -ny
        }
        // Screen y runs the other way, which is the only reason this flips.
        out.push({ key: `s${i}`, label: 'Length', value: len, x: at.x, y: at.y, ox: nx, oy: -ny })
      }
      return out
    }
    default: {
      // An import has no dimensions of its own — it is somebody else's
      // curves — but it does have a size, and it is the one thing worth being
      // able to type: an SVG that never said how big it was came in at a
      // guess, and this is where that gets fixed.
      const box = boundsOf(node, sides)
      if (!box) return []
      return [
        {
          key: 'size',
          label: 'Across',
          value: box.width,
          x: (box.minX + box.maxX) / 2,
          y: box.minY,
          ox: 0,
          oy: 1,
        },
      ]
    }
  }
}

/**
 * Type a number at one of those.
 *
 *  - A **rectangle's** width moves its right-hand edge and its height moves
 *    its top one; the corner it was drawn from stays put.
 *  - A **circle** grows about its middle, because a circle has no corner to
 *    have been drawn from.
 *  - A **polyline segment** moves its far end along its own direction. Only
 *    that end: the design said to drag everything after it along too, which
 *    reads well until the ring is closed, and then "after" comes back round
 *    to the start and the shape is torn open. Moving the one point changes
 *    the next segment's length as well, which is exactly what an editor with
 *    no constraints in it should be expected to do.
 *  - An **import** scales about its own middle, keeping its proportions.
 */
export function applyDimension(node, key, value, sides = 32) {
  const n = Number(value)
  // Zero is a real answer for exactly one of these — a corner put back to
  // square — and nonsense for all the rest, since nothing else here can be
  // nothing and still be a shape.
  if (!Number.isFinite(n) || n < 0 || (n === 0 && key !== 'r')) return node

  if (node.kind === 'rect') {
    if (key === 'w') return { ...node, w: withValue(node.w, n) }
    if (key === 'h') return { ...node, h: withValue(node.h, n) }
    if (key === 'r') {
      return { ...node, r: withValue(node.r, Math.min(n, Math.min(v(node.w), v(node.h)) / 2)) }
    }
  }
  if (node.kind === 'circle' && key === 'd') return { ...node, r: withValue(node.r, n / 2) }

  if (node.kind === 'poly' && key.startsWith('s')) {
    const at = Number(key.slice(1))
    const count = node.pts.length
    const [ax, ay] = node.pts[at] ?? []
    const far = (at + 1) % count
    const [bx, by] = node.pts[far] ?? []
    if (ax === undefined || bx === undefined) return node
    const len = Math.hypot(bx - ax, by - ay)
    if (len < 1e-6) return node
    const pts = node.pts.map((p, i) =>
      i === far ? [round(ax + ((bx - ax) / len) * n), round(ay + ((by - ay) / len) * n)] : p
    )
    return { ...node, pts }
  }

  if (key === 'size') {
    const box = boundsOf(node, sides)
    if (!box || box.width < 1e-6) return node
    const scale = n / box.width
    const mx = (box.minX + box.maxX) / 2
    const my = (box.minY + box.maxY) / 2
    return transformNode(node, { scale, dx: mx - mx * scale, dy: my - my * scale })
  }

  return node
}

/**
 * Write a number into a dimension without losing the variable behind it.
 *
 * Nothing makes a bound dimension yet — that is the third piece of work in
 * `docs/sketches.md` — but every write goes through here so that when one
 * does, a typed number cannot silently drop the binding on the floor.
 */
const withValue = (dimension, n) =>
  dimension !== null && typeof dimension === 'object'
    ? { ...dimension, v: round(n) }
    : round(n)

/**
 * What to say about the line being drawn right now.
 *
 * Two numbers, because two are what you are deciding at that moment: how long
 * this segment is, and what corner it is making with the one before it. They
 * are a readout rather than a field — the shape does not exist yet, so there
 * is nothing to type a number into — and once the run is finished every
 * segment carries an editable length of its own.
 *
 * The corner is the angle *at* the previous point, between the way you came
 * in and the way you are going out, so a right angle reads 90 and a straight
 * line reads 180. That is the number somebody drawing a bracket is looking
 * for. A turn angle would read 90 and 0 for the same two cases, which is the
 * same information said in the way nobody asks the question.
 *
 * @returns `[{ key, label, value, unit, x, y, ox, oy }]`, positioned the same
 *          way a measurement is.
 */
export function drawingLine(pts, to, { angle = true } = {}) {
  if (!to || !pts?.length) return []
  const from = pts[pts.length - 1]
  const dx = to.x - from.x
  const dy = to.y - from.y
  const len = Math.hypot(dx, dy)
  if (len < 1e-6) return []

  const out = [
    {
      key: 'live-length',
      label: 'Length',
      value: len,
      x: (from.x + to.x) / 2,
      y: (from.y + to.y) / 2,
      // Clear of the line, on its left as it is walked; screen y runs the
      // other way, which is the only reason this flips.
      ox: -dy / len,
      oy: -dx / len,
    },
  ]

  const before = angle ? pts[pts.length - 2] : null
  if (!before) return out
  const ax = before.x - from.x
  const ay = before.y - from.y
  const back = Math.hypot(ax, ay)
  if (back < 1e-6) return out

  const cos = clamp((ax * dx + ay * dy) / (back * len), -1, 1)
  // Along the bisector of the corner, pointing out of it, so the number sits
  // in the opening rather than on top of one of the two lines making it.
  let bx = ax / back + dx / len
  let by = ay / back + dy / len
  const bisector = Math.hypot(bx, by)
  if (bisector < 1e-6) {
    // Doubled back on itself: there is no opening to sit in, so take the
    // perpendicular instead.
    bx = -dy / len
    by = dx / len
  } else {
    bx /= bisector
    by /= bisector
  }
  out.push({
    key: 'live-angle',
    label: 'Corner',
    value: (Math.acos(cos) * 180) / Math.PI,
    unit: '°',
    x: from.x,
    y: from.y,
    ox: bx,
    oy: -by,
  })
  return out
}

const clamp = (n, lo, hi) => (n < lo ? lo : n > hi ? hi : n)

/* ------------------------------------------------------- the document -- */

export const addNode = (doc, node) => ({ nodes: [...doc.nodes, node] })
export const replaceNode = (doc, at, node) => ({
  nodes: doc.nodes.map((n, i) => (i === at ? node : n)),
})
export const removeNode = (doc, at) => ({ nodes: doc.nodes.filter((_, i) => i !== at) })

/** Topmost first, so a small shape drawn on top of a big one is pickable. */
export function nodeAt(doc, point, near, sides = 32) {
  for (let i = doc.nodes.length - 1; i >= 0; i--) {
    if (hitTest(doc.nodes[i], point, near, sides)) return i
  }
  return null
}
