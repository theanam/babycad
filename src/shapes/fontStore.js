/**
 * Typefaces, and the glyph outlines a word is extruded from.
 *
 * A builder here is synchronous — `build(params)` has to hand back geometry on
 * the spot — and a typeface fetched over the network is not. So this is the
 * same arrangement `shapes/meshStore` uses for imported models: the slow part
 * happens outside the builder, the result is kept in a map, and the builder
 * only ever does a lookup.
 *
 * Two kinds of face live in the same map behind one interface:
 *
 *  - **Bundled**, in three's own `typeface.json`. Always there, so the app
 *    works with no network at all and a text block always draws *something*.
 *  - **Fetched**, real TTF from the `google/fonts` CDN, parsed with
 *    opentype.js. See `fonts/catalogue` for why the CSS web-font API is no use
 *    for this.
 *
 * Both end up as `THREE.Shape[]` for a run of text, which is what
 * `ExtrudeGeometry` wants, so the builder never learns which kind it got.
 *
 * A face that has not arrived yet falls back to the bundled one and starts
 * loading. When it lands, `generation` goes up; `SceneObject` folds that into
 * its geometry key, so the words rebuild in the right face instead of sitting
 * in the wrong one until something else happens to touch them.
 */
import * as THREE from 'three'
import { create } from 'zustand'
import { Font } from 'three/examples/jsm/loaders/FontLoader.js'
// opentype.js disagrees with itself about how it is exported: the ESM build has
// named exports and no default, the CommonJS one comes through interop as a
// default with no usable names. The bundler takes the first and node's check
// tools take the second, so this takes the namespace and sorts it out here
// rather than picking one and breaking the other.
import * as opentypeModule from 'opentype.js'

const opentype = opentypeModule.default ?? opentypeModule
import regular from './fonts/helvetiker_regular'
import bold from './fonts/helvetiker_bold'
import { BUNDLED, fontEntry } from './fonts/catalogue'

/** family -> { kind: 'typeface'|'opentype', face } */
const faces = new Map([
  ['Helvetiker', { kind: 'typeface', face: new Font(regular) }],
  ['Helvetiker Bold', { kind: 'typeface', face: new Font(bold) }],
])

const pending = new Map() // family -> Promise, so a family is fetched once
const failed = new Set() // families that will not load; stop asking

/**
 * A counter that goes up whenever a face arrives.
 *
 * Small on purpose: it exists to be folded into a geometry cache key, not to
 * carry state. Anything that draws text watches it.
 */
export const useFonts = create(() => ({ generation: 0, loading: 0 }))

/**
 * Told when a face arrives.
 *
 * The geometry caches key on a shape's parameters, and a typeface landing
 * changes none of them — so they have to be told to forget the words they
 * built in the fallback face. They register here rather than fontStore
 * reaching into them, which keeps this module something they can import
 * without the two ending up in a circle.
 */
const listeners = new Set()
export const onFaceLoaded = (fn) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export const isFontReady = (family) => faces.has(family)
export const fontFailed = (family) => failed.has(family)

/**
 * Fetch and parse a family, once. Resolves whether or not it worked — a
 * typeface that will not download is a disappointment, not an error worth
 * stopping anybody's build over.
 */
export function ensureFont(family) {
  if (faces.has(family) || failed.has(family)) return Promise.resolve(faces.has(family))
  if (pending.has(family)) return pending.get(family)

  const entry = fontEntry(family)
  if (!entry?.url) {
    failed.add(family)
    return Promise.resolve(false)
  }

  useFonts.setState((s) => ({ loading: s.loading + 1 }))
  const job = fetch(entry.url)
    .then((res) => {
      if (!res.ok) throw new Error(String(res.status))
      return res.arrayBuffer()
    })
    .then((buffer) => {
      faces.set(family, { kind: 'opentype', face: opentype.parse(buffer) })
      for (const fn of listeners) fn(family)
      useFonts.setState((s) => ({ generation: s.generation + 1, loading: s.loading - 1 }))
      return true
    })
    .catch(() => {
      failed.add(family)
      useFonts.setState((s) => ({ loading: s.loading - 1 }))
      return false
    })
    .finally(() => pending.delete(family))

  pending.set(family, job)
  return job
}

/** Start loading every family a scene mentions, so a reopened build settles. */
export function warmFontsFor(objects) {
  for (const o of objects ?? []) {
    if (o?.type === 'text' && o.params?.font) ensureFont(o.params.font)
  }
}

/* ------------------------------------------------------------ outlines -- */

/**
 * The outline of a run of text, walked a glyph at a time.
 *
 * opentype's own `getPath` would be the obvious thing to call, and it is a
 * trap. On the way to the glyphs it applies the font's OpenType features,
 * which means reading its GSUB table, and it throws outright on lookup kinds
 * it has not implemented — "substitutionType : 62 lookupType: 6 - substFormat:
 * 2 is not yet supported". Three of the fourteen faces offered here trip it,
 * on every string, including plain ABC: picking Nunito, Bangers or Roboto Slab
 * did not fail to render, it threw out of the builder and took the app down.
 *
 * Going through `charToGlyph` asks for each character's glyph directly and
 * never touches that table. What is lost is the typographic niceties those
 * features provide — ligatures, contextual alternates — and for lettering that
 * is about to be extruded into a solid and printed, that is no loss worth
 * having a crash for. Kerning is kept, since it lives in its own table and is
 * what stops AVA coming out gappy; measured against `getPath` on the faces
 * where that works, the result is identical to the hundredth of a millimetre.
 */
