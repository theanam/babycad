/**
 * Variables check:  `node tools/check-variables.mjs`
 *
 * A variable may hold a sum instead of a number, and the sum may name other
 * variables. That turns a list into a graph, and the thing a graph can do that
 * a list cannot is eat itself: `a = b * 2`, then `b = a * 2`, each waiting on
 * the other for ever.
 *
 * It is guarded twice, and this checks both halves:
 *
 *   refused on the way in     a sum that would close a loop is not stored, and
 *                             the person is told while looking at what they
 *                             typed. Short loops and long ones alike.
 *   survived if one appears   fed a loop directly — a hand-edited file, or a
 *                             bug — nothing hangs and nothing recurses: the
 *                             variables in the loop keep their last number and
 *                             are marked broken.
 *
 * And the ordinary business either side of it: sums follow what they are built
 * from, renames travel into them, and deleting a variable something was built
 * on freezes that thing rather than moving it.
 */
import { register } from 'node:module'

register('./resolve-extensionless.mjs', import.meta.url)

const { useScene } = await import('../src/scene/sceneStore.js')
const { recompute, wouldCycle } = await import('../src/scene/variables.js')

let problems = 0
const fail = (message) => {
  console.log(`  BAD ${message}`)
  problems++
}
const ok = (message) => console.log(`  ok  ${message}`)

const reset = (variables = []) =>
  useScene.setState({ objects: [], groups: [], variables, selectedIds: [], past: [], future: [] })
const store = () => useScene.getState()
const byName = (name) => store().variables.find((v) => v.name === name)

/* ----------------------------------------------- sums that do their job -- */

console.log('\na sum follows what it is built from…')
{
  reset()
  const wall = store().addVariable('wall', 'number', 4)
  const twice = store().addVariable('twice', 'number', 1)
  const why = store().setVariableFormula(twice.id, 'wall * 2')
  if (why) fail(`"wall * 2" was refused — ${why}`)
  else if (byName('twice')?.value !== 8) fail(`twice came out ${byName('twice')?.value}, expected 8`)
  else ok('twice = wall * 2 is 8 when wall is 4')

  store().setVariableValue(wall.id, 10)
  if (byName('twice')?.value !== 20) fail(`after wall became 10, twice is ${byName('twice')?.value}, expected 20`)
  else ok('and 20 when wall becomes 10')

  // A chain, so the ordering has to do some work.
  const third = store().addVariable('third', 'number', 1)
  store().setVariableFormula(third.id, 'twice + wall')
  if (byName('third')?.value !== 30) fail(`third is ${byName('third')?.value}, expected 30`)
  else ok('a sum built on a sum settles in the right order')

  store().setVariableValue(wall.id, 1)
  if (byName('twice')?.value !== 2 || byName('third')?.value !== 3) {
    fail(`the chain did not follow: twice ${byName('twice')?.value}, third ${byName('third')?.value}`)
  } else ok('the whole chain follows a change at the bottom of it')
}

/* ------------------------------------------------------------- loops -- */

console.log('\nand a loop is refused before it can be made…')
{
  reset()
  const a = store().addVariable('a', 'number', 2)
  const b = store().addVariable('b', 'number', 3)
  store().setVariableFormula(a.id, 'b * 2')

  // The reported case, exactly.
  const why = store().setVariableFormula(b.id, 'a * 2')
  if (!why) fail('b = a * 2 was accepted, closing a loop with a = b * 2')
  else ok(`the second half of a two-step loop is refused — "${why}"`)
  if (byName('b')?.formula) fail('the refused sum was stored anyway')
  if (byName('a')?.value !== 6) fail(`a is ${byName('a')?.value}, expected to be untouched at 6`)
  else ok('and the variable it was refused on is left exactly as it was')

  // Straight at itself.
  const self = store().setVariableFormula(a.id, 'a + 1')
  if (!self) fail('a = a + 1 was accepted')
  else ok('a sum naming itself is refused')

  // The long way round: c -> d -> e -> c.
  reset()
  const c = store().addVariable('c', 'number', 1)
  const d = store().addVariable('d', 'number', 1)
  const e = store().addVariable('e', 'number', 1)
  store().setVariableFormula(d.id, 'c * 2')
  store().setVariableFormula(e.id, 'd * 2')
  const round = store().setVariableFormula(c.id, 'e + 1')
  if (!round) fail('a three-step loop was accepted')
  else ok('a loop three variables long is refused too')
}

console.log('\nand a loop that somehow got in does not hang or recurse…')
{
  // Straight into the state, the way a hand-edited file would arrive.
  const looped = [
    { id: 'a', name: 'a', kind: 'number', value: 7, formula: 'b * 2' },
    { id: 'b', name: 'b', kind: 'number', value: 9, formula: 'a * 2' },
    { id: 'c', name: 'c', kind: 'number', value: 5 },
    { id: 'd', name: 'd', kind: 'number', value: 1, formula: 'c * 3' },
  ]
  const started = Date.now()
  const settled = recompute(looped)
  const took = Date.now() - started
  if (took > 1000) fail(`recompute took ${took} ms on a loop — it should not be searching`)
  const a = settled.find((v) => v.id === 'a')
  const b = settled.find((v) => v.id === 'b')
  const d = settled.find((v) => v.id === 'd')
  if (!a.broken || !b.broken) fail('the two in the loop were not marked broken')
  else if (a.value !== 7 || b.value !== 9) fail('the two in the loop lost the numbers they had')
  else ok('the pair in the loop keep their last numbers and are marked broken')
  if (d.broken || d.value !== 15) fail(`a variable outside the loop was affected — ${d.value}, broken ${d.broken}`)
  else ok('and everything outside the loop is worked out as normal')
  if (!wouldCycle(looped, 'a', 'b * 2')) fail('wouldCycle did not see the loop it was handed')
}

/* ------------------------------------------------- renaming and deleting -- */

console.log('\nrenaming and deleting leave the sums standing…')
{
  reset()
  const wall = store().addVariable('wall', 'number', 4)
  const twice = store().addVariable('twice', 'number', 1)
  store().setVariableFormula(twice.id, 'wall * 2')

  store().renameVariable(wall.id, 'side')
  const after = store().variables.find((v) => v.id === twice.id)
  if (after?.formula !== 'side * 2') fail(`the sum reads "${after?.formula}" after the rename`)
  else if (after.value !== 8) fail(`the sum stopped working out — ${after.value}`)
  else ok('a rename travels into the sums that named it')

  store().deleteVariable(wall.id)
  const orphan = store().variables.find((v) => v.id === twice.id)
  if (orphan?.formula) fail(`the sum still reads "${orphan.formula}" with nothing to read`)
  else if (orphan?.value !== 8) fail(`deleting moved it to ${orphan?.value}, expected it to stay at 8`)
  else ok('deleting what a sum was built on freezes it at its last number')
}

console.log(problems ? `\n${problems} problem${problems === 1 ? '' : 's'}` : '\nall clear')
process.exit(problems ? 1 : 0)
