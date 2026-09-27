/**
 * The sketch document: a 2D drawing, in millimetres.
 *
 * One of these is what an imported SVG becomes and what the drawing editor
 * writes, and `builders/sketch` is what lifts it into a solid. See
 * `docs/sketches.md` for why it lives in an object's `params` where an
 * imported model's triangles do not: kept as primitives and curves rather
 * than as points it is kilobytes, which is small enough to travel in the
 * session cache, on the clipboard and in a `.babycad` — and it keeps
 * `Smoothness` a live parameter, since nothing is flattened until build time.
 *
 * Four node kinds and no more:
 *
 *   { kind: 'rect',   x, y, w, h, r }            r is the corner radius
 *   { kind: 'circle', cx, cy, r }
 *   { kind: 'poly',   pts: [[x, y], …], closed }
 *   { kind: 'path',   segs: [['M', x, y], …] }
 *
 * `rect` and `circle` are here because they are what somebody draws and
 * because they carry *named* dimensions — a width, a radius — which is what
 * the measurements on screen and the variables hang off. `path` is the
 * general case and is what an import lands as.
 *
 * Millimetres are the document's own. There is no size parameter on the block
 * scaling it: what is drawn is how big it is, which is why importing guesses
 * once, on the way in, and bakes the answer in here.
 *
 * The plane is the plate seen from above — +x is the plate's X and +y is its
 * Y, under the names `scene/axes` gives them. `flatten` is the one place that
 * knows how that lands in the scene's own coordinates.
 */

/**
 * Rounding, and why there is any.
 *
 * Three decimals is a thousandth of a millimetre, which is past what any
 * printer can hold and well past what anybody means. It is not about accuracy:
 * this document is JSON in `params`, so every digit costs bytes in the
 * localStorage session cache — and the digest below keys the geometry cache,
 * so float noise arriving from two directions on what is really one number
 * would mint a second geometry for a drawing that had not changed.
 */
const PRECISION = 1000
const round = (v) => {
  const r = Math.round(v * PRECISION) / PRECISION
  return Object.is(r, -0) ? 0 : r
}

/** A finite number or a fallback. Junk in a hand-edited file lands here. */
const num = (value, fallback = 0) => {
  const n = Number(value)
  return Number.isFinite(n) ? round(n) : fallback
}

/**
 * A dimension: a number, or a number that follows a variable.
 *
 * `v` is the resolved value and nothing below this file reads anything else —
 * the same deal `params` keeps with the rest of the app, one level further in.
 * Nothing writes the bound form yet; `scene/variables` will, and the shape is
 * settled now so that arriving does not need a migration.
 */
const dim = (value, fallback = 0) => {
  if (value && typeof value === 'object' && typeof value.var === 'string') {
    return { var: value.var, v: num(value.v, fallback) }
  }
  return num(value, fallback)
}

/** The number behind a dimension, whether or not it follows a variable. */
export const valueOf = (d) => (d !== null && typeof d === 'object' ? d.v : d)

/** The variable a dimension follows, or null. */
export const varOf = (d) => (d !== null && typeof d === 'object' ? d.var : null)

/**
 * How much drawing may travel in a parameter.
 *
 * A traced photograph is tens of thousands of curves, and this document goes
 * in `params`, therefore in the session cache, therefore against a quota
 * shared with the whole build. The importer refuses past these and says the
 * count, rather than accepting a drawing it cannot save.
 */
export const MAX_NODES = 1000
export const MAX_SEGMENTS = 4000

export const emptySketch = () => ({ nodes: [] })

/** How many drawn segments a document holds, for the budget and the panel. */
export function countSegments(doc) {
  let n = 0
  for (const node of doc?.nodes ?? []) {
    if (node.kind === 'poly') n += Math.max(0, node.pts.length - (node.closed ? 0 : 1))
    else if (node.kind === 'path') n += node.segs.filter((s) => s[0] !== 'M' && s[0] !== 'Z').length
    else n += 4
  }
  return n
}

export const isEmptySketch = (doc) => !(doc?.nodes?.length > 0)

/* ---------------------------------------------------------- normalize -- */

/**
 * Path segments, in the same alphabet SVG uses, plus one.
 *
 * `E` is an elliptical arc given the way `THREE.EllipseCurve` gives it —
 * centre, two radii, two angles, a direction and a rotation — rather than the
 * way an SVG `A` command does, with an end point and three flags. Both the
 * importer and the editor have the centre form to hand and the flattener
 * wants it; converting to SVG's endpoint form and back is arithmetic with
 * nothing asking for it.
 */
const SEG_LENGTH = { M: 2, L: 2, Q: 4, C: 6, E: 8, Z: 0 }

function normalizeSegs(raw) {
  const out = []
  let open = false
  for (const seg of Array.isArray(raw) ? raw : []) {
    if (!Array.isArray(seg)) continue
    const op = String(seg[0] ?? '').toUpperCase()
    const want = SEG_LENGTH[op]
    if (want === undefined || seg.length < want + 1) continue
    // A run has to start somewhere: anything before the first M is dropped
    // rather than left to be drawn from an unstated point.
    if (op === 'M') open = true
    else if (!open) continue
    if (op === 'Z') open = false
    out.push([op, ...seg.slice(1, want + 1).map((v) => num(v))])
  }
  return out
}

