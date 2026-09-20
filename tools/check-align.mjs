/**
 * Alignment check:  `node tools/check-align.mjs`
 *
 * Aligning reads its bounds off the live meshes, so this stands in fake ones —
 * an object is only ever asked for its `geometry.boundingBox` and its world
 * matrix — and checks the arithmetic underneath: that every unit really does
 * end up on the chosen edge, that a combined group moves as one piece rather
 * than collapsing onto itself, and that lining up something already lined up
 * asks for no movement at all.
 */
import { register } from 'node:module'

register('./resolve-extensionless.mjs', import.meta.url)

const THREE = await import('three')
const { alignOffsets } = await import('../src/scene/align.js')

let problems = 0
const fail = (message) => {
  console.log(`  BAD ${message}`)
  problems++
}

/**
 * A stand-in for a mesh: a box of `size`, centred at `position`. `visible`
 * matters — a combined hole is a real mesh that simply isn't drawn, and
 * alignment has to ignore it, so the stand-in carries the flag a THREE.Mesh
 * always has rather than leaving it undefined.
 */
function fakeMesh(position, size = [10, 10, 10], visible = true) {
  const geometry = {
    boundingBox: new THREE.Box3(
      new THREE.Vector3(-size[0] / 2, -size[1] / 2, -size[2] / 2),
      new THREE.Vector3(size[0] / 2, size[1] / 2, size[2] / 2)
    ),
  }
  const matrixWorld = new THREE.Matrix4().makeTranslation(...position)
  return { geometry, matrixWorld, visible, updateMatrixWorld() {} }
}

function scene(spec) {
  const objects = []
  const meshes = new Map()
  for (const [id, position, size, parentGroupId, visible] of spec) {
    objects.push({ id, parentGroupId: parentGroupId ?? null, position })
    meshes.set(id, fakeMesh(position, size, visible !== false))
  }
  return { objects, meshes }
}

/** Where each unit's chosen edge lands once the offsets are applied. */
const edgesAfter = (objects, meshes, slot, mode, offsets) =>
  objects.map((o) => {
    const box = new THREE.Box3()
      .copy(meshes.get(o.id).geometry.boundingBox)
      .applyMatrix4(meshes.get(o.id).matrixWorld)
    const axis = ['x', 'y', 'z'][slot]
    const shifted = { min: box.min[axis], max: box.max[axis] }
    const d = offsets.get(o.id) ?? 0
    const lo = shifted.min + d
    const hi = shifted.max + d
    return mode === 'min' ? lo : mode === 'max' ? hi : (lo + hi) / 2
  })

console.log('three blocks come to the same edge on every axis and mode…')
{
  const { objects, meshes } = scene([
    ['a', [0, 5, 0], [10, 10, 10]],
    ['b', [40, 15, 20], [30, 30, 10]],
    ['c', [-25, 2, -30], [4, 4, 40]],
  ])
  for (const slot of [0, 1, 2]) {
    for (const mode of ['min', 'center', 'max']) {
      const offsets = alignOffsets(objects, meshes, slot, mode)
      const edges = edgesAfter(objects, meshes, slot, mode, offsets)
      const spread = Math.max(...edges) - Math.min(...edges)
      if (spread > 1e-6) {
        fail(`axis ${slot} ${mode}: edges still ${spread.toFixed(4)} apart — ${edges.map((e) => e.toFixed(2))}`)
      }
    }
  }
}

console.log('\na combined group travels as one piece…')
{
  const { objects, meshes } = scene([
    ['g1', [0, 5, 0], [10, 10, 10], 'group'],
    ['g2', [30, 5, 0], [10, 10, 10], 'group'],
    ['loose', [-60, 5, 0], [10, 10, 10]],
  ])
  const offsets = alignOffsets(objects, meshes, 0, 'min')
  if (offsets.get('g1') !== offsets.get('g2')) {
    fail(`the group split apart: g1 moved ${offsets.get('g1')}, g2 moved ${offsets.get('g2')}`)
  }
  // The group's left edge is at -5, the loose block's at -65, so the group is
  // the one that has to travel.
  if (Math.abs((offsets.get('g1') ?? 0) - -60) > 1e-6) {
    fail(`the group moved ${offsets.get('g1')}, expected -60`)
  }
  if (offsets.has('loose')) fail('the leftmost block moved, and it was already on the edge')
}

console.log('\nnothing to do is nothing to record…')
{
  const { objects, meshes } = scene([
    ['a', [0, 5, 0], [10, 10, 10]],
    ['b', [0, 5, 40], [10, 10, 10]],
  ])
  // Already sharing an x centre, so centring on x asks for no movement.
  if (alignOffsets(objects, meshes, 0, 'center').size) fail('centring an already-centred pair moved something')
  // One unit can't be aligned against itself.
  const one = scene([['a', [0, 5, 0], [10, 10, 10]]])
  if (alignOffsets(one.objects, one.meshes, 0, 'min').size) fail('a single block produced offsets')
  // Nor can one group, however many blocks are in it.
  const grouped = scene([
    ['a', [0, 5, 0], [10, 10, 10], 'g'],
    ['b', [50, 5, 0], [10, 10, 10], 'g'],
  ])
  if (alignOffsets(grouped.objects, grouped.meshes, 0, 'min').size) {
    fail('one group aligned against itself')
  }
}

console.log('\nsomething that isn’t drawn doesn’t drag the edge out…')
{
  // The middle block is a combined hole: present, invisible, and reaching well
  // past the other two. It must not be what the others line up against.
  const { objects, meshes } = scene([
    ['a', [0, 5, 0], [10, 10, 10]],
    ['ghost', [-200, 5, 0], [10, 10, 10], null, false],
    ['b', [40, 5, 0], [10, 10, 10]],
  ])
  const offsets = alignOffsets(objects, meshes, 0, 'min')
  if (offsets.has('ghost')) fail('an invisible block was moved by an align')
  // a's left edge is -5 and b's is 35, so a is the target and only b travels.
  if (Math.abs((offsets.get('b') ?? 0) - -40) > 1e-6) {
    fail(`b moved ${offsets.get('b')}, expected -40 — an invisible block set the edge`)
  }
}

console.log(problems ? `\n${problems} problem(s)` : '\nall clear')
process.exitCode = problems ? 1 : 0
