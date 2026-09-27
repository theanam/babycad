/**
 * Sketch check:  `node tools/check-sketch.mjs`
 *
 * A drawing extruded into a solid, from both ends: the document and the
 * builder, and the SVG importer that writes one.
 *
 * The failure modes here are the ones a screenshot will not catch, which is
 * why this file exists at all:
 *
 *   winding      a ring wound the wrong way is invisible from half the
 *                angles it is wrong from, because three draws back faces
 *                invisibly — the same trap `check-shapes` was written for
 *   nesting      a hole that came out solid, or an island in a hole that
 *                came out as a second hole; both are one parity bit
 *   the Y flip   SVG's Y grows downward and a drawing's does not, and a
 *                mirrored import looks perfectly fine until the first letter
 *   units        `width="40mm"` has to arrive 40 mm across, and a file that
 *                says nothing has to admit it was guessed at
 *
 * The importer needs a `DOMParser`, which Node has not got, so `@xmldom/xmldom`
 * stands in for one. It is a development dependency and nothing ships with it.
 */
import { register } from 'node:module'
import { DOMParser } from '@xmldom/xmldom'

register('./resolve-extensionless.mjs', import.meta.url)
globalThis.DOMParser = DOMParser

const { buildGeometry } = await import('../src/shapes/geometryCache.js')
const { defaultParams, normalizeParams, keyOfParams } = await import('../src/shapes/index.js')
const { flattenSketch, sketchBounds } = await import('../src/shapes/sketch/flatten.js')
const { digestSketch, countSegments, MAX_SEGMENTS } = await import('../src/shapes/sketch/doc.js')
const { readSvgText } = await import('../src/io/importSvg.js')
const { migrate } = await import('../src/io/persistence.js')
const nodes = await import('../src/ui/sketch/nodes.js')
const board = await import('../src/ui/sketch/view.js')
const trace = await import('../src/ui/sketch/trace.js')
const union = await import('../src/shapes/sketch/union.js')
const { SCENE_VERSION } = await import('../src/constants.js')

let problems = 0
const fail = (message) => {
  console.log(`  BAD ${message}`)
  problems++
}
const ok = (message) => console.log(`  ok  ${message}`)
const near = (a, b, tolerance) => Math.abs(a - b) <= tolerance
/** Two decimals, and never "-0.00", which would read as a second direction. */
const round3 = (n) => (Math.round(n * 100) / 100 + 0).toFixed(2)

/** Signed area, the standard way round: positive is counter-clockwise. */
const area = (ring) => {
  let a = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += ring[j].x * ring[i].y - ring[i].x * ring[j].y
  }
  return a / 2
}

/** The same inspection `check-shapes` runs: volume, winding and NaN. */
function inspect(geometry) {
  const position = geometry.getAttribute('position')
  const normals = geometry.getAttribute('normal')
  const index = geometry.getIndex()
  const triangles = index ? index.count / 3 : position.count / 3
  let volume = 0
  let agree = 0
  let disagree = 0
  let nan = 0

  const vertex = (i) => {
    const v = index ? index.getX(i) : i
    return [position.getX(v), position.getY(v), position.getZ(v), v]
  }

  for (let t = 0; t < triangles; t++) {
    const [ax, ay, az, va] = vertex(t * 3)
    const [bx, by, bz] = vertex(t * 3 + 1)
    const [cx, cy, cz] = vertex(t * 3 + 2)
    if ([ax, ay, az, bx, by, bz, cx, cy, cz].some((n) => !Number.isFinite(n))) nan++
    volume += (ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx)) / 6
    const fx = (by - ay) * (cz - az) - (bz - az) * (cy - ay)
    const fy = (bz - az) * (cx - ax) - (bx - ax) * (cz - az)
    const fz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
    if (normals) {
      const dot = fx * normals.getX(va) + fy * normals.getY(va) + fz * normals.getZ(va)
      if (dot > 0) agree++
      else if (dot < 0) disagree++
    }
  }
  return { triangles, volume, agree, disagree, nan }
}

const build = (doc, extra = {}) =>
  buildGeometry('sketch', { ...defaultParams('sketch'), sketch: doc, ...extra })

/* ------------------------------------------------------------ fixtures -- */

const rect = (x, y, w, h, r = 0) => ({ kind: 'rect', x, y, w, h, r })
const circle = (cx, cy, r) => ({ kind: 'circle', cx, cy, r })

const SQUARE = { nodes: [rect(-10, -10, 20, 20)] }
const HOLED = { nodes: [rect(-10, -10, 20, 20), circle(0, 0, 4)] }
const RING = { nodes: [circle(0, 0, 10), circle(0, 0, 5)] }
// An island inside a hole — the middle of an O, and the whole reason nesting
// is counted by parity rather than "is it inside something".
const ISLAND = { nodes: [rect(-15, -15, 30, 30), circle(0, 0, 10), rect(-3, -3, 6, 6)] }
const TWO = { nodes: [rect(-20, -5, 10, 10), rect(10, -5, 10, 10)] }
const ROUNDED = { nodes: [rect(-10, -6, 20, 12, 3)] }
// A closed run of cubics: a circle-ish blob, which is what an import lands as.
const K = 5.523
const BLOB = {
  nodes: [
    {
      kind: 'path',
      segs: [
        ['M', 10, 0],
        ['C', 10, K, K, 10, 0, 10],
        ['C', -K, 10, -10, K, -10, 0],
        ['C', -10, -K, -K, -10, 0, -10],
        ['C', K, -10, 10, -K, 10, 0],
        ['Z'],
      ],
    },
  ],
}

/* ------------------------------------------------------------- flatten -- */

