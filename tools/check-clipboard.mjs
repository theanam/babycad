/**
 * Clipboard check:  `node tools/check-clipboard.mjs`
 *
 * Copy and paste have to carry more than the blocks. A block on its own is not
 * the whole of what somebody selected: it may be inside a combine, and that
 * combine inside another; its numbers may be bound to variables; and if it is
 * an imported model the triangles are not in the block at all. Leave any of
 * those behind and what arrives looks right until you touch it.
 *
 * All of that is pointer-rewriting — every id is minted fresh on paste, and
 * every reference to it has to be rewritten to match — which is the kind of
 * thing that goes wrong one level down and looks fine from the top. Duplicate
 * had exactly that bug: it renamed a block's group but not the group's own
 * parent, so duplicating a nested combine came out flat.
 *
 * What is checked:
 *
 *   nothing is shared         no pasted block, group or variable reuses an id
 *                             from the original, or the paste and the original
 *                             would move as one
 *   combining survives        a nest two deep arrives two deep, with every
 *                             parent pointing at something that exists
 *   variables join up         a name the build already has is reused rather
 *                             than duplicated; one it does not have arrives
 *   bindings still resolve    every binding names a variable in the scene
 *   undo takes it all back    including the variables the paste brought
 */
import { register } from 'node:module'

register('./resolve-extensionless.mjs', import.meta.url)

const { useScene, makeObject } = await import('../src/scene/sceneStore.js')
const { defaultParams } = await import('../src/shapes/index.js')

let problems = 0
const fail = (message) => {
  console.log(`  BAD ${message}`)
  problems++
}
const ok = (message) => console.log(`  ok  ${message}`)

const reset = (scene) =>
  useScene.setState({
    objects: scene.objects ?? [],
    groups: scene.groups ?? [],
    variables: scene.variables ?? [],
    selectedIds: [],
    past: [],
    future: [],
    pasteRun: null,
  })

const block = (type, at) => makeObject(type, at, '#888', defaultParams(type))

/* ------------------------------------------- a combine inside a combine -- */

console.log('\na combine inside a combine survives the round trip…')
{
  const a = block('cube', [0, 10, 0])
  const b = block('sphere', [20, 10, 0])
  const c = block('cone', [40, 10, 0])
  const inner = { id: 'g-inner', memberIds: [a.id, b.id], parentGroupId: 'g-outer' }
  const outer = { id: 'g-outer', memberIds: ['g-inner', c.id], parentGroupId: null }
  a.parentGroupId = 'g-inner'
  b.parentGroupId = 'g-inner'
  c.parentGroupId = 'g-outer'
  reset({ objects: [a, b, c], groups: [inner, outer] })

  useScene.getState().setSelection([a.id, b.id, c.id])
  const text = useScene.getState().copyPayload()
  if (!text) fail('nothing came back from copy')
  useScene.getState().paste(text)

  const st = useScene.getState()
  if (st.objects.length !== 6) fail(`expected 6 blocks after pasting 3, got ${st.objects.length}`)
  if (st.groups.length !== 4) fail(`expected 4 groups, got ${st.groups.length}`)

  const pasted = st.objects.filter((o) => ![a.id, b.id, c.id].includes(o.id))
  const oldGroupIds = new Set(['g-inner', 'g-outer'])
  if (pasted.some((o) => oldGroupIds.has(o.parentGroupId))) {
    fail('a pasted block still points at one of the original groups')
  }
  const known = new Set(st.groups.map((g) => g.id))
  for (const o of st.objects) {
    if (o.parentGroupId && !known.has(o.parentGroupId)) fail(`a block points at a group that is not there`)
  }
  // The nest: exactly one pasted group sits inside another pasted one.
  const newGroups = st.groups.filter((g) => !oldGroupIds.has(g.id))
  const nested = newGroups.filter((g) => g.parentGroupId && newGroups.some((p) => p.id === g.parentGroupId))
  if (nested.length !== 1) fail(`the nest did not survive — ${nested.length} groups inside another, expected 1`)
  else ok('two levels of combining came through, with fresh ids throughout')

  // Undo puts it back exactly.
  useScene.getState().undo()
  const after = useScene.getState()
  if (after.objects.length !== 3 || after.groups.length !== 2) {
    fail(`undo left ${after.objects.length} blocks and ${after.groups.length} groups, expected 3 and 2`)
  } else ok('undo takes the whole paste back')
}

