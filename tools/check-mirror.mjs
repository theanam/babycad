/**
 * Mirror check:  `node tools/check-mirror.mjs`
 *
 * Flipping the selection over is done as a matrix — the block's transform is
 * built, reflected about the plane across the middle of the selection, and
 * taken apart again — because a reflection does not commute with a turn.
 * Negating the stored numbers would be simpler and would be wrong for anything
 * sitting at an angle.
 *
 * What is checked:
 *
 *   it undoes itself          flipping twice leaves every block exactly where
 *                             it started, whatever angle it was at
 *   one block stays put       a lone block flips about its own middle, so its
 *                             box does not move — only its handedness changes
 *   a pair swaps sides        with more than one picked, the whole selection
 *                             reflects, so the leftmost becomes the rightmost
 *   turns reflect properly    the result matches the reflection worked out
 *                             from the matrices directly
 *   a mode ends with its work  Align and Mirror replace the box handles for
 *                             whatever is picked, and a flag left standing
 *                             after the blocks are gone lies in wait for the
 *                             next thing selected
 *   it exports right way out  a reflection turns space inside out, so the
 *                             triangles of a mirrored part have to be wound
 *                             back the other way or a slicer reads the whole
 *                             model as a hole
 *
 * Mirroring measures the selection off the live meshes in the viewport, which
 * do not exist outside a browser, so stand-ins go into the same registry — a
 * box of a known size around each block. Without them the bounds come back
 * empty and mirroring quietly does nothing, which is exactly how this file
 * read the first time it was run: three tests failed and the fourth passed for
 * the worst possible reason, because a flip that does nothing does nothing
 * twice as well.
 */
import { register } from 'node:module'

register('./resolve-extensionless.mjs', import.meta.url)

const THREE = await import('three')
const { useScene, makeObject } = await import('../src/scene/sceneStore.js')
const { buildGeometry } = await import('../src/shapes/geometryCache.js')
const { defaultParams } = await import('../src/shapes/index.js')
const { reverseWinding } = await import('../src/io/exporters.js')
const { meshes } = await import('../src/scene/meshRegistry.js')

let problems = 0
const fail = (message) => {
  console.log(`  BAD ${message}`)
  problems++
}
const ok = (message) => console.log(`  ok  ${message}`)
const close = (a, b, tol = 1e-6) => a.every((v, i) => Math.abs(v - b[i]) <= tol)

const block = (type, at, rotation = [0, 0, 0]) => {
  const o = makeObject(type, at, '#888', defaultParams(type))
  o.rotation = rotation
  return o
}
/** A stand-in for a drawn mesh: a 20 mm box centred on the block. */
const fakeMesh = (position) => ({
  geometry: {
    boundingBox: new THREE.Box3(new THREE.Vector3(-10, -10, -10), new THREE.Vector3(10, 10, 10)),
  },
  matrixWorld: new THREE.Matrix4().makeTranslation(...position),
  visible: true,
  updateMatrixWorld() {},
})

/** Point the registry at where the blocks are now. */
const sync = () => {
  meshes.clear()
  for (const o of useScene.getState().objects) meshes.set(o.id, fakeMesh(o.position))
}

const put = (objects) => {
  useScene.setState({ objects, groups: [], variables: [], selectedIds: objects.map((o) => o.id), past: [], future: [] })
  sync()
}

/** Flip, having first told the registry where everything is. */
const flip = (slot) => {
  sync()
  if (!useScene.getState().mirrorSelection(slot)) fail(`mirroring on axis ${slot} did nothing at all`)
  sync()
}

/* --------------------------------------------------------- it undoes itself -- */

console.log('\nflipping twice puts everything back…')
for (const rotation of [[0, 0, 0], [0.4, 0, 0], [0.3, -0.8, 1.1]]) {
  const a = block('wedge', [12, 10, -7], rotation)
  const b = block('cone', [-30, 6, 18], [0, 0.5, 0])
  const before = [a, b].map((o) => [...o.position, ...o.rotation, ...o.scale])
  put([a, b])
  for (const slot of [0, 1, 2]) {
    flip(slot)
    flip(slot)
  }
  const after = useScene.getState().objects.map((o) => [...o.position, ...o.rotation, ...o.scale])
  // Angles are compared through their matrices: the same turn has more than
  // one set of Euler angles, and coming back by a different route is fine.
  const asMatrix = (v) =>
    new THREE.Matrix4()
      .compose(
        new THREE.Vector3(v[0], v[1], v[2]),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(v[3], v[4], v[5])),
        new THREE.Vector3(v[6], v[7], v[8])
      )
      .elements.map((n) => Math.round(n * 1e6) / 1e6)
  const same = before.every((v, i) => close(asMatrix(v), asMatrix(after[i]), 1e-4))
  if (!same) fail(`a block turned by ${rotation.join(', ')} did not come back`)
  else ok(`blocks turned by ${rotation.map((r) => r.toFixed(1)).join(', ')} come back exactly`)
}

/* ------------------------------------------------------- one block stays put -- */

console.log('\none block on its own flips where it stands…')
{
  const a = block('wedge', [17, 10, -4])
  put([a])
  flip(0)
  const after = useScene.getState().objects[0]
  if (!close(after.position, a.position, 1e-6)) {
    fail(`a lone block moved from ${a.position} to ${after.position}`)
  } else if (!(after.scale[0] * after.scale[1] * after.scale[2] < 0)) {
    fail('a lone block came back without being reflected at all')
  } else ok('it stays exactly where it was, and is reflected')
}

/* ------------------------------------------------------------ a pair swaps -- */