console.log('\nrings, holes and which way round they go…')
{
  const one = flattenSketch(SQUARE, 32)
  if (one.islands.length !== 1) fail(`a square made ${one.islands.length} islands`)
  else if (area(one.islands[0].contour) <= 0) fail('a square came out wound clockwise')
  else ok('a square is one island, wound counter-clockwise')

  const holed = flattenSketch(HOLED, 32)
  const island = holed.islands[0]
  if (holed.islands.length !== 1 || island.holes.length !== 1) {
    fail(`a square with a hole made ${holed.islands.length} islands / ${island?.holes.length} holes`)
  } else if (area(island.holes[0]) >= 0) {
    fail('the hole came out wound counter-clockwise, the same way as the outside')
  } else {
    ok('a hole is nested inside its island and wound the other way')
  }

  const nested = flattenSketch(ISLAND, 32)
  const outer = nested.islands.find((i) => i.holes.length === 1)
  const inner = nested.islands.find((i) => i.holes.length === 0)
  if (nested.islands.length !== 2 || !outer || !inner) {
    fail(`an island inside a hole made ${nested.islands.length} islands`)
  } else if (area(inner.contour) <= 0) {
    fail('the island inside the hole came out wound clockwise')
  } else {
    ok('depth two is material again — an island inside a hole is solid')
  }

  const two = flattenSketch(TWO, 32)
  if (two.islands.length !== 2) fail(`two separate squares made ${two.islands.length} islands`)
  else ok('two separate outlines are two islands')
}

console.log('\nwhat gets left out, and says so…')
{
  const open = flattenSketch({ nodes: [{ kind: 'poly', pts: [[0, 0], [10, 0], [10, 10]], closed: false }] }, 32)
  if (open.islands.length || open.dropped.open !== 1) {
    fail('an open run was not dropped — a line with no thickness cannot be a solid')
  } else ok('an open run is dropped rather than quietly closed')

  const crossing = flattenSketch(
    { nodes: [{ kind: 'poly', pts: [[0, 0], [10, 10], [10, 0], [0, 10]], closed: true }] },
    32
  )
  if (crossing.islands.length || crossing.dropped.crossing !== 1) {
    fail('a figure-of-eight was let through to the triangulator')
  } else ok('a ring that crosses itself is dropped, not guessed at')

  const flat = flattenSketch({ nodes: [{ kind: 'poly', pts: [[0, 0], [10, 0], [20, 0]], closed: true }] }, 32)
  if (flat.islands.length || flat.dropped.tiny !== 1) fail('a ring with no area got through')
  else ok('a ring with no area in it is dropped')
}

/* ------------------------------------------------------------ the build -- */

console.log('\nsolids, and the volume they should have…')
{
  const cases = [
    ['a square', SQUARE, 20 * 20 * 5, 0.005],
    ['a square with a hole', HOLED, (400 - Math.PI * 16) * 5, 0.01],
    ['a ring', RING, Math.PI * (100 - 25) * 5, 0.02],
    ['an island inside a hole', ISLAND, (900 - Math.PI * 100 + 36) * 5, 0.02],
    ['two islands', TWO, 2 * 100 * 5, 0.005],
    ['a blob of cubics', BLOB, Math.PI * 100 * 5, 0.02],
  ]
  for (const [name, doc, expected, tolerance] of cases) {
    const s = inspect(build(doc))
    if (s.nan) fail(`${name} has ${s.nan} triangles with broken coordinates`)
    else if (s.volume <= 0) fail(`${name} came out inside out: volume ${s.volume.toFixed(2)}`)
    else if (s.disagree > s.agree * 0.02) fail(`${name}: ${s.disagree} normals disagree with the winding`)
    else if (!near(s.volume, expected, expected * tolerance)) {
      fail(`${name} is ${s.volume.toFixed(2)} mm³, expected about ${expected.toFixed(2)}`)
    } else {
      ok(`${name} — ${s.triangles} triangles, ${s.volume.toFixed(1)} mm³`)
    }
  }
}

console.log('\nan edge takes material off rather than adding it…')
{
  const sharp = build(SQUARE)
  const round = build(SQUARE, { edge: 1 })
  const chamfer = build(SQUARE, { edge: 1, edgeStyle: 'bevel' })

  for (const [name, geometry] of [['round', round], ['bevel', chamfer]]) {
    const b = geometry.boundingBox
    const s = inspect(geometry)
    if (!near(b.max.x, 10, 1e-6) || !near(b.max.y, 2.5, 1e-6) || !near(b.max.z, 10, 1e-6)) {
      fail(`a 1 mm ${name} edge changed the size: ${b.max.x} × ${b.max.y} × ${b.max.z}`)
    } else if (s.volume >= inspect(sharp).volume) {
      fail(`a 1 mm ${name} edge did not remove any material`)
    } else if (s.nan || s.volume <= 0) {
      fail(`a 1 mm ${name} edge came out broken`)
    } else {
      ok(`a 1 mm ${name} edge: still 20 × 20 × 5 mm, ${s.volume.toFixed(1)} mm³`)
    }
  }
  // The difference between the two is *shading* as much as shape. Three's
  // `ExtrudeGeometry` flat-shades everything, and a flat-shaded round edge is
  // a flight of steps that looks exactly like a chamfer — which is how Edge
  // shape came to be a switch that did nothing.
  //
  // The test is not "which way does the rim point": a fillet runs out onto
  // the face tangentially, so at the rim it points very nearly straight up,
  // the same way the face does. It is how *many* ways it points. A round
  // leaves one normal at each rim point, because the curve and the face are
  // one surface there. A chamfer leaves two, because they are not.
  const rimNormals = (geometry) => {
    const p = geometry.getAttribute('position')
    const n = geometry.getAttribute('normal')
    let top = -Infinity
    for (let i = 0; i < p.count; i++) top = Math.max(top, p.getY(i))
    const at = new Map()
    for (let i = 0; i < p.count; i++) {
      if (Math.abs(p.getY(i) - top) > 1e-4) continue
      const where = `${p.getX(i).toFixed(2)},${p.getZ(i).toFixed(2)}`
      const way = `${round3(n.getX(i))},${round3(n.getY(i))},${round3(n.getZ(i))}`
      if (!at.has(where)) at.set(where, new Set())
      at.get(where).add(way)
    }
    return [...at.values()].map((ways) => ways.size)
  }
  const roundRim = rimNormals(round)
  const bevelRim = rimNormals(chamfer)
  if (!roundRim.length || roundRim.some((ways) => ways !== 1)) {
    fail(`a round edge leaves ${roundRim.join('/')} normals at each rim point — it will read as a bevel`)
  } else if (bevelRim.some((ways) => ways < 2)) {
    fail('a bevel edge was smoothed into the face — a chamfer has to keep its line')
  } else {
    ok('a round edge runs out onto the face as one surface; a bevel keeps its line')
  }

  // And the smoothing must not go so far as to round off a corner that is
  // genuinely a corner: the four upright sides of a square plate.
  const walls = (geometry) => {
    const n = geometry.getAttribute('normal')
    const seen = new Set()
    for (let i = 0; i < n.count; i++) {
      if (Math.abs(n.getY(i)) > 0.01) continue
      seen.add(`${round3(n.getX(i))},${round3(n.getZ(i))}`)
    }
    return seen.size
  }
  if (walls(round) !== 4) {
    fail(`a square plate has ${walls(round)} wall directions, expected its four sides`)
  } else ok('the four upright corners of a square stay corners')

  // Wider than the plate is thick, which every builder here has to survive:
  // the clamp is what stops half a 5 mm plate losing 20 mm of edge.
  const huge = inspect(build(SQUARE, { edge: 500 }))
  if (huge.nan || huge.volume <= 0) fail('an absurd edge broke the solid instead of being clamped')
  else ok('an edge wider than the part is clamped rather than obeyed')
}

