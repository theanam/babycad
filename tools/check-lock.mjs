/**
 * Lock check:  `node tools/check-lock.mjs`
 *
 * A locked block is held where it is. It can still be picked, looked at and
 * measured against — the point of locking something is usually so that other
 * things can be brought to it — but nothing moves, turns, resizes or flips it.
 *
 * The interesting case is aligning. Normally the edge everything meets at
 * comes from the selection as a whole; lock one block and you have said which
 * one is right, so the edge comes from the locked blocks alone and only the
 * free ones travel. That is what locking is for, and it is what this mostly
 * checks.
 *
 * Bounds come off the live meshes in the viewport, which do not exist outside
 * a browser, so stand-ins go into the same registry.
 */
import { register } from 'node:module'

register('./resolve-extensionless.mjs', import.meta.url)

const THREE = await import('three')
const { useScene, makeObject } = await import('../src/scene/sceneStore.js')
const { alignOffsets } = await import('../src/scene/align.js')
const { meshes } = await import('../src/scene/meshRegistry.js')
const { defaultParams } = await import('../src/shapes/index.js')

let problems = 0
const fail = (message) => {
  console.log(`  BAD ${message}`)
  problems++
}
const ok = (message) => console.log(`  ok  ${message}`)

const fakeMesh = (position, size = 20) => ({
  geometry: {
    boundingBox: new THREE.Box3(
      new THREE.Vector3(-size / 2, -size / 2, -size / 2),
      new THREE.Vector3(size / 2, size / 2, size / 2)
    ),
  },
  matrixWorld: new THREE.Matrix4().makeTranslation(...position),
  visible: true,
  updateMatrixWorld() {},
})
const sync = () => {
  meshes.clear()
  for (const o of useScene.getState().objects) meshes.set(o.id, fakeMesh(o.position))
}
const block = (at, locked = false) => {
  const o = makeObject('cube', at, '#888', defaultParams('cube'))
  o.locked = locked
  return o
}
const put = (objects) => {
  useScene.setState({ objects, groups: [], variables: [], selectedIds: objects.map((o) => o.id), past: [], future: [] })
  sync()
}
const store = () => useScene.getState()
const at = (id) => store().objects.find((o) => o.id === id)

/* -------------------------------------------------- aligning to a lock -- */

console.log('\nthe free blocks come to the locked one, not the other way…')
{
  const held = block([0, 10, 0], true)
  const free = block([40, 10, 0])
  put([held, free])
  // Slot 0 is x; 'min' brings the left sides together.
  const offsets = alignOffsets(store().objects, meshes, 0, 'min')
  if (offsets.has(held.id)) fail('the locked block was given somewhere to go')
  if (offsets.get(free.id) !== -40) fail(`the free block was told to move ${offsets.get(free.id)}, expected -40`)
  else ok('only the free block moves, and it moves to the locked one')

  store().alignSelection(0, 'min')
  if (at(held.id).position[0] !== 0) fail(`the locked block moved to ${at(held.id).position[0]}`)
  else if (at(free.id).position[0] !== 0) fail(`the free block landed at ${at(free.id).position[0]}, expected 0`)
  else ok('and after aligning, the locked one is exactly where it was')
}

console.log('\nwith nothing locked, aligning behaves as it always did…')
{
  const a = block([0, 10, 0])
  const b = block([40, 10, 0])
  put([a, b])
  store().alignSelection(0, 'min')
  // Both to the leftmost edge, which is a's.
  if (at(a.id).position[0] !== 0 || at(b.id).position[0] !== 0) {
    fail(`ended at ${at(a.id).position[0]} and ${at(b.id).position[0]}, expected both at 0`)
  } else ok('both travel to the outermost edge of the pair')
}

console.log('\nand everything locked means nothing moves…')
{
  const a = block([0, 10, 0], true)
  const b = block([40, 10, 0], true)
  put([a, b])
  store().alignSelection(0, 'min')
  if (at(a.id).position[0] !== 0 || at(b.id).position[0] !== 40) fail('a locked pair was moved')
  else ok('a selection that is entirely locked is left alone')
}

/* ------------------------------------------------- the other transforms -- */

console.log('\nnothing else shifts a locked block either…')
{
  const held = block([12, 10, -6], true)
  put([held])
  const was = [...held.position]

  if (store().mirrorSelection(0)) fail('mirror flipped a locked block')
  else if (at(held.id).position.some((n, i) => n !== was[i])) fail('mirror moved it anyway')
  else ok('flipping is refused')

  if (store().movableSelection().length) fail('a locked block was reported as free to move')
  else ok('and it is not offered up as something that can be moved')

  // Mixed: the free one is movable, the locked one is not.
  const free = block([50, 10, 0])
  put([held, free])
  const movable = store().movableSelection().map((o) => o.id)
  if (movable.length !== 1 || movable[0] !== free.id) {
    fail(`a mixed selection offered ${movable.length} blocks to move`)
  } else ok('in a mixed selection only the free one is offered')
  if (store().mirrorSelection(0)) fail('mirror flipped a mixed selection')
  else ok('and flipping a mixed selection is refused rather than done by halves')
}

/* ------------------------------------------------------ locking itself -- */

console.log('\nlocking and unlocking are one undoable step…')
{
  const a = block([0, 10, 0])
  const b = block([40, 10, 0])
  put([a, b])
  store().setLocked(true)
  if (!at(a.id).locked || !at(b.id).locked) fail('locking the selection missed one')
  else ok('locking takes the whole selection')
  store().undo()
  if (at(a.id).locked || at(b.id).locked) fail('undo did not unlock them')
  else ok('and undo gives it back')
}

console.log(problems ? `\n${problems} problem${problems === 1 ? '' : 's'}` : '\nall clear')
process.exit(problems ? 1 : 0)