function pathOf(face, text, size) {
  const path = new opentype.Path()
  const scale = size / (face.unitsPerEm || 1000)
  let x = 0
  let previous = null
  // By code point, not by char: a surrogate pair is one character, and
  // splitting it makes two glyphs out of nothing.
  for (const character of text) {
    let glyph = null
    try {
      glyph = face.charToGlyph(character)
    } catch {
      glyph = null
    }
    if (!glyph) continue
    if (previous) {
      try {
        x += (face.getKerningValue(previous, glyph) || 0) * scale
      } catch {
        // A face with a kern table this cannot read still sets fine unkerned.
      }
    }
    try {
      path.extend(glyph.getPath(x, 0, size))
    } catch {
      // One glyph that will not draw should cost that glyph, not the word.
    }
    x += (glyph.advanceWidth ?? 0) * scale
    previous = glyph
  }
  return path
}

/**
 * opentype gives a path in its own Y-down space, as move/line/quad/cubic
 * commands. `THREE.Shape` wants Y-up, and wants the holes in a glyph — the
 * middle of an O — declared as holes rather than as more outlines.
 *
 * Which contours are holes is decided by area: a contour wound against the
 * one containing it is a hole. Rather than work out containment, this leans on
 * the fact that TrueType winds outer contours one way and inner ones the
 * other, so the sign of the signed area is the whole answer.
 */
function shapesFromOpentype(face, text, size) {
  const path = pathOf(face, text, size)
  const contours = []
  let current = null
  let last = new THREE.Vector2()

  const start = (x, y) => {
    current = new THREE.Path()
    current.moveTo(x, -y)
    contours.push(current)
    last.set(x, -y)
  }

  for (const cmd of path.commands) {
    if (cmd.type === 'M') start(cmd.x, cmd.y)
    else if (!current) continue
    else if (cmd.type === 'L') { current.lineTo(cmd.x, -cmd.y); last.set(cmd.x, -cmd.y) }
    else if (cmd.type === 'Q') { current.quadraticCurveTo(cmd.x1, -cmd.y1, cmd.x, -cmd.y); last.set(cmd.x, -cmd.y) }
    else if (cmd.type === 'C') { current.bezierCurveTo(cmd.x1, -cmd.y1, cmd.x2, -cmd.y2, cmd.x, -cmd.y); last.set(cmd.x, -cmd.y) }
    else if (cmd.type === 'Z') current.closePath()
  }

  const measured = contours
    .map((c) => ({ path: c, points: c.getPoints(12) }))
    .filter((c) => c.points.length > 2)
    .map((c) => ({ ...c, area: THREE.ShapeUtils.area(c.points) }))
  if (!measured.length) return []

  // The winding the outer contours use is whichever sign covers the most area.
  let positive = 0
  let negative = 0
  for (const c of measured) (c.area > 0 ? (positive += c.area) : (negative -= c.area))
  const outerIsPositive = positive >= negative

  const shapes = []
  const holes = []
  for (const c of measured) {
    const outer = c.area > 0 === outerIsPositive
    if (outer) {
      const shape = new THREE.Shape()
      shape.curves = c.path.curves
      shape.autoClose = true
      shapes.push({ shape, points: c.points })
    } else holes.push(c)
  }

  // Each hole belongs to the smallest outline that contains it.
  for (const hole of holes) {
    const inside = shapes
      .filter((s) => THREE.ShapeUtils.isClockWise(s.points) !== undefined && contains(s.points, hole.points[0]))
      .sort((a, b) => Math.abs(THREE.ShapeUtils.area(a.points)) - Math.abs(THREE.ShapeUtils.area(b.points)))[0]
    const path = new THREE.Path()
    path.curves = hole.path.curves
    path.autoClose = true
    ;(inside ?? shapes[0])?.shape.holes.push(path)
  }
  return shapes.map((s) => s.shape)
}

/** Ray casting, for deciding which outline a counter belongs to. */
function contains(points, p) {
  let inside = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i]
    const b = points[j]
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside
    }
  }
  return inside
}

/**
 * The outlines for a run of text, at `size` em units.
 *
 * Falls back to the bundled face when the one asked for has not arrived, and
 * asks for it on the way past, so text is never missing — only, briefly, in
 * the wrong typeface.
 */
export function shapesFor(family, text, size) {
  let entry = faces.get(family)
  if (!entry) {
    ensureFont(family)
    entry = faces.get(BUNDLED)
  }

  const outlines = (from) => {
    if (!from) return []
    try {
      return from.kind === 'typeface'
        ? from.face.generateShapes(text, size)
        : shapesFromOpentype(from.face, text, size)
    } catch {
      // A face that cannot set this string is a disappointment, not a reason
      // to stop; the caller is given nothing and falls back.
      return []
    }
  }

  const shapes = outlines(entry)
  if (shapes.length) return shapes
  // Nothing came out — usually a face that simply has no glyph for what was
  // typed, a Latin one asked for Japanese. The bundled face is worth a try
  // before giving up, and giving up returns an empty list rather than throwing.
  return entry === faces.get(BUNDLED) ? [] : outlines(faces.get(BUNDLED))
}