console.log('\nsmoothness is still a live parameter after the fact…')
{
  const coarse = inspect(build(RING, { sides: 6 }))
  const fine = inspect(build(RING, { sides: 96 }))
  if (fine.triangles <= coarse.triangles) {
    fail('turning smoothness up did not add any triangles — was the drawing flattened too early?')
  } else if (fine.volume <= coarse.volume) {
    fail('a finer ring did not come out closer to a real circle')
  } else {
    ok(`a ring goes from ${coarse.triangles} triangles to ${fine.triangles}`)
  }
  for (const sides of [3, 32, 96]) {
    const s = inspect(build(ROUNDED, { sides }))
    if (s.nan || s.volume <= 0) fail(`a rounded rectangle at ${sides} sides came out broken`)
  }
  // 20 × 12 with 3 mm corners: the four corners between them lose one square
  // of side r with a circle of radius r put back. A corner radius that was
  // being applied to the wrong dimension, or twice, lands here.
  const corners = inspect(build(ROUNDED, { sides: 96 }))
  const expected = (20 * 12 - (4 - Math.PI) * 9) * 5
  if (!near(corners.volume, expected, expected * 0.001)) {
    fail(`a rounded rectangle is ${corners.volume.toFixed(2)} mm³, expected ${expected.toFixed(2)}`)
  } else {
    ok(`a rounded rectangle builds across the smoothness range, ${corners.volume.toFixed(1)} mm³ with 3 mm corners`)
  }
}

console.log('\nthe degenerate set builds something rather than throwing…')
{
  const empties = [
    ['nothing at all', { nodes: [] }],
    ['a single point', { nodes: [{ kind: 'poly', pts: [[1, 1], [1, 1]], closed: true }] }],
    ['an open run', { nodes: [{ kind: 'poly', pts: [[0, 0], [5, 5]], closed: false }] }],
    ['a path that never starts', { nodes: [{ kind: 'path', segs: [['L', 1, 1], ['L', 2, 2], ['Z']] }] }],
    ['junk', { nodes: [{ kind: 'sphere', r: 'wide' }, null, 7] }],
  ]
  for (const [name, doc] of empties) {
    let geometry
    try {
      geometry = build(doc)
    } catch (error) {
      fail(`${name} threw: ${error.message}`)
      continue
    }
    const position = geometry.getAttribute('position')
    if (!position) fail(`${name} came back with no position attribute — the next thing to read it falls over`)
    else if (position.count !== 0) fail(`${name} built ${position.count} vertices out of nothing`)
  }
  ok(`${empties.length} kinds of empty drawing come back as a real, empty block`)
}

/* -------------------------------------------------------- the document -- */

console.log('\nthe document, and the key the cache takes off it…')
{
  const a = normalizeParams('sketch', { sketch: SQUARE })
  const b = normalizeParams('sketch', { sketch: JSON.parse(JSON.stringify(SQUARE)) })
  if (a.sketch === b.sketch) fail('two blocks were handed the same document object')
  else if (digestSketch(a.sketch) !== digestSketch(b.sketch)) fail('the same drawing digested two ways')
  else ok('the same drawing, arriving twice, is one cache entry and two objects')

  if (keyOfParams('sketch', a) === keyOfParams('sketch', normalizeParams('sketch', { sketch: HOLED }))) {
    fail('two different drawings share a cache key — every sketch would show the same solid')
  } else ok('two different drawings have different cache keys')

  const junk = normalizeParams('sketch', { sketch: 'a picture of a duck' })
  if (junk.sketch?.nodes?.length !== 0) fail('a document of nonsense was not refused')
  else ok('a document of nonsense coerces to an empty drawing')

  if (countSegments(HOLED) !== 8) fail(`a square and a circle counted ${countSegments(HOLED)} segments, expected 8`)
  else ok('segments are counted for the budget')
}

console.log('\na drawing, out to a build file and back…')
{
  // The claim this makes is that a drawing needs no second file: unlike an
  // imported model's triangles, it is small enough to live in the block's own
  // parameters, so it travels in the `.babycad` and in a copy-paste for free.
  // Through `JSON` both ways, because that is what a file is.
  const before = {
    id: 'a',
    type: 'sketch',
    params: { sketch: HOLED, thickness: 7, sides: 48, edge: 0.5, edgeStyle: 'bevel' },
    position: [0, 0, 0],
  }
  const back = migrate(JSON.parse(JSON.stringify({ version: SCENE_VERSION, objects: [before] })))
  const after = back?.objects?.[0]?.params
  if (!after) fail('a build with a drawing in it did not come back at all')
  else if (digestSketch(after.sketch) !== digestSketch(HOLED)) {
    fail('the drawing came back as a different drawing')
  } else if (after.thickness !== 7 || after.sides !== 48 || after.edgeStyle !== 'bevel') {
    fail(`the extrusion came back as ${after.thickness} mm / ${after.sides} sides / ${after.edgeStyle}`)
  } else if (
    !near(inspect(build(after.sketch, after)).volume, inspect(build(HOLED, before.params)).volume, 1e-6)
  ) {
    fail('the solid built from the reopened drawing is a different size')
  } else {
    ok('a drawing travels in the build file and comes back the same solid')
  }
}