console.log('\nseveral blocks flip as one, so they swap sides…')
{
  const left = block('cube', [-40, 10, 0])
  const right = block('cube', [20, 10, 0])
  put([left, right])
  flip(0)
  const [l, r] = useScene.getState().objects
  if (Math.abs(l.position[0] - 20) > 1e-6 || Math.abs(r.position[0] + 40) > 1e-6) {
    fail(`sides did not swap — now at ${l.position[0]} and ${r.position[0]}`)
  } else ok('the leftmost became the rightmost, about the middle of the pair')
}

/* ------------------------------------------------------ turns reflect right -- */

console.log('\na block at an angle reflects the way the matrices say…')
{
  const a = block('wedge', [10, 8, 6], [0.3, 0.7, -0.2])
  put([a])
  const slot = 2
  const before = new THREE.Matrix4().compose(
    new THREE.Vector3(...a.position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...a.rotation)),
    new THREE.Vector3(...a.scale)
  )
  flip(slot)
  const o = useScene.getState().objects[0]
  const got = new THREE.Matrix4().compose(
    new THREE.Vector3(...o.position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...o.rotation)),
    new THREE.Vector3(...o.scale)
  )
  // The answer worked out directly: reflect about the plane through the
  // block's own middle, which for one block is where it stands.
  const middle = a.position[slot]
  const want = new THREE.Matrix4()
    .makeScale(1, 1, -1)
    .premultiply(new THREE.Matrix4().makeTranslation(0, 0, 2 * middle))
    .multiply(before)
  if (!close([...got.elements], [...want.elements], 1e-6)) {
    fail('the reflected transform is not the reflection of the original')
  } else ok('position, turn and reflection all land where the matrix says')
}

/* ------------------------------------------------- it exports the right way out -- */

console.log('\na mirrored part is written out wound outward…')
{
  const volumeOf = (geometry, matrix) => {
    const g = geometry.index ? geometry.toNonIndexed() : geometry
    const pos = g.getAttribute('position')
    const v = new THREE.Vector3()
    const at = (i) => v.fromBufferAttribute(pos, i).applyMatrix4(matrix).toArray()
    let total = 0
    for (let t = 0; t < pos.count; t += 3) {
      const [a, b, c] = [at(t), at(t + 1), at(t + 2)]
      total +=
        (a[0] * (b[1] * c[2] - b[2] * c[1]) +
          a[1] * (b[2] * c[0] - b[0] * c[2]) +
          a[2] * (b[0] * c[1] - b[1] * c[0])) / 6
    }
    return total
  }

  for (const type of ['cube', 'wedge', 'cone', 'star']) {
    const geometry = buildGeometry(type, defaultParams(type))
    const upright = new THREE.Matrix4()
    const flipped = new THREE.Matrix4().makeScale(-1, 1, 1)

    const plain = volumeOf(geometry, upright)
    const mirroredAsIs = volumeOf(geometry, flipped)
    const mirroredFixed = volumeOf(reverseWinding(geometry), flipped)

    if (!(plain > 0)) fail(`${type} is not wound outward to begin with`)
    if (!(mirroredAsIs < 0)) {
      fail(`${type}: a reflection was expected to turn it inside out, and did not — the fix may be unnecessary, or the test wrong`)
    }
    if (!(mirroredFixed > 0) || Math.abs(mirroredFixed - plain) > Math.abs(plain) * 1e-6) {
      fail(`${type}: re-winding did not put it right — ${mirroredFixed.toFixed(2)} against ${plain.toFixed(2)}`)
    }
    geometry.dispose()
  }
  if (!problems) ok('cube, wedge, cone and star all come out solid after a flip')
}

/* ------------------------------------------ a mode ends with its work -- */

console.log('\nneither mode outlives the selection it was opened for…')
{
  const store = () => useScene.getState()

  // The reported sequence: a block, Mirror on, delete it, drop a new one.
  put([block('cube', [0, 10, 0])])
  store().toggleMirror()
  if (!store().mirroring) fail('Mirror would not switch on with a block picked')
  store().deleteSelection()
  if (store().mirroring) fail('Mirror was still on with nothing left to mirror')
  store().addShape('ball', [0, 10, 0])
  sync()
  if (store().mirroring) fail('a brand new block arrived wearing flip handles')
  else ok('a new block after a delete comes up in normal mode')

  // Adding to a live selection is a new job too.
  put([block('cube', [0, 10, 0])])
  store().toggleMirror()
  store().addShape('cone', [30, 10, 0])
  sync()
  if (store().mirroring) fail('Mirror stayed on when a block was added beside it')
  else ok('adding a block beside a mirrored one leaves the mode')

  // Aligning needs two, so losing one is enough to end it.
  const a = block('cube', [0, 10, 0])
  const b = block('cube', [30, 10, 0])
  put([a, b])
  store().toggleAlign()
  if (!store().aligning) fail('Align would not switch on with two blocks picked')
  store().setSelection([a.id])
  if (store().aligning) fail('Align was still on with one block picked')
  else ok('Align ends when there is no longer a pair to line up')

  // Clearing the selection ends both, whichever was showing.
  put([block('cube', [0, 10, 0])])
  store().toggleMirror()
  store().clearSelection()
  if (store().mirroring || store().aligning) fail('a mode survived the selection being cleared')
  else ok('clearing the selection ends whichever mode was showing')

  // Undoing a delete brings the blocks back, but not the mode.
  put([block('cube', [0, 10, 0])])
  store().toggleMirror()
  store().deleteSelection()
  store().undo()
  if (store().mirroring) fail('undoing a delete brought the mode back with the blocks')
  else ok('undo restores the blocks without restoring the mode')
}

console.log(problems ? `\n${problems} problem${problems === 1 ? '' : 's'}` : '\nall clear')
process.exit(problems ? 1 : 0)
