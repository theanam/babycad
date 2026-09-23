/**
 * Export check:  `node tools/check-export.mjs`
 *
 * Whether what leaves the app is a solid a printer will accept. A mesh can be
 * exactly the right shape and still be refused: a slicer rebuilds solid from
 * shared edges, so what it needs is not a picture but a properly joined one.
 * Both of the faults checked here shipped, and neither looked like anything on
 * screen.
 *
 *   swept shapes are closed      three takes a part-turn by leaving triangles
 *                                out, so a quarter donut was a curved wall
 *                                with nothing across the two cut faces. It
 *                                rendered as a shape you could see through
 *                                and exported as a surface, not a solid.
 *   cut shapes are joined up     three-bvh-csg re-tiles a face around the rim
 *                                of a hole without meeting the triangles
 *                                already along that face's edge. A die had
 *                                four thousand edges with a face on one side
 *                                only and would not print. `io/solidCut`
 *                                rebuilds those with Manifold on the way out.
 *
 * Every measure is per part. Two solids that touch share faces, which looks
 * non-manifold measured as one lump and is perfectly ordinary.
 */
import { register } from 'node:module'

register('./resolve-extensionless.mjs', import.meta.url)

const { EXAMPLES, buildExample } = await import('../src/examples/index.js')
const { acquireShape, releaseShape, cuttersByObject, relativeCutters } = await import('../src/shapes/csg.js')
const { cutForExport } = await import('../src/io/solidCut.js')
const { buildGeometry } = await import('../src/shapes/geometryCache.js')
const { defaultParams, SHAPE_TYPES } = await import('../src/shapes/index.js')

let problems = 0
const fail = (message) => {
  console.log(`  BAD ${message}`)
  problems++
}

/**
 * What a slicer would make of one mesh.
 *
 * Corners are matched by position rounded to a hundred-thousandth of a
 * millimetre, which is how a slicer joins them too — it has no more to go on
 * than the numbers in the file.
 */
function audit(geometry) {
  const flat = geometry.getIndex() ? geometry.toNonIndexed() : geometry
  const pos = flat.getAttribute('position')
  const at = (i) => [pos.getX(i), pos.getY(i), pos.getZ(i)]
  const key = (i) => at(i).map((v) => Math.round(v * 1e5)).join(',')

  const edges = new Map()
  const oneWay = new Set()
  let volume = 0
  let degenerate = 0
  let doubleWound = 0
  for (let t = 0; t < pos.count; t += 3) {
    const [a, b, c] = [at(t), at(t + 1), at(t + 2)]
    volume +=
      (a[0] * (b[1] * c[2] - b[2] * c[1]) +
        a[1] * (b[2] * c[0] - b[0] * c[2]) +
        a[2] * (b[0] * c[1] - b[1] * c[0])) / 6
    const k = [key(t), key(t + 1), key(t + 2)]
    if (k[0] === k[1] || k[1] === k[2] || k[0] === k[2]) {
      degenerate++
      continue
    }
    for (let i = 0; i < 3; i++) {
      const x = k[i]
      const y = k[(i + 1) % 3]
      // In a solid wound the same way throughout, every edge is travelled once
      // in each direction. Twice the same way means two faces lying together.
      if (oneWay.has(`${x}>${y}`)) doubleWound++
      oneWay.add(`${x}>${y}`)
      const e = x < y ? `${x}|${y}` : `${y}|${x}`
      edges.set(e, (edges.get(e) ?? 0) + 1)
    }
  }
  let open = 0
  let crowded = 0
  for (const n of edges.values()) {
    if (n === 1) open++
    else if (n > 2) crowded++
  }
  if (flat !== geometry) flat.dispose()
  return { open, crowded, degenerate, doubleWound, volume }
}

const complain = (what, r) => {
  if (r.open) fail(`${what}: ${r.open} edges with a face on one side only`)
  if (r.crowded) fail(`${what}: ${r.crowded} edges with three or more faces`)
  if (r.degenerate) fail(`${what}: ${r.degenerate} triangles with no area`)
  if (r.doubleWound) fail(`${what}: ${r.doubleWound} edges travelled twice the same way`)
  if (!(r.volume > 0)) fail(`${what}: wound inside out, or no volume at all`)
}

/* ------------------------------------------------- a part-turn is a solid -- */

console.log('\na shape swept short of a whole turn is still a solid…')
const SWEPT = SHAPE_TYPES.filter((type) => 'sweep' in defaultParams(type))
for (const type of SWEPT) {
  const base = defaultParams(type)
  const whole = audit(buildGeometry(type, { ...base, sweep: 360 }))
  for (const sweep of [360, 270, 180, 90, 45, 10]) {
    const r = audit(buildGeometry(type, { ...base, sweep }))
    complain(`${type} swept ${sweep}°`, r)
    // A part-turn takes its own share of the whole, give or take the extra a
    // coarser polygon leaves on the outside of the curve.
    const want = (whole.volume * sweep) / 360
    const off = Math.abs(r.volume - want) / want
    if (off > 0.05)
      fail(`${type} swept ${sweep}° holds ${r.volume.toFixed(1)}, not the ${want.toFixed(1)} that share of it should`)
  }
  console.log(`  ok  ${type} — closed and the right size at every sweep`)
}

/* -------------------------------------------- what the examples export as -- */

console.log('\nevery example exports as a closed, properly joined solid…')
for (const example of EXAMPLES) {
  const { objects } = buildExample(example)
  const cutters = cuttersByObject(objects)
  let parts = 0
  let cut = 0
  for (const o of objects) {
    if (o.hole) continue
    parts++
    const holes = cutters.get(o.id) ?? null
    const rebuilt = holes?.length
      ? await cutForExport(o.type, o.params, relativeCutters(o, holes))
      : null
    if (holes?.length && !rebuilt) {
      fail(`${example.name}: the ${o.type} with holes in it could not be rebuilt as a solid`)
      continue
    }
    if (rebuilt) cut++
    const geometry = rebuilt ?? acquireShape(o, holes)
    complain(`${example.name} / ${o.type}`, audit(geometry))
    if (rebuilt) rebuilt.dispose()
    else releaseShape(geometry)
  }
  console.log(`  ok  ${example.name} — ${parts} part${parts === 1 ? '' : 's'}${cut ? `, ${cut} with holes cut out` : ''}`)
}

console.log(problems ? `\n${problems} problem${problems === 1 ? '' : 's'}` : '\nall clear')
process.exit(problems ? 1 : 0)
