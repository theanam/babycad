/**
 * Bringing a drawing in from an SVG.
 *
 * The sibling of `io/importModel`: that one reads triangles, this one reads
 * outlines, and they share a file picker and nothing else. What comes out is
 * a sketch document — see `shapes/sketch/doc` — which is the same thing the
 * drawing editor writes, so an imported logo can be opened and measured
 * afterwards rather than being the black box an imported STL is.
 *
 * Three's `SVGLoader` does the reading, which is the right call and not a
 * close one: transforms, groups, `<rect>`, `<circle>`, `<polygon>`, the whole
 * path grammar and the two fill rules are a thousand lines of somebody else's
 * carefully debugged work. What is left is four decisions.
 *
 * **Filled paths only.** A stroke has no area to extrude. A file with nothing
 * but strokes in it is reported as such rather than arriving empty. (Widening
 * a stroke into an outline is `pointsToStroke`'s job and a later question.)
 *
 * **Curves are kept, not flattened.** `subPaths` hands back the beziers and
 * arcs as they were written and they go into the document that way, which is
 * what keeps a logo kilobytes instead of megabytes and what keeps Smoothness
 * a live parameter after the import rather than a choice spent during it.
 *
 * **SVG's Y grows downward and a drawing's does not**, so everything is
 * flipped on the way through. Miss it and every import arrives mirrored,
 * which looks fine until the first letterform.
 *
 * **Millimetres are settled once, here.** See `millimetresPerUnit`.
 */
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js'
import {
  countSegments,
  MAX_NODES,
  MAX_SEGMENTS,
  normalizeSketch,
  transformSketch,
} from '../shapes/sketch/doc'
import { sketchBounds } from '../shapes/sketch/flatten'

export const SVG_EXTENSIONS = ['.svg']

/** How big a drawing is made when the file says nothing about its size. */
const TARGET_MM = 40

/** A CSS pixel, in millimetres. 96 of them to the inch, by definition. */
const PX_MM = 25.4 / 96

const UNIT_MM = { mm: 1, cm: 10, in: 25.4, pt: 25.4 / 72, pc: 25.4 / 6, q: 0.25 }

const extensionOf = (name) => {
  const at = String(name ?? '').lastIndexOf('.')
  return at < 0 ? '' : String(name).slice(at).toLowerCase()
}

/* ----------------------------------------------------------- the size -- */

/** A length attribute off the root element, in millimetres, or null. */
function lengthMm(value) {
  const match = /^\s*([+-]?[\d.]+(?:e[+-]?\d+)?)\s*([a-z%]*)\s*$/i.exec(String(value ?? ''))
  if (!match) return null
  const n = Number(match[1])
  if (!Number.isFinite(n) || n <= 0) return null
  const unit = match[2].toLowerCase()
  if (!unit || unit === 'px') return n * PX_MM
  return UNIT_MM[unit] ? n * UNIT_MM[unit] : null
}

const physical = (value) => /[a-z]/i.test(String(value ?? '')) && !/px$/i.test(String(value))

/**
 * How many millimetres one of the file's own units is worth.
 *
 * There is no answer that is right for every file, so there are three rules
 * and the third one admits it is guessing:
 *
 *  1. **A real unit and a viewBox.** `width="40mm" viewBox="0 0 1024 640"`
 *     says a thousand and twenty-four of its units span forty millimetres.
 *     Exact, and the common case for anything drawn in a real editor.
 *  2. **A real unit and no viewBox.** Then the coordinates are CSS pixels and
 *     a pixel is a ninety-sixth of an inch. Also exact, if less useful.
 *  3. **Nothing physical at all** — `width="1024"`, or no width — and the
 *     file simply does not say how big it is. The longest side is made 40 mm,
 *     two of the plate's grid squares, and the caller says it guessed.
 *
 * Whichever it is, it is baked into the document here and the document is in
 * millimetres from then on, like every other document in the app. Fixing a
 * guess is what the drawing editor is for.
 */
function millimetresPerUnit(xml, extent) {
  const width = xml?.getAttribute?.('width')
  const height = xml?.getAttribute?.('height')
  const box = String(xml?.getAttribute?.('viewBox') ?? '')
    .split(/[\s,]+/)
    .map(Number)

  if (physical(width) || physical(height)) {
    const mm = lengthMm(physical(width) ? width : height)
    const span = physical(width) ? box[2] : box[3]
    if (mm && box.length === 4 && Number.isFinite(span) && span > 0) {
      return { scale: mm / span, guessed: false }
    }
    if (mm) return { scale: PX_MM, guessed: false }
  }

  const longest = Math.max(extent?.width ?? 0, extent?.height ?? 0)
  if (!longest) return { scale: 1, guessed: false }
  return { scale: TARGET_MM / longest, guessed: true }
}

/* -------------------------------------------------------- the outlines -- */