/* ---------------------------------------------------------------- SVG -- */

const svg = (body, attrs = 'width="40mm" height="40mm" viewBox="0 0 100 100"') =>
  `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${body}</svg>`

console.log('\nreading an SVG…')
{
  // A triangle with its point at the top of the file, which in SVG is the
  // *small* y. It has to come out with its point at the top of the drawing,
  // which is the large y. This is the whole of the flip test.
  const tri = readSvgText(svg('<path d="M50 0 L100 100 L0 100 Z" fill="#000"/>'), 'tri.svg')
  const apex = tri.doc.nodes[0].segs[0]
  const base = tri.doc.nodes[0].segs[1]
  if (apex[2] <= base[2]) fail('the drawing came in upside down — SVG\'s Y was not flipped')
  else ok('SVG\'s downward Y is flipped on the way in')

  if (!near(tri.size.width, 40, 0.01) || !near(tri.size.height, 40, 0.01)) {
    fail(`width="40mm" with a viewBox came in ${tri.size.width} × ${tri.size.height} mm`)
  } else if (tri.guessed) {
    fail('a file that said how big it was was treated as a guess')
  } else ok('width="40mm" against a viewBox arrives exactly 40 mm across')

  const unsized = readSvgText(svg('<rect x="0" y="0" width="100" height="50"/>', 'viewBox="0 0 100 50"'))
  if (!unsized.guessed) fail('a file with no physical size did not admit it was guessed at')
  else if (!near(unsized.size.width, 40, 0.01)) {
    fail(`an unsized file came in ${unsized.size.width} mm across, expected 40`)
  } else ok('a file that says nothing about its size comes in 40 mm across, and says so')

  const centred = readSvgText(svg('<rect x="60" y="60" width="20" height="20"/>'))
  const box = sketchBounds(centred.doc, 64)
  if (!near((box.minX + box.maxX) / 2, 0, 1e-6) || !near((box.minY + box.maxY) / 2, 0, 1e-6)) {
    fail(`a drawing from the far corner of a file did not come in centred: ${box.minX}..${box.maxX}`)
  } else ok('a drawing arrives centred on its own middle, wherever it sat in the file')
}

console.log('\n…and what it refuses…')
{
  const strokes = () => readSvgText(svg('<path d="M0 0 L100 100" fill="none" stroke="#000"/>'), 'lines.svg')
  try {
    strokes()
    fail('a stroke-only drawing was accepted — there is no area in it to make solid')
  } catch (error) {
    if (!/lines/.test(error.message)) fail(`the stroke-only message does not name the file: ${error.message}`)
    else ok('a stroke-only drawing is refused, by name')
  }

  try {
    readSvgText('<svg xmlns="http://www.w3.org/2000/svg"></svg>', 'empty.svg')
    fail('an SVG with nothing in it was accepted')
  } catch {
    ok('an SVG with no outlines is refused')
  }

  // Well past the budget: one path with more curves in it than a build can
  // carry, which has to be refused rather than accepted and then unsavable.
  let d = 'M0 0'
  for (let i = 0; i < MAX_SEGMENTS + 50; i++) d += ` L${i % 100} ${(i * 7) % 100}`
  try {
    readSvgText(svg(`<path d="${d} Z" fill="#000"/>`), 'huge.svg')
    fail('a drawing past the segment budget was accepted')
  } catch (error) {
    if (!/curves/.test(error.message)) fail(`the budget message does not say what is wrong: ${error.message}`)
    else ok('a drawing past the segment budget is refused, with the count')
  }
}

console.log('\nan SVG, all the way to a solid…')
{
  // A ring drawn as two circle elements: the importer has to bring both in as
  // curves, and the flattener has to work out which is the hole.
  const read = readSvgText(
    svg('<circle cx="50" cy="50" r="40" fill="#000"/><circle cx="50" cy="50" r="20" fill="#fff"/>'),
    'ring.svg'
  )
  const s = inspect(build(read.doc))
  // 40mm across the viewBox's 100 units: the outer circle is 32 mm across,
  // the inner 16, and the plate is 5 mm thick.
  const expected = Math.PI * (16 * 16 - 8 * 8) * 5
  if (s.nan || s.volume <= 0) fail('an imported ring came out broken or inside out')
  else if (!near(s.volume, expected, expected * 0.02)) {
    fail(`an imported ring is ${s.volume.toFixed(1)} mm³, expected about ${expected.toFixed(1)}`)
  } else ok(`an imported ring: ${s.volume.toFixed(1)} mm³, hole and all`)

  const rounded = readSvgText(svg('<rect x="10" y="10" width="80" height="40" rx="10" fill="#000"/>'))
  const r = inspect(build(rounded.doc))
  if (r.nan || r.volume <= 0) fail('an imported rounded rectangle came out broken')
  else ok(`an imported rounded rectangle: ${r.triangles} triangles`)

  const transformed = readSvgText(
    svg('<g transform="translate(20 20) scale(2)"><rect x="0" y="0" width="10" height="10" fill="#000"/></g>')
  )
  const t = sketchBounds(transformed.doc, 32)
  if (!near(t.width, 8, 0.01)) fail(`a transformed rectangle came in ${t.width} mm wide, expected 8`)
  else ok('a group transform is baked in on the way through')
}

/* ------------------------------------------------------ the drawing board -- */

console.log('\ndrawing one, whichever way it was dragged…')
{
  const a = nodes.rectFrom({ x: 10, y: 10 }, { x: -10, y: -6 })
  const b = nodes.rectFrom({ x: -10, y: -6 }, { x: 10, y: 10 })
  if (JSON.stringify(a) !== JSON.stringify(b)) fail('a box dragged up-left is not the box dragged down-right')
  else if (a.x !== -10 || a.y !== -6 || a.w !== 20 || a.h !== 16) fail(`a dragged box came out ${JSON.stringify(a)}`)
  else ok('a box is the same box whichever corner it was started from')

  const c = nodes.circleFrom({ x: 4, y: 4 }, { x: 4, y: 10 })
  if (c.r !== 6 || c.cx !== 4) fail(`a circle dragged from its middle came out ${JSON.stringify(c)}`)
  else ok('a circle is dragged from its middle out')

  const three = nodes.polyFrom([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }])
  const two = nodes.polyFrom([{ x: 0, y: 0 }, { x: 10, y: 0 }])
  if (!three.closed) fail('three corners did not close into a shape')
  else if (two.closed) fail('two points were closed into a shape that encloses nothing')
  else ok('three corners close; two stay open, and are drawn as left out')
}

