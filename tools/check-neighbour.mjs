/**
 * Neighbour check:  `node tools/check-neighbour.mjs`
 *
 * The clearance shown while a block is being moved: how much room is left
 * between it and the nearest thing it is not, which way to push it to make
 * that room bigger, and the two points the line is drawn between.
 *
 * All three have to agree with each other. The number is what you read, the
 * line is what tells you which block it is about, and the direction is what
 * the number does when you type into it — so a direction that disagreed with
 * the line would move the block somewhere other than where the drawing said,
 * and a line that disagreed with the number would measure something you were
 * not being told about.
 *
 * Boxes, not surfaces: `scene/neighbour` explains why.
 */
import { register } from 'node:module'

register('./resolve-extensionless.mjs', import.meta.url)

const THREE = await import('three')
const { nearestNeighbour } = await import('../src/scene/neighbour.js')

let problems = 0
const fail = (message) => {
  console.log(`  BAD ${message}`)
  problems++
}

const block = (position, size = [20, 20, 20], visible = true) => {
  const geometry = new THREE.BoxGeometry(...size)
  geometry.computeBoundingBox()
  const mesh = new THREE.Mesh(geometry)
  mesh.position.set(...position)
  mesh.updateMatrixWorld()
  mesh.visible = visible
  return mesh
}

const scene = (spec) => {
  const objects = []
  const meshes = new Map()
  for (const [id, type, position, size, visible] of spec) {
    objects.push({ id, type })
    meshes.set(id, block(position, size, visible))
  }
  return { objects, meshes }
}

/** Every reading has to hang together, whatever the arrangement. */
const consistent = (label, near) => {
  if (!near) return fail(`${label}: nothing came back`)
  const length = Math.hypot(
    near.to[0] - near.from[0],
    near.to[1] - near.from[1],
    near.to[2] - near.from[2]
  )
  if (Math.abs(length - near.gap) > 1e-6) {
    fail(`${label}: the line is ${length.toFixed(3)} long but the number says ${near.gap.toFixed(3)}`)
  }
  const size = Math.hypot(...near.direction)
  if (near.gap > 1e-9 && Math.abs(size - 1) > 1e-6) {
    fail(`${label}: the way out is not a unit vector (${size.toFixed(3)})`)
  }
  // Pushing along the direction has to open the gap, not close it.
  const toward = near.direction.reduce((s, d, i) => s + d * (near.to[i] - near.from[i]), 0)
  if (near.gap > 1e-9 && toward > -1e-9) {
    fail(`${label}: the way out points at the neighbour rather than away from it`)
  }
}

console.log('\nthe clearance, the line and the way out all agree…')
for (const [label, spec, expected] of [
  ['side by side', [['a', 'cube', [0, 10, 0]], ['b', 'cube', [30, 10, 0]]], 10],
  ['just touching', [['a', 'cube', [0, 10, 0]], ['b', 'cube', [20, 10, 0]]], 0],
  ['overlapping', [['a', 'cube', [0, 10, 0]], ['b', 'cube', [10, 10, 0]]], 0],
  ['one above the other', [['a', 'cube', [0, 10, 0]], ['b', 'cube', [0, 45, 0]]], 15],
  ['diagonally apart', [['a', 'cube', [0, 10, 0]], ['b', 'cube', [30, 10, 30]]], Math.hypot(10, 10)],
  ['a long way off', [['a', 'cube', [0, 10, 0]], ['b', 'cube', [500, 10, 0]]], 480],
]) {
  const s = scene(spec)
  const near = nearestNeighbour(['a'], s.objects, s.meshes)
  consistent(label, near)
  if (near && Math.abs(near.gap - expected) > 1e-6) {
    fail(`${label}: ${near.gap.toFixed(3)} mm, expected ${expected.toFixed(3)}`)
  } else if (near) console.log(`  ok  ${label} — ${near.gap.toFixed(1)} mm`)
}

console.log('\nand it picks the right neighbour…')
{
  const s = scene([
    ['a', 'cube', [0, 10, 0]],
    ['far', 'cube', [200, 10, 0]],
    ['near', 'sphere', [60, 10, 0]],
  ])
  const near = nearestNeighbour(['a'], s.objects, s.meshes)
  if (near?.id !== 'near') fail(`the nearer block was not chosen — got ${near?.id}`)
  else if (near.type !== 'sphere') fail('the neighbour came back under the wrong name')
  else console.log('  ok  the nearer of two, named correctly')

  // A combined hole is a real mesh that simply is not drawn, and a gap to
  // something nobody can see is a gap to nothing.
  const hidden = scene([
    ['a', 'cube', [0, 10, 0]],
    ['ghost', 'cube', [25, 10, 0], [20, 20, 20], false],
    ['real', 'cube', [80, 10, 0]],
  ])
  const past = nearestNeighbour(['a'], hidden.objects, hidden.meshes)
  if (past?.id !== 'real') fail(`measured to a block nobody can see — got ${past?.id}`)
  else console.log('  ok  a block that is not drawn is not measured to')

  // Several moved at once are one box, so the gap is to the outside of them.
  const many = scene([
    ['a', 'cube', [0, 10, 0]],
    ['b', 'cube', [30, 10, 0]],
    ['c', 'cube', [70, 10, 0]],
  ])
  const pair = nearestNeighbour(['a', 'b'], many.objects, many.meshes)
  if (!pair || Math.abs(pair.gap - 20) > 1e-6) {
    fail(`two moved together measured ${pair?.gap?.toFixed(3)}, expected 20`)
  } else console.log('  ok  several moved together are measured as one')

  // Nothing else on the plate is not an error, it is just nothing to say.
  const alone = scene([['a', 'cube', [0, 10, 0]]])
  if (nearestNeighbour(['a'], alone.objects, alone.meshes)) {
    fail('a block alone on the plate was given a neighbour')
  } else console.log('  ok  a block on its own reports nothing')
}

console.log(problems ? `\n${problems} problem${problems === 1 ? '' : 's'}` : '\nall clear')
process.exit(problems ? 1 : 0)
