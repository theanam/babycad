/**
 * Resizing writes into the shape's own numbers.
 *
 * A block used to carry two things that could both be called its size: the
 * millimetres in its parameters, and the `scale` multiplier the gizmo wrote.
 * Two values for one property is one too many — drag a cube wider and its
 * Width has to say so — so a resize is converted into a parameter edit
 * wherever the shape can express one, and `scale` is left where it was.
 *
 * `AXIS_PARAMS` is what makes that possible: per shape, the length parameters
 * that grow with each *internal* axis (the scene's own y-up triples, not the
 * Z-up names the properties rail puts on them). Three rules fall out of it:
 *
 *   - A parameter named on more than one axis — a sphere's radius, a gear's
 *     module — can only be written when those axes were dragged by the same
 *     ratio. Squash a sphere along one axis alone and there is no radius that
 *     describes the result, so the multiplier is what's left.
 *   - A parameter named on an axis that *didn't* move can't be written either,
 *     for the same reason from the other side.
 *   - A parameter following a variable isn't ours to write. That resize is
 *     refused outright rather than quietly diverted into `scale`, because a
 *     variable that no longer matches the block it drives is this same bug
 *     wearing a different hat.
 *
 * Every builder returns geometry centred on the origin, which is what lets
 * this substitution be exact: growing the geometry about the origin and
 * scaling the object about the origin put the surfaces in the same place, so
 * nothing moves on screen when a drag is baked on release.
 */
import { getShapeDef } from './index'
import { coerce } from './params'

const AXES = ['x', 'y', 'z']

export const AXIS_PARAMS = {
  cube: { x: ['width'], y: ['height'], z: ['depth'] },
  wedge: { x: ['width'], y: ['height'], z: ['depth'] },
  sphere: { x: ['radius'], y: ['radius'], z: ['radius'] },
  cone: { x: ['radius'], y: ['height'], z: ['radius'] },
  cylinder: {
    x: ['bottomRadius', 'topRadius'],
    y: ['height'],
    z: ['bottomRadius', 'topRadius'],
  },
  pyramid: { x: ['radius'], y: ['height'], z: ['radius'] },
  pipe: { x: ['radius', 'wall'], y: ['height'], z: ['radius', 'wall'] },
  star: { x: ['radius', 'innerRadius'], y: ['height'], z: ['radius', 'innerRadius'] },
  gear: { x: ['module', 'bore'], y: ['thickness'], z: ['module', 'bore'] },
  thread: { x: ['diameter', 'pitch'], y: ['length'], z: ['diameter', 'pitch'] },
  spring: { x: ['radius', 'wire'], y: ['height'], z: ['radius', 'wire'] },
  // A donut and a knot reach as far up as their tube is thick, and the tube is
  // also half of how wide they are — so only a uniform resize describes one.
  torus: { x: ['radius', 'tube'], y: ['radius', 'tube'], z: ['radius', 'tube'] },
  knot: { x: ['radius', 'tube'], y: ['radius', 'tube'], z: ['radius', 'tube'] },
}

const near = (a, b) => Math.abs(a - b) < 1e-4

/**
 * Widen a handle's mask to every axis the shape ties to the ones it pulls.
 *
 * A cylinder's radius is its x and its z at once, so a handle that pulls x
 * alone is asking for something the shape has no number for. Rather than
 * leave the pull in a stretch multiplier — a second answer to how big the
 * block is — the drag takes z along with it, and a side pull on a tube makes
 * a fatter tube. A ball goes further: every axis is the radius, so any handle
 * makes a bigger ball. A cube ties nothing to anything and is untouched.
 *
 * Transitive, so a shape that ties x to y and y to z pulls all three.
 */
export function coupledMask(type, mask) {
  const map = AXIS_PARAMS[type]
  if (!map) return mask
  const out = [...mask]
  let grew = true
  while (grew) {
    grew = false
    for (let i = 0; i < 3; i++) {
      if (!out[i]) continue
      for (let j = 0; j < 3; j++) {
        if (out[j] || i === j) continue
        const shared = (map[AXES[i]] ?? []).some((k) => (map[AXES[j]] ?? []).includes(k))
        if (shared) {
          out[j] = 1
          grew = true
        }
      }
    }
  }
  return out
}

/**
 * Turn a per-axis resize ratio into new shape parameters.
 *
 * @param object  the block being resized
 * @param ratio   [x, y, z] multipliers, in the block's own local axes
 * @returns  `{ params }` with the resize written into the shape's numbers,
 *           `{ blocked }` naming a parameter that follows a variable, or
 *           `null` when this shape can't express the resize and the caller
 *           should leave it in `scale`.
 */
export function resizeToParams(object, ratio) {
  const map = AXIS_PARAMS[object.type]
  if (!map) return null

  const wanted = new Map() // parameter -> the ratio it has to take
  const held = new Set() // parameters on an axis that stayed put

  for (let i = 0; i < 3; i++) {
    const keys = map[AXES[i]] ?? []
    if (near(ratio[i], 1)) {
      for (const key of keys) held.add(key)
      continue
    }
    if (!keys.length) return null // nothing on this axis carries the length
    for (const key of keys) {
      const seen = wanted.get(key)
      if (seen !== undefined && !near(seen, ratio[i])) return null // axes disagree
      wanted.set(key, ratio[i])
    }
  }

  if (!wanted.size) return null
  for (const key of wanted.keys()) if (held.has(key)) return null

  const specs = getShapeDef(object.type).params
  const params = { ...object.params }
  for (const [key, r] of wanted) {
    const spec = specs.find((s) => s.key === key)
    if (!spec) return null
    if (object.bindings?.[key]) return { blocked: spec.label }
    params[key] = coerce(spec, object.params[key] * r)
  }
  return { params }
}