console.log('\nwhat you can grab, and where it goes…')
{
  const rect = { kind: 'rect', x: 0, y: 0, w: 20, h: 10, r: 0 }
  const grips = nodes.handlesOf(rect)
  if (grips.length !== 4) fail(`a box offered ${grips.length} corners`)
  else {
    // Drag the top-right corner: the bottom-left is the one that must not move.
    const moved = nodes.moveHandle(rect, 'c2', { x: 30, y: 25 })
    if (moved.x !== 0 || moved.y !== 0 || moved.w !== 30 || moved.h !== 25) {
      fail(`dragging a corner moved the opposite one: ${JSON.stringify(moved)}`)
    } else ok('dragging a corner leaves the opposite corner where it was')
  }

  const circle = { kind: 'circle', cx: 5, cy: 5, r: 3 }
  if (nodes.handlesOf(circle).length !== 1) fail('a circle should offer one grip, for its radius')
  else if (nodes.moveHandle(circle, 'r', { x: 15, y: 5 }).r !== 10) fail('the radius grip did not set the radius')
  else ok('a circle has one grip and it is the radius')

  // A path offers grips by how many points it has, not by where it came from:
  // a four-curve blob is a set of handles whichever way it arrived, and a
  // logo's hundreds are a swarm. The swarm and the arc cases are below, with
  // the pen.
  if (nodes.handlesOf(BLOB.nodes[0]).length !== 4) {
    fail(`a four-anchor outline offered ${nodes.handlesOf(BLOB.nodes[0]).length} grips, expected 4`)
  } else ok('a short outline offers its anchors, however it arrived')

  const poly = { kind: 'poly', pts: [[0, 0], [10, 0], [10, 10]], closed: true }
  const pulled = nodes.moveHandle(poly, 'p1', { x: 4, y: 4 })
  if (JSON.stringify(pulled.pts[1]) !== JSON.stringify([4, 4])) fail('a polyline point did not move')
  else if (JSON.stringify(pulled.pts[0]) !== JSON.stringify([0, 0])) fail('moving one point moved another')
  else ok('a polyline point moves on its own')
}

console.log('\ntyping a measurement…')
{
  const rect = { kind: 'rect', x: -5, y: -5, w: 10, h: 10, r: 0 }
  const wider = nodes.applyDimension(rect, 'w', 30)
  if (wider.x !== -5 || wider.w !== 30) fail(`typing a width moved the left edge: ${JSON.stringify(wider)}`)
  else ok('a typed width moves the right edge and leaves the left one')

  const taller = nodes.applyDimension(rect, 'h', 30)
  if (taller.y !== -5 || taller.h !== 30) fail('typing a height moved the bottom edge')
  else ok('a typed height moves the top edge and leaves the bottom one')

  const rounded = nodes.applyDimension(rect, 'r', 50)
  if (rounded.r !== 5) fail(`a corner radius bigger than the box was not clamped: ${rounded.r}`)
  else ok('a corner radius is clamped to half the smaller side')

  const circle = nodes.applyDimension({ kind: 'circle', cx: 3, cy: 4, r: 1 }, 'd', 10)
  if (circle.r !== 5 || circle.cx !== 3 || circle.cy !== 4) fail('a typed diameter did not grow about the middle')
  else ok('a typed diameter grows a circle about its middle')

  const poly = { kind: 'poly', pts: [[0, 0], [10, 0], [10, 10]], closed: true }
  const set = nodes.applyDimension(poly, 's0', 25)
  if (JSON.stringify(set.pts[1]) !== JSON.stringify([25, 0])) {
    fail(`a typed segment length landed at ${JSON.stringify(set.pts[1])}`)
  } else if (JSON.stringify(set.pts[0]) !== JSON.stringify([0, 0]) || JSON.stringify(set.pts[2]) !== JSON.stringify([10, 10])) {
    fail('a typed segment length dragged the rest of the ring with it')
  } else ok('a typed segment length moves its far end along its own direction, and nothing else')

  // The promise the importer makes: an SVG that never said how big it was can
  // be given a size here.
  const before = nodes.boundsOf(BLOB.nodes[0], 64)
  const scaled = nodes.applyDimension(BLOB.nodes[0], 'size', 50, 64)
  const after = nodes.boundsOf(scaled, 64)
  if (!near(after.width, 50, 0.01)) fail(`resizing an import landed at ${after.width} mm, not 50`)
  else if (!near(after.width / after.height, before.width / before.height, 0.001)) {
    fail('resizing an import changed its proportions')
  } else if (!near((after.minX + after.maxX) / 2, (before.minX + before.maxX) / 2, 0.01)) {
    fail('resizing an import moved it off its own middle')
  } else ok('an imported outline can be given a size, about its own middle')

  const square = nodes.applyDimension(rounded, 'r', 0)
  if (square.r !== 0) fail('a corner could not be put back to square')
  else if (!nodes.dimensionsOf(rect, 32, true).some((d) => d.key === 'r')) {
    fail('a box being worked on offers no corner radius, so one can never be started')
  } else if (nodes.dimensionsOf(rect, 32, false).some((d) => d.key === 'r')) {
    fail('every box on the board is shouting a corner radius of nought')
  } else ok('the corner radius shows on the box being worked on, and can go back to nought')

  if (nodes.applyDimension(rect, 'w', -4) !== rect) fail('a negative measurement was accepted')
  else if (nodes.applyDimension(rect, 'w', 'wide') !== rect) fail('a measurement of nonsense was accepted')
  else ok('a measurement that is not a positive number changes nothing')
}