/** Is anything painted here? A stroke has no area to lift into a solid. */
function filled(shapePath) {
  const style = shapePath?.userData?.style
  if (!style) return true
  if (style.fill === 'none' || style.fill === 'transparent') return false
  return !(Number(style.fillOpacity) === 0)
}

/**
 * One subpath's curves as a run of segments, flipped out of SVG's downward Y.
 *
 * The arc is the one that takes more than a sign change. Negating y reflects
 * the plane, and a reflected ellipse is the same ellipse with its rotation
 * and both its angles negated and its direction reversed — which is exact,
 * and cheaper than the alternative of sampling arcs into lines at a
 * resolution nobody would be able to change afterwards.
 */
function segsOf(curves) {
  const segs = []
  const push = (op, ...n) => segs.push([op, ...n])
  let first = true

  for (const curve of curves) {
    if (first) {
      const start = curve.getPoint(0)
      push('M', start.x, -start.y)
      first = false
    }
    if (curve.isLineCurve) {
      push('L', curve.v2.x, -curve.v2.y)
    } else if (curve.isCubicBezierCurve) {
      push('C', curve.v1.x, -curve.v1.y, curve.v2.x, -curve.v2.y, curve.v3.x, -curve.v3.y)
    } else if (curve.isQuadraticBezierCurve) {
      push('Q', curve.v1.x, -curve.v1.y, curve.v2.x, -curve.v2.y)
    } else if (curve.isEllipseCurve) {
      push(
        'E',
        curve.aX,
        -curve.aY,
        curve.xRadius,
        curve.yRadius,
        -curve.aStartAngle,
        -curve.aEndAngle,
        curve.aClockwise ? 0 : 1,
        -curve.aRotation
      )
    } else {
      // A spline, or anything a future three grows: sampled, because a run of
      // straight lines is always a truthful answer and an unknown curve is not.
      for (const p of curve.getPoints(16).slice(1)) push('L', p.x, -p.y)
    }
  }
  return segs
}

const closed = (sub) => {
  if (sub.autoClose) return true
  const pts = sub.getPoints(2)
  const a = pts[0]
  const b = pts[pts.length - 1]
  return Boolean(a && b && Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6)
}

/* ------------------------------------------------------------- reading -- */

/**
 * Read one SVG into a sketch document.
 *
 * Returns `{ doc, name, outlines, size, guessed }`, or throws with a message
 * worth showing somebody.
 */
export function readSvgText(text, name = 'drawing.svg') {
  let parsed
  try {
    parsed = new SVGLoader().parse(text)
  } catch (error) {
    throw new Error(`${name} could not be read — ${error.message ?? 'it may be damaged'}`)
  }

  const nodes = []
  let strokeOnly = 0
  for (const shapePath of parsed.paths ?? []) {
    if (!filled(shapePath)) {
      strokeOnly++
      continue
    }
    for (const sub of shapePath.subPaths ?? []) {
      if (!sub.curves?.length) continue
      const segs = segsOf(sub.curves)
      if (closed(sub)) segs.push(['Z'])
      if (segs.length > 1) nodes.push({ kind: 'path', segs })
    }
  }

  if (!nodes.length) {
    throw new Error(
      strokeOnly
        ? `${name} is drawn in lines rather than filled shapes — there is no area to make solid`
        : `${name} has no outlines in it`
    )
  }

  let doc = normalizeSketch({ nodes })
  if (doc.nodes.length < nodes.length) {
    throw new Error(`${name} has more than ${MAX_NODES} outlines in it`)
  }
  const segments = countSegments(doc)
  if (segments > MAX_SEGMENTS) {
    throw new Error(
      `${name} is ${segments.toLocaleString()} curves — more than ${MAX_SEGMENTS.toLocaleString()}, which is more drawing than a build can carry`
    )
  }

  // Measured before the scale is chosen, because rule three is chosen *from*
  // the measurement, and again after, because the answer is what gets shown.
  const raw = sketchBounds(doc, 64)
  if (!raw) throw new Error(`${name} has no outlines with any size to them`)
  const { scale, guessed } = millimetresPerUnit(parsed.xml, raw)

  doc = transformSketch(doc, {
    scale,
    // Centred on its own middle, so the drawing opens around the origin
    // rather than wherever the file's author happened to put it.
    dx: -((raw.minX + raw.maxX) / 2) * scale,
    dy: -((raw.minY + raw.maxY) / 2) * scale,
  })

  const size = sketchBounds(doc, 64) ?? { width: 0, height: 0 }
  return { doc, name, outlines: doc.nodes.length, size, guessed, strokeOnly }
}

/** Read one picked file. */
export async function readSvgFile(file) {
  return readSvgText(await file.text(), file.name)
}

/** Kept beside the reader so the two cannot drift apart. */
export const isSvg = (name) => SVG_EXTENSIONS.includes(extensionOf(name))