function normalizeNode(raw) {
  if (!raw || typeof raw !== 'object') return null
  const id = typeof raw.id === 'string' ? raw.id : undefined
  const keep = (node) => (id ? { id, ...node } : node)

  switch (raw.kind) {
    case 'rect': {
      const w = dim(raw.w)
      const h = dim(raw.h)
      if (valueOf(w) <= 0 || valueOf(h) <= 0) return null
      return keep({ kind: 'rect', x: dim(raw.x), y: dim(raw.y), w, h, r: dim(raw.r) })
    }
    case 'circle': {
      const r = dim(raw.r)
      if (valueOf(r) <= 0) return null
      return keep({ kind: 'circle', cx: dim(raw.cx), cy: dim(raw.cy), r })
    }
    case 'poly': {
      const pts = (Array.isArray(raw.pts) ? raw.pts : [])
        .filter((p) => Array.isArray(p) && p.length >= 2)
        .map((p) => [num(p[0]), num(p[1])])
      if (pts.length < 2) return null
      return keep({ kind: 'poly', pts, closed: raw.closed !== false })
    }
    case 'path': {
      const segs = normalizeSegs(raw.segs)
      if (segs.length < 2) return null
      return keep({ kind: 'path', segs })
    }
    default:
      return null
  }
}

/**
 * Validate a document from anywhere — a file, the clipboard, an import.
 *
 * Always returns a fresh object, never the one it was handed: `coerce` runs on
 * every write and a document shared by reference between two blocks would let
 * an edit to one show up in the other.
 */
export function normalizeSketch(raw) {
  const nodes = []
  for (const node of Array.isArray(raw?.nodes) ? raw.nodes : []) {
    const clean = normalizeNode(node)
    if (clean) nodes.push(clean)
    if (nodes.length >= MAX_NODES) break
  }
  return { nodes }
}

/* ------------------------------------------------------------- digest -- */

/**
 * A short, stable key for the geometry cache.
 *
 * `paramsKey` builds its key by string concatenation, and an object
 * stringifies to `[object Object]` — so without this every sketch in a build
 * would share one cache entry and they would all show the same solid. FNV-1a
 * over the JSON, which is the trick `meshStore` already uses to
 * content-address a model, and it keeps the key short as well as right.
 *
 * Stable because `normalizeSketch` builds every node's keys in a fixed order,
 * so two documents that are the same shape serialize the same way.
 */
export function digestSketch(doc) {
  const text = JSON.stringify(doc?.nodes ?? [])
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36) + text.length.toString(36)
}

/* -------------------------------------------------------- moving it -- */

/**
 * Scale and shift a whole document, in millimetres.
 *
 * Only the importer uses these, which is why they walk straight over a bound
 * dimension's resolved value: nothing that has been through the editor can be
 * rescaled this way without fighting the variable behind it, and nothing the
 * importer makes is bound to anything.
 */
const mapDim = (d, f) => (d !== null && typeof d === 'object' ? { ...d, v: round(f(d.v)) } : round(f(d)))

export function transformSketch(doc, at) {
  return { nodes: doc.nodes.map((node) => transformNode(node, at)) }
}

/** One node through the same map — what resizing a single outline uses. */
export function transformNode(node, { scale = 1, dx = 0, dy = 0 } = {}) {
  const X = (v) => v * scale + dx
  const Y = (v) => v * scale + dy
  const S = (v) => v * scale

  switch (node.kind) {
    case 'rect':
      return {
        ...node,
        x: mapDim(node.x, X),
        y: mapDim(node.y, Y),
        w: mapDim(node.w, S),
        h: mapDim(node.h, S),
        r: mapDim(node.r, S),
      }
    case 'circle':
      return { ...node, cx: mapDim(node.cx, X), cy: mapDim(node.cy, Y), r: mapDim(node.r, S) }
    case 'poly':
      return { ...node, pts: node.pts.map(([x, y]) => [round(X(x)), round(Y(y))]) }
    case 'path':
      return { ...node, segs: node.segs.map((seg) => transformSeg(seg, X, Y, S)) }
    default:
      return node
  }
}

/**
 * One segment through the same map. Every command is a run of (x, y) pairs
 * except the arc, whose eight numbers are a point, two radii, two angles and
 * two flags — so it is the one that cannot be walked two at a time.
 */
function transformSeg(seg, X, Y, S) {
  const [op] = seg
  if (op === 'Z') return seg
  if (op === 'E') {
    const [, cx, cy, rx, ry, a0, a1, cw, rot] = seg
    return ['E', round(X(cx)), round(Y(cy)), round(S(rx)), round(S(ry)), a0, a1, cw, rot]
  }
  const out = [op]
  for (let i = 1; i < seg.length; i += 2) {
    out.push(round(X(seg[i])), round(Y(seg[i + 1])))
  }
  return out
}
