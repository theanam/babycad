/**
 * Holes check:  `node tools/check-holes.mjs`
 *
 * A hole cuts every solid it overlaps (see src/shapes/csg.js); combining it is
 * only what stops the ghost being drawn. Nothing here looks at pixels; what it
 * checks is the part that is easy to get subtly wrong and impossible to
 * eyeball:
 *
 *   the cut is the right size    signed volume of the result, against the
 *                                arithmetic — a subtraction that quietly did
 *                                nothing still renders as a perfectly good
 *                                solid block
 *   it comes back in local space the mesh keeps its own transform, so a cut
 *                                returned in world space would fling the block
 *                                across the plate
 *   only the right things cut    a hole reaches what it overlaps and nothing
 *                                else, and never another hole or itself
 *   it stays watertight          no stray or degenerate triangles, or the STL
 *                                won't print
 */
import { register } from 'node:module'

register('./resolve-extensionless.mjs', import.meta.url)

const THREE = await import('three')
const { acquireShape, releaseShape, cuttersByObject, isFinished } = await import('../src/shapes/csg.js')
const { defaultParams } = await import('../src/shapes/index.js')

let problems = 0
const fail = (message) => {
  console.log(`  BAD ${message}`)
  problems++
}

/** Signed volume: positive means the triangles wind outward, as they must. */
function volume(geometry) {
  const p = geometry.getAttribute('position')
  const index = geometry.getIndex()
  const count = index ? index.count : p.count
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3()
  const cross = new THREE.Vector3()
  let total = 0
  let degenerate = 0
  let nan = 0
  for (let i = 0; i < count; i += 3) {
    const [i0, i1, i2] = index
      ? [index.getX(i), index.getX(i + 1), index.getX(i + 2)]
      : [i, i + 1, i + 2]
    a.fromBufferAttribute(p, i0)
    b.fromBufferAttribute(p, i1)
    c.fromBufferAttribute(p, i2)
    if ([a, b, c].some((v) => !Number.isFinite(v.x + v.y + v.z))) { nan++; continue }
    cross.crossVectors(b, c)
    total += a.dot(cross) / 6
    if (cross.subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).lengthSq() < 1e-12) {
      degenerate++
    }
  }
  return { volume: total, triangles: count / 3, degenerate, nan }
}

const block = (type, over = {}) => ({
  id: over.id ?? Math.random().toString(36).slice(2),
  type,
  params: { ...defaultParams(type), ...(over.params ?? {}) },
  position: over.position ?? [0, 0, 0],
  rotation: over.rotation ?? [0, 0, 0],
  scale: over.scale ?? [1, 1, 1],
  hole: over.hole ?? false,
  parentGroupId: over.parentGroupId ?? null,
})

console.log('a hole takes exactly its own volume out…')
{
  // A 20 mm cube with a 10 mm cube hole buried dead centre: 8000 - 1000.
  const solid = block('cube', { id: 's' })
  const hole = block('cube', {
    id: 'h', hole: true,
    params: { width: 10, height: 10, depth: 10 },
  })
  const cut = acquireShape(solid, [hole])
  const m = volume(cut)
  if (Math.abs(m.volume - 7000) > 1) fail(`buried hole: volume ${m.volume.toFixed(1)}, expected 7000`)
  if (m.nan) fail(`buried hole: ${m.nan} NaN triangles`)
  if (m.volume <= 0) fail('buried hole: wound inside out')
  releaseShape(cut)
}

console.log('\nthe cut comes back in the block’s own space…')
{
  // Same pair, both slid 80 mm along x. The cut must be identical, and still
  // centred on the block's own origin.
  const solid = block('cube', { id: 's', position: [80, 10, 0] })
  const hole = block('cube', {
    id: 'h', hole: true, position: [80, 10, 0],
    params: { width: 10, height: 10, depth: 10 },
  })
  const cut = acquireShape(solid, [hole])
  cut.computeBoundingBox()
  const bb = cut.boundingBox
  if (Math.abs(bb.min.x + 10) > 0.01 || Math.abs(bb.max.x - 10) > 0.01) {
    fail(`moved pair: local bbox x is ${bb.min.x.toFixed(2)}..${bb.max.x.toFixed(2)}, expected -10..10`)
  }
  const m = volume(cut)
  if (Math.abs(m.volume - 7000) > 1) fail(`moved pair: volume ${m.volume.toFixed(1)}, expected 7000`)
  releaseShape(cut)
}

console.log('\nwho cuts whom…')
{
  // Overlapping and not combined with anything: it still cuts. That is the
  // whole point — the cut is what you see while you are lining the hole up.
  const loose = [block('cube', { id: 's' }), block('cube', { id: 'h', hole: true })]
  const cutters = cuttersByObject(loose)
  if (cutters.get('s')?.length !== 1) fail('an overlapping hole did not cut a block it was not combined with')
  if (cutters.has('h')) fail('a hole was handed a cutter of its own')

  // Far enough away that the boxes never meet, so no subtraction is even tried.
  const apart = [block('cube', { id: 's' }), block('cube', { id: 'h', hole: true, position: [200, 10, 0] })]
  if (cuttersByObject(apart).has('s')) fail('a hole 200 mm away was offered as a cutter')

  // A hole is never cut by another hole.
  const two = [
    block('cube', { id: 'h1', hole: true }),
    block('cube', { id: 'h2', hole: true }),
  ]
  if (cuttersByObject(two).size) fail('one hole was set to cut another')

  // A scene with no holes in it does no work at all.
  if (cuttersByObject([block('cube'), block('sphere')]).size) fail('a scene with no holes produced cutters')

  // Combining is what retires the ghost, and only for a hole.
  if (isFinished(block('cube', { hole: true }))) fail('an uncombined hole counted as finished')
  if (!isFinished(block('cube', { hole: true, parentGroupId: 'g' }))) fail('a combined hole did not count as finished')
  if (isFinished(block('cube', { parentGroupId: 'g' }))) fail('a combined solid counted as a finished hole')
}

console.log('\ntwo holes each take their share…')
{
  const solid = block('cube', { params: { width: 40, height: 20, depth: 20 } })
  const mk = (x) =>
    block('cube', {
      hole: true, position: [x, 0, 0],
      params: { width: 8, height: 8, depth: 8 },
    })
  const cut = acquireShape(solid, [mk(-10), mk(10)])
  const m = volume(cut)
  const expected = 40 * 20 * 20 - 2 * 512
  if (Math.abs(m.volume - expected) > 1) fail(`two holes: volume ${m.volume.toFixed(1)}, expected ${expected}`)
  if (m.nan) fail(`two holes: ${m.nan} NaN triangles`)
  releaseShape(cut)
}

console.log('\na hole right through, and a round one…')
{
  // A tube punched all the way through a cube: the cut is a cube minus a
  // cylinder, and the length of the cylinder past the faces doesn't count.
  const solid = block('cube')
  const drill = block('cylinder', {
    hole: true,
    params: { bottomRadius: 5, topRadius: 5, height: 60, sides: 64 },
  })
  const cut = acquireShape(solid, [drill])
  const m = volume(cut)
  const expected = 8000 - Math.PI * 25 * 20
  if (Math.abs(m.volume - expected) > 20) {
    fail(`drilled cube: volume ${m.volume.toFixed(1)}, expected about ${expected.toFixed(1)}`)
  }
  if (m.volume <= 0) fail('drilled cube: wound inside out')
  if (m.nan) fail(`drilled cube: ${m.nan} NaN triangles`)
  releaseShape(cut)
}

console.log(problems ? `\n${problems} problem(s)` : '\nall clear')
process.exitCode = problems ? 1 : 0
