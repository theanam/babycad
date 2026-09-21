/**
 * Resize-to-parameters check:  `node tools/check-resize.mjs`
 *
 * A gizmo resize is written into the shape's own numbers rather than into a
 * `scale` multiplier stacked on top of them (see src/shapes/resize.js). This
 * checks the two things that has to get right:
 *
 *   every shape is mapped      a shape missing from AXIS_PARAMS silently
 *                              falls back to the multiplier, which is the bug
 *                              the mapping exists to fix
 *   the substitution is exact  growing the parameters by a ratio must put the
 *                              geometry's bounds exactly where scaling the
 *                              object by that same ratio would have, or a
 *                              block visibly jumps when a drag is released
 */
import { register } from 'node:module'

register('./resolve-extensionless.mjs', import.meta.url)

const { SHAPE_DEFS, defaultParams } = await import('../src/shapes/index.js')
const { buildGeometry } = await import('../src/shapes/geometryCache.js')
const { AXIS_PARAMS, resizeToParams, coupledMask } = await import('../src/shapes/resize.js')

const extent = (type, params) => {
  const g = buildGeometry(type, params)
  const b = g.boundingBox
  const out = [b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z]
  g.dispose()
  return out
}

const object = (type, bindings = null) => ({ type, params: defaultParams(type), bindings })

let problems = 0
const fail = (message) => {
  console.log(`  BAD ${message}`)
  problems++
}

console.log('every shape has a resize mapping…')
for (const def of SHAPE_DEFS) {
  if (!AXIS_PARAMS[def.type]) fail(`${def.type} is missing from AXIS_PARAMS`)
}

console.log('\na uniform resize lands where the multiplier would have…')
for (const def of SHAPE_DEFS) {
  for (const ratio of [0.5, 1.5, 2]) {
    const o = object(def.type)
    const result = resizeToParams(o, [ratio, ratio, ratio])
    if (!result?.params) {
      fail(`${def.type} cannot express a uniform ×${ratio}`)
      continue
    }
    const before = extent(def.type, o.params)
    const after = extent(def.type, result.params)
    for (let i = 0; i < 3; i++) {
      const want = before[i] * ratio
      // Loose: a few builders quantise (a gear's tooth count is fixed, so its
      // tip circle moves in steps), and a fraction of a millimetre is not what
      // this is looking for.
      if (Math.abs(after[i] - want) > Math.max(0.05, want * 0.02)) {
        fail(`${def.type} ×${ratio} axis ${'xyz'[i]}: got ${after[i].toFixed(3)}, want ${want.toFixed(3)}`)
      }
    }
  }
}

/**
 * A few shapes reach a little further than the parameter being stretched: a
 * coil is as tall as its height plus one wire diameter, so doubling the height
 * alone lands a wire short of double the extent. That is a nudge on release,
 * not a jump; anything bigger is a mapping mistake.
 */
const SLACK = { spring: 2 }

console.log('\nsingle-axis resizes go into the right parameter…')
for (const [type, axes] of Object.entries(AXIS_PARAMS)) {
  for (let i = 0; i < 3; i++) {
    const o = object(type)
    const ratio = [1, 1, 1]
    ratio[i] = 2
    const result = resizeToParams(o, ratio)
    if (!result?.params) continue // legitimately not expressible; the multiplier stands

    const before = extent(type, o.params)
    const after = extent(type, result.params)
    for (let k = 0; k < 3; k++) {
      const want = before[k] * ratio[k]
      if (Math.abs(after[k] - want) > Math.max(0.05, want * 0.02, SLACK[type] ?? 0)) {
        fail(`${type} ×2 on ${'xyz'[i]} moved axis ${'xyz'[k]}: got ${after[k].toFixed(3)}, want ${want.toFixed(3)}`)
      }
    }
    void axes
  }
}

console.log('\na parameter that follows a variable is refused…')
for (const [type, axes] of Object.entries(AXIS_PARAMS)) {
  const key = axes.x[0]
  if (!key) continue
  const result = resizeToParams(object(type, { [key]: 'some-variable' }), [2, 1, 1])
  const uniform = resizeToParams(object(type, { [key]: 'some-variable' }), [2, 2, 2])
  if (!result?.blocked && !uniform?.blocked) {
    fail(`${type} let a resize through while ${key} follows a variable`)
  }
}

console.log('\na handle pulls every axis the shape ties to it…')
{
  const cases = [
    ['cube', [1, 0, 0], [1, 0, 0]],
    ['cube', [1, 0, 1], [1, 0, 1]],
    ['cylinder', [1, 0, 0], [1, 0, 1]],
    ['cylinder', [0, 1, 0], [0, 1, 0]],
    ['cone', [0, 0, 1], [1, 0, 1]],
    ['gear', [1, 0, 0], [1, 0, 1]],
    ['sphere', [0, 1, 0], [1, 1, 1]],
    ['sphere', [1, 0, 1], [1, 1, 1]],
    ['torus', [1, 0, 0], [1, 1, 1]],
  ]
  for (const [type, mask, want] of cases) {
    const got = coupledMask(type, mask)
    if (got.join() !== want.join()) fail(`${type} mask ${mask} widened to ${got}, expected ${want}`)
  }
  // And the widened pull is always something the shape can then express.
  for (const type of Object.keys(AXIS_PARAMS)) {
    for (const mask of [[1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1]]) {
      const m = coupledMask(type, mask)
      const ratio = m.map((on) => (on ? 1.5 : 1))
      if (!resizeToParams(object(type), ratio)?.params) fail(`${type}: a ${mask} handle, widened to ${m}, still cannot be baked`)
    }
  }
}

console.log('\na resize of exactly 1 asks for nothing…')
for (const type of Object.keys(AXIS_PARAMS)) {
  if (resizeToParams(object(type), [1, 1, 1]) !== null) fail(`${type} produced a patch for ×1`)
}

console.log(problems ? `\n${problems} problem(s)` : '\nall clear')
process.exitCode = problems ? 1 : 0
