/**
 * Reseat check:  `node tools/check-reseat.mjs`
 *
 * Changing a shape's numbers in the rail must not move its underside: a block
 * that was resting on the plate is still resting on the plate afterwards,
 * whatever was typed and whichever way the block is turned. This drives the
 * real store — the same `setParams` the rail calls — and reads the position
 * it lands on.
 */
import { register } from 'node:module'

register('./resolve-extensionless.mjs', import.meta.url)

const { useScene } = await import('../src/scene/sceneStore.js')
const { measure } = await import('../src/shapes/geometryCache.js')
const THREE = await import('three')

let problems = 0
const fail = (m) => { console.log(`  BAD ${m}`); problems++ }

/** World-space underside of a block, from its own geometry, rotation and scale. */
function underside(o) {
  const { min, max } = measure(o.type, o.params)
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler().fromArray(o.rotation))
  let low = Infinity
  for (const x of [min.x, max.x]) for (const y of [min.y, max.y]) for (const z of [min.z, max.z]) {
    const v = new THREE.Vector3(x * o.scale[0], y * o.scale[1], z * o.scale[2]).applyQuaternion(q)
    low = Math.min(low, v.y)
  }
  return o.position[1] + low
}
const one = () => useScene.getState().objects[0]
const reset = () => useScene.setState({ objects: [], groups: [], variables: [], selectedIds: [], past: [], future: [] })

const cases = [
  ['upright tube, height 20 -> 40', 'cylinder', null, { height: 40 }],
  ['upright tube, height 20 -> 8', 'cylinder', null, { height: 8 }],
  ['tube on its side, radius 10 -> 20', 'cylinder', [Math.PI / 2, 0, 0], { bottomRadius: 20, topRadius: 20 }],
  ['ball, radius 10 -> 25', 'sphere', null, { radius: 25 }],
  ['cube tipped 45°, height 20 -> 40', 'cube', [Math.PI / 4, 0, 0], { height: 40 }],
  ['cone, height 20 -> 60', 'cone', null, { height: 60 }],
]
console.log('the underside stays put when a number changes…')
for (const [name, type, rotation, patch] of cases) {
  reset()
  const st = useScene.getState()
  const o = st.addShape(type, [0, 0, 0])
  if (rotation) {
    st.transformSelection((b) => ({ position: b.position, rotation, scale: b.scale }), 'turn')
  }
  // A turned block is re-seated on the floor first, the way the app leaves
  // a block after a turn is not our concern here; what matters is that the
  // change below does not move wherever the underside already is.
  const before = underside(one())
  useScene.getState().setParams({ [o.id]: patch })
  const after = underside(one())
  const ok = Math.abs(after - before) < 1e-6
  console.log(`  ${ok ? 'ok ' : 'BAD'} ${name.padEnd(36)} underside ${before.toFixed(3)} -> ${after.toFixed(3)}`)
  if (!ok) problems++
  // and undo puts both the shape and the position back
  useScene.getState().undo()
  if (Math.abs(underside(one()) - before) > 1e-6 || one().params[Object.keys(patch)[0]] === patch[Object.keys(patch)[0]]) {
    fail(`${name}: undo did not restore shape and position`)
  }
}
console.log(problems ? `\n${problems} problem(s)` : '\nall clear')
process.exitCode = problems ? 1 : 0