console.log('\npicking things off the board…')
{
  const rect = { kind: 'rect', x: 0, y: 0, w: 20, h: 10, r: 0 }
  if (!nodes.hitTest(rect, { x: 10, y: 5 }, 1)) fail('clicking the middle of a box did not pick it')
  else if (!nodes.hitTest(rect, { x: 20.5, y: 5 }, 1)) fail('clicking just outside the edge did not pick it')
  else if (nodes.hitTest(rect, { x: 40, y: 5 }, 1)) fail('clicking well clear of a box picked it')
  else ok('a box is picked from inside it, or from near its edge')

  // Topmost wins, so a small shape drawn on a big one is reachable.
  const doc = { nodes: [rect, { kind: 'circle', cx: 10, cy: 5, r: 2 }] }
  if (nodes.nodeAt(doc, { x: 10, y: 5 }, 1) !== 1) fail('the shape underneath was picked instead of the one on top')
  else if (nodes.nodeAt(doc, { x: 99, y: 99 }, 1) !== null) fail('a click on nothing picked something')
  else ok('the topmost outline is the one that gets picked')

  const box = nodes.boundsOf(rect, 32)
  if (box.minY !== 0 || box.maxY !== 10) fail(`a box measured ${box.minY}..${box.maxY} up the page`)
  else ok('an outline measures the same way up it was drawn')
}

console.log('\nthe pen lays down curves…')
{
  const corner = (x, y) => ({ x, y, hx: 0, hy: 0 })
  const curved = (x, y, hx, hy) => ({ x, y, hx, hy })

  // Two corners in a row are a straight line, not a curve with its controls
  // sitting on top of its ends: it has to come out as a real `L`, or every
  // straight edge a pen draws would flatten as a curve and measure as one.
  const straight = nodes.pathFrom([corner(0, 0), corner(10, 0), corner(10, 10)], false)
  if (straight.segs.map((s) => s[0]).join('') !== 'MLL') {
    fail(`corners came out as ${straight.segs.map((s) => s[0]).join('')}, expected MLL`)
  } else ok('corner to corner is a straight line, not a flat curve')

  const bowed = nodes.pathFrom([corner(0, 0), curved(10, 10, 4, 0)], false)
  const c = bowed.segs[1]
  if (c[0] !== 'C') fail('an anchor with a handle did not make a curve')
  else if (c[3] !== 6 || c[4] !== 10) {
    fail(`the curve arrives on (${c[3]}, ${c[4]}); a handle stands for both sides, so it should be (6, 10)`)
  } else ok('a handle bends the curve on both sides of its anchor')

  const shut = nodes.pathFrom([corner(0, 0), corner(10, 0), corner(10, 10)], true)
  if (shut.segs[shut.segs.length - 1][0] !== 'Z') fail('a closed run has no Z on the end of it')
  else if (shut.segs.length !== 5) fail(`a closed triangle came out ${shut.segs.length} segments, expected 5`)
  else ok('closing adds the segment back to the start, and the Z')

  if (nodes.pathFrom([corner(1, 1)], false)) fail('one anchor was accepted as a shape')
  else if (nodes.pathFrom([], false)) fail('no anchors at all were accepted as a shape')
  else ok('a run of fewer than two anchors is not a shape')

  // The drawn curve has to build, and get smoother when asked to.
  const drawn = { nodes: [nodes.pathFrom([curved(-10, 0, 0, 6), curved(10, 0, 0, -6)], true)] }
  const coarse = inspect(build(drawn, { sides: 4 }))
  const fine = inspect(build(drawn, { sides: 64 }))
  if (fine.volume <= 0 || fine.nan) fail('a pen-drawn outline came out broken or inside out')
  else if (fine.triangles <= coarse.triangles) fail('a pen-drawn curve ignores Smoothness')
  else ok(`a pen-drawn curve builds, and goes from ${coarse.triangles} to ${fine.triangles} triangles`)
}

console.log('\n…and they can be pushed about afterwards…')
{
  const shut = nodes.pathFrom(
    [{ x: 0, y: 0, hx: 3, hy: 0 }, { x: 10, y: 0, hx: 0, hy: 3 }, { x: 10, y: 10, hx: -3, hy: 0 }],
    true
  )
  const grips = nodes.handlesOf(shut)
  if (grips.length !== 3) fail(`a three-anchor curve offers ${grips.length} grips`)
  else if (grips[0].x !== 0 || grips[0].y !== 0) fail('the first grip is not on the first anchor')
  else ok('a pen-drawn curve offers one grip per anchor')

  // The first anchor of a closed run is written twice — as the M and as the
  // end of the segment that comes back round. Both have to move, or the
  // outline tears open at the seam.
  const moved = nodes.moveHandle(shut, 'a0', { x: -5, y: -5 })
  const ends = moved.segs.filter((s) => s[0] !== 'Z')
  const first = ends[0]
  const last = ends[ends.length - 1]
  if (first[1] !== -5 || first[2] !== -5) fail('moving the first anchor did not move it')
  else if (Math.abs(last[5] - -5) > 1e-6 || Math.abs(last[6] - -5) > 1e-6) {
    fail(`the closing segment still ends at (${last[5]}, ${last[6]}) — the outline is torn open`)
  } else ok('moving the anchor a closed run starts and ends on moves both')

  // And the curve comes with it rather than being stretched: the control
  // points either side shift by the same amount.
  const outgoing = ends[1]
  if (Math.abs(outgoing[1] - -2) > 1e-6 || Math.abs(outgoing[2] - -5) > 1e-6) {
    fail(`the handle the curve leaves on stayed behind at (${outgoing[1]}, ${outgoing[2]})`)
  } else ok('an anchor takes its handles with it, so the curve keeps its shape')

  const still = nodes.moveHandle(shut, 'a9', { x: 1, y: 1 })
  if (still !== shut) fail('a grip that does not exist still changed the outline')
  else ok('a grip that is not there does nothing')

  // An import is a different matter: arcs have no endpoint written into the
  // segment, and a logo has hundreds of controls that are not handles.
  const arc = { kind: 'path', segs: [['M', 0, 0], ['E', 0, 0, 5, 5, 0, 3.14, 0, 0], ['Z']] }
  if (nodes.anchorsOf(arc)) fail('a path with an arc in it offered its points as grips')
  else if (nodes.handlesOf(arc).length) fail('a path with an arc in it offered grips anyway')
  else ok('an imported outline with arcs in it moves as a whole, as it did before')

  const swarm = nodes.pathFrom(
    Array.from({ length: 40 }, (_, i) => ({ x: i, y: i % 3, hx: 0, hy: 0 })),
    true
  )
  if (nodes.handlesOf(swarm).length) fail('a forty-point outline offered forty grips')
  else ok('too many points to be handles means no handles')
}