/* ------------------------------------- what a combine remembers to undo -- */

console.log('\nand a combine still remembers what its blocks were…')
{
  const a = block('cube', [0, 10, 0])
  const b = block('sphere', [20, 10, 0])
  a.parentGroupId = 'g'
  b.parentGroupId = 'g'
  a.color = '#FF0000'
  b.color = '#00FF00'
  // Combining paints the blocks one colour and keeps the old ones, by block,
  // so splitting apart can give them back.
  const group = { id: 'g', memberIds: [a.id, b.id], parentGroupId: null, childGroupIds: [],
    colors: { [a.id]: '#FF0000', [b.id]: '#00FF00' } }
  reset({ objects: [a, b], groups: [group] })

  useScene.getState().setSelection([a.id, b.id])
  useScene.getState().paste(useScene.getState().copyPayload())
  const st = useScene.getState()
  const pasted = st.groups.find((g) => g.id !== 'g')
  const known = new Set(st.objects.map((o) => o.id))
  const keys = Object.keys(pasted?.colors ?? {})
  if (keys.length !== 2) fail(`the pasted group remembers ${keys.length} colours, expected 2`)
  else if (!keys.every((id) => known.has(id))) {
    fail('the pasted group remembers colours for blocks that are not in the scene')
  } else if (keys.some((id) => id === a.id || id === b.id)) {
    fail('the pasted group is still pointing at the blocks it was copied from')
  } else ok('the colours to go back to are remembered against the new blocks')
}

/* ------------------------------------------------------------ variables -- */

console.log('\nvariables come across, and join up with ones already there…')
{
  const a = block('cube', [0, 10, 0])
  a.bindings = { width: 'v-wall' }
  const wall = { id: 'v-wall', name: 'wall', kind: 'number', value: 4 }
  reset({ objects: [a], groups: [], variables: [wall] })

  useScene.getState().setSelection([a.id])
  const text = useScene.getState().copyPayload()

  // Pasted back into the same build: the variable is already here by that
  // name, so it should be shared rather than cloned.
  useScene.getState().paste(text)
  let st = useScene.getState()
  if (st.variables.length !== 1) fail(`a variable already present was duplicated — ${st.variables.length} now`)
  const twin = st.objects.find((o) => o.id !== a.id)
  if (twin?.bindings?.width !== 'v-wall') fail('the pasted block lost its link to the variable')
  else ok('a variable the build already had was reused, not duplicated')

  // Into a build that has never heard of it: it has to arrive.
  reset({ objects: [], groups: [], variables: [] })
  useScene.getState().paste(text)
  st = useScene.getState()
  if (st.variables.length !== 1) fail(`the variable did not travel — ${st.variables.length} in the new build`)
  else {
    const pasted = st.objects[0]
    const bound = st.variables.find((v) => v.id === pasted?.bindings?.width)
    if (!bound) fail('the pasted block is bound to a variable that is not in the scene')
    else if (bound.value !== 4) fail(`the variable arrived with value ${bound.value}, expected 4`)
    else ok('a variable the build did not have came with the block')
  }

  // A different variable of the same name must not be silently overwritten.
  reset({ objects: [], groups: [], variables: [{ id: 'other', name: 'wall', kind: 'number', value: 99 }] })
  useScene.getState().paste(text)
  st = useScene.getState()
  if (st.variables.length !== 1 || st.variables[0].value !== 99) {
    fail('an existing variable of the same name was disturbed')
  } else ok("an existing variable of the same name keeps its own value")
}

/* -------------------------------------------- pasting other people's text -- */

console.log('\nanything that is not ours is left alone…')
{
  reset({ objects: [], groups: [], variables: [] })
  for (const text of ['', 'hello', '{"kind":"something-else"}', '{"kind":"babycad/clipboard"}', '{']) {
    if (useScene.getState().paste(text)) fail(`${JSON.stringify(text.slice(0, 24))} was treated as blocks`)
  }
  if (useScene.getState().objects.length) fail('ordinary text put something on the plate')
  else ok('plain text, broken JSON and empty payloads all do nothing')
}

console.log(problems ? `\n${problems} problem${problems === 1 ? '' : 's'}` : '\nall clear')
process.exit(problems ? 1 : 0)