console.log('\nthe line being drawn says what it is…')
{
  const p = (x, y) => ({ x, y })
  const one = nodes.drawingLine([p(0, 0)], p(30, 40))
  if (one.length !== 1) fail(`a first segment showed ${one.length} numbers, expected just its length`)
  else if (!near(one[0].value, 50, 1e-9)) fail(`a 3-4-5 segment measured ${one[0].value}`)
  else ok('the first segment shows its length, and nothing about a corner it has not made yet')

  const corner = (a, b, c) => nodes.drawingLine([p(...a), p(...b)], p(...c)).find((d) => d.unit === '°')
  const cases = [
    ['a right angle', [[0, 0], [10, 0], [10, 10]], 90],
    ['straight on', [[0, 0], [10, 0], [25, 0]], 180],
    ['doubled back', [[0, 0], [10, 0], [4, 0]], 0],
    ['a shallow turn', [[0, 0], [10, 0], [20, 10]], 135],
  ]
  for (const [name, [a, b, c], want] of cases) {
    const got = corner(a, b, c)
    if (!got) fail(`${name} produced no corner reading at all`)
    else if (!near(got.value, want, 0.01)) fail(`${name} read ${got.value.toFixed(2)}°, expected ${want}`)
    else if (!Number.isFinite(got.ox) || !Number.isFinite(got.oy)) {
      fail(`${name} put the label nowhere: (${got.ox}, ${got.oy})`)
    }
  }
  ok(`${cases.length} corners read the angle at the corner, not the turn away from it`)

  // The reading is at the corner it describes, and sits in the opening rather
  // than on top of one of the two lines making it. Coming in from the left
  // and turning upwards leaves an opening up and to the left — which in the
  // screen offsets these carry is negative in both, because screen y runs
  // the other way from the drawing's.
  const open = corner([0, 0], [10, 0], [10, 10])
  if (open.x !== 10 || open.y !== 0) fail('the corner reading is not at the corner')
  else if (!(open.ox < 0 && open.oy < 0)) {
    fail(`a corner opening up and to the left put its label at (${open.ox}, ${open.oy})`)
  } else ok('the corner reading sits at the corner, out in the opening')

  // The pen asks for the length without the angle on a curved segment: the
  // straight line between two anchors is not the corner you can see.
  const quiet = nodes.drawingLine([p(0, 0), p(10, 0)], p(10, 10), { angle: false })
  if (quiet.length !== 1 || quiet[0].unit === '°') fail('the corner reading could not be turned off')
  else ok('a curved segment reads its length without claiming a corner')

  if (nodes.drawingLine([], p(1, 1)).length) fail('a line with no start still measured something')
  else if (nodes.drawingLine([p(2, 2)], p(2, 2)).length) fail('a segment of no length still measured something')
  else if (nodes.drawingLine([p(0, 0)], null).length) fail('a line with no end still measured something')
  else ok('a line that is not yet a line says nothing')
}

console.log('\nthe board\u2019s own camera…')
{
  const size = { w: 800, h: 600 }
  const view = { cx: 10, cy: 20, scale: 4 }
  const there = board.toScreen(view, size, 30, 40)
  const back = board.toDrawing(view, size, there.x, there.y)
  if (!near(back.x, 30, 1e-9) || !near(back.y, 40, 1e-9)) fail('millimetres and pixels do not round-trip')
  else ok('millimetres and pixels round-trip')

  // Up the drawing is up the screen, which is the sign that is wrong in every
  // one of these that has ever been wrong.
  if (board.toScreen(view, size, 0, 10).y >= board.toScreen(view, size, 0, 0).y) {
    fail('a bigger Y came out lower down the screen — the board is upside down')
  } else ok('up the drawing is up the screen')

  const cursor = { x: 640, y: 120 }
  const was = board.toDrawing(view, size, cursor.x, cursor.y)
  const zoomed = board.zoomAt(view, size, cursor, 2.5)
  const now = board.toDrawing(zoomed, size, cursor.x, cursor.y)
  if (!near(was.x, now.x, 1e-9) || !near(was.y, now.y, 1e-9)) {
    fail('zooming moved the millimetre that was under the cursor')
  } else ok('zooming keeps the millimetre under the cursor where it is')

  const framed = board.fitView({ minX: 0, minY: 0, maxX: 100, maxY: 50, width: 100, height: 50 }, size)
  if (!near(framed.cx, 50, 1e-9) || !near(framed.cy, 25, 1e-9)) fail('fitting did not centre on the drawing')
  else if (framed.scale * 100 > size.w) fail('fitting left the drawing wider than the board')
  else ok('fitting centres the drawing and keeps it on screen')

  if (board.snapPoint({ x: 3.4, y: -3.4 }, 1).x !== 3 || board.snapPoint({ x: 3.4, y: -3.4 }, 1).y !== -3) {
    fail('snapping does not round to the grid')
  } else if (board.snapPoint({ x: 3.4, y: 0 }, 0).x !== 3.4) {
    fail('snapping turned off still moved the point')
  } else ok('snapping rounds to the grid, and off means off')
}

console.log('\noverlapping outlines are one shape…')
{
  // Without Manifold up, two crossing rectangles are two pieces standing in
  // the same place: the right silhouette, and a seam through the middle of
  // it. This is the state the app is in for the first moment after a drawing
  // appears, so it has to build something sensible.
  const CROSS = {
    nodes: [rect(-20, -6, 40, 12), rect(-6, -20, 12, 40)],
  }
  const apart = flattenSketch(CROSS, 32)
  if (apart.islands.length !== 2) fail(`before Manifold, crossing boxes made ${apart.islands.length} pieces`)
  else ok('before Manifold is up, crossing outlines are still two pieces — honest, and buildable')

  const separate = inspect(build(CROSS))
  await union.warmUnion()
  if (!union.unionReady()) fail('Manifold would not start, so the union can never happen')
  else {
    const one = flattenSketch(CROSS, 32)
    if (one.islands.length !== 1) fail(`crossing boxes came out as ${one.islands.length} islands, expected 1`)
    else if (one.islands[0].contour.length !== 12) {
      fail(`the union of two crossing boxes has ${one.islands[0].contour.length} corners, expected 12`)
    } else ok('two crossing outlines become one, with the corners of a cross')

    // The overlap was being counted twice; the union is the honest volume.
    const merged = inspect(build(CROSS))
    const expected = (40 * 12 + 12 * 40 - 12 * 12) * 5
    if (!near(merged.volume, expected, 1)) {
      fail(`a unioned cross is ${merged.volume.toFixed(1)} mm³, expected ${expected}`)
    } else if (merged.volume >= separate.volume) {
      fail('the union did not remove the doubled-up overlap')
    } else ok(`the cross is ${merged.volume} mm³ once, not ${separate.volume} counted twice`)

    // Nesting still has to work, and has to keep working through a union.
    const holed = flattenSketch(HOLED, 32)
    if (holed.islands.length !== 1 || holed.islands[0].holes.length !== 1) {
      fail('a hole stopped being a hole once the union was in the way')
    } else ok('a ring inside another is still a hole, not part of the union')

    const island = flattenSketch(ISLAND, 32)
    if (island.islands.length !== 2) fail('the island inside a hole was swallowed by the union')
    else ok('an island inside a hole survives the union')

    // Two crossing L-shapes can enclose a void neither of them contains —
    // something containment alone could never find.
    const L = (x, y) => ({
      kind: 'poly',
      closed: true,
      pts: [[x, y], [x + 30, y], [x + 30, y + 8], [x + 8, y + 8], [x + 8, y + 30], [x, y + 30]],
    })
    const ring = flattenSketch({ nodes: [L(0, 0), { ...L(0, 0), pts: L(0, 0).pts.map(([a, b]) => [30 - a, 30 - b]) }] }, 32)
    if (ring.islands.length === 1 && ring.islands[0].holes.length === 1) {
      ok('two outlines can enclose a hole between them that neither of them contains')
    } else {
      fail(`crossing L-shapes made ${ring.islands.length} islands with ${ring.islands[0]?.holes.length} holes`)
    }
  }
}

console.log('\nthe photo you trace over…')
{
  const view = { cx: 10, cy: -4, scale: 5 }
  const size = { w: 1000, h: 600 }
  const wide = trace.fitPhoto({ w: 800, h: 500 }, view, size)
  if (!near(wide.w / wide.h, 1.6, 1e-6)) fail(`a photo arrived at ${wide.w}×${wide.h}, out of proportion`)
  else if (!near(wide.x + wide.w / 2, view.cx, 1e-9) || !near(wide.y + wide.h / 2, view.cy, 1e-9)) {
    fail('a photo did not arrive in the middle of the view')
  } else if (wide.w * view.scale > size.w || wide.h * view.scale > size.h) {
    fail('a photo arrived bigger than the board it is on')
  } else ok('a photo arrives in the middle of the view, whole, in proportion')

  // A tall photo has to be held by its height instead, or it runs off the top.
  const tall = trace.fitPhoto({ w: 300, h: 900 }, view, size)
  if (tall.h * view.scale > size.h) fail('a tall photo ran off the top of the board')
  else if (!near(tall.w / tall.h, 1 / 3, 1e-6)) fail('a tall photo came in out of proportion')
  else ok('a tall photo is held by its height rather than its width')

  // Scaling: the opposite corner stays, the proportions hold.
  const box = { x: 0, y: 0, w: 80, h: 50 }
  const pulled = trace.resizePhoto(box, 't2', { x: 160, y: 40 })
  if (!near(pulled.x, 0, 1e-9) || !near(pulled.y, 0, 1e-9)) {
    fail(`dragging a corner moved the opposite one to (${pulled.x}, ${pulled.y})`)
  } else if (!near(pulled.w / pulled.h, 1.6, 1e-9)) {
    fail(`a dragged photo came out ${pulled.w}×${pulled.h} — stretched`)
  } else if (!near(pulled.w, 160, 1e-9)) {
    fail(`the corner did not keep up with the pointer: ${pulled.w}`)
  } else ok('a photo scales from the corner opposite, keeping its proportions')

  // Dragged past the anchor it flips to the other side rather than inverting.
  const across = trace.resizePhoto(box, 't2', { x: -100, y: -60 })
  if (across.w <= 0 || across.h <= 0) fail('a photo dragged past its anchor turned inside out')
  else if (!near(across.x + across.w, 0, 1e-9)) fail('a photo dragged past its anchor lost the anchor')
  else ok('a photo dragged past its own anchor lands the other side of it')

  if (trace.resizePhoto(box, 't2', { x: 0.0001, y: 0 }).w < 1) {
    fail('a photo could be shrunk to nothing, and then never grabbed again')
  } else ok('a photo cannot be shrunk past a millimetre')

  const moved = trace.movePhoto(box, -5, 12)
  if (moved.x !== -5 || moved.y !== 12 || moved.w !== 80) fail('moving a photo changed its size')
  else ok('moving a photo only moves it')

  if (trace.resizePhoto(box, 'nope', { x: 1, y: 1 }) !== box) fail('a corner that is not there resized the photo')
  else ok('a corner that is not there does nothing')

  // It is a backdrop: nothing about it is in the document, so nothing about
  // it can reach the solid or the file.
  const withPhoto = normalizeParams('sketch', { sketch: { nodes: SQUARE.nodes, photo: 'blob:whatever' } })
  if ('photo' in withPhoto.sketch) fail('a photo was let into the drawing itself')
  else ok('a photo cannot get into the document, so it cannot reach the build')
}

console.log(problems ? `\n${problems} problem${problems === 1 ? '' : 's'}` : '\nall clear')
process.exit(problems ? 1 : 0)
