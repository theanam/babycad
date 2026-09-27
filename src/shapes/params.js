/**
 * Parameter specs.
 *
 * Every shape declares its own list of parameters. A spec is plain data — the
 * properties panel renders a control from it, the geometry cache keys on it,
 * and the persistence layer validates against it. Nothing else needs to know
 * which shape it is looking at.
 *
 *   { kind, key, label, default, ...bounds }
 *
 * `kind` is one of 'number' | 'int' | 'bool' | 'choice' | 'text' | 'mesh' |
 * 'sketch'.
 */
import { digestSketch, normalizeSketch } from './sketch/doc'

/** A continuous value. `soft` bounds the slider without bounding what you can type. */
export const num = (key, label, def, opts = {}) => ({
  kind: 'number',
  key,
  label,
  default: def,
  min: 0.02,
  max: 4,
  step: 0.05,
  ...opts,
})

/** A whole number — segment counts, tooth counts, sides. */
export const int = (key, label, def, opts = {}) => ({
  kind: 'int',
  key,
  label,
  default: def,
  min: 3,
  max: 64,
  step: 1,
  ...opts,
})

/** An angle, always stored and edited in degrees; builders convert. */
export const deg = (key, label, def, opts = {}) => ({
  kind: 'number',
  key,
  label,
  default: def,
  min: 0,
  max: 360,
  step: 5,
  unit: '°',
  ...opts,
})

export const bool = (key, label, def, opts = {}) => ({
  kind: 'bool',
  key,
  label,
  default: def,
  ...opts,
})

/**
 * A line of words, for shapes made out of what you type rather than out of
 * numbers. `maxLength` is a guard rather than a style: a whole paragraph
 * extruded into one solid is thousands of triangles nobody wanted.
 *
 * No variable has this kind, so `accepts` refuses every one of them and a text
 * parameter simply cannot be bound. That is deliberate — variables exist to
 * keep sizes agreeing with each other, and there is nothing for a word to
 * agree with.
 */
export const text = (key, label, def, opts = {}) => ({
  kind: 'text',
  key,
  label,
  default: def,
  maxLength: 48,
  ...opts,
})

/**
 * The id of an imported model, in `shapes/meshStore`.
 *
 * Nothing edits this: it is written once by the importer and read by the
 * builder. It is a parameter rather than a field on the object so that the
 * geometry cache keys on it for free — change which model a block is and the
 * mesh is rebuilt, exactly as changing a cube's width rebuilds the cube.
 */
export const mesh = (key = 'mesh') => ({ kind: 'mesh', key, label: 'Model', default: '' })

/**
 * A drawing, in millimetres — see `shapes/sketch/doc`.
 *
 * The one parameter whose value is not a scalar, which two other things in
 * this file have to know about: `coerce` hands back a fresh document every
 * time, because two blocks sharing one by reference would let an edit to one
 * show up in the other; and `paramsKey` cannot concatenate an object, so the
 * spec carries a `digest` for it to key on instead.
 *
 * The default is frozen rather than made fresh per shape. It is the empty
 * drawing every new block starts as, it is shared by all of them, and the
 * freeze is what says out loud that a document is never edited in place.
 */
const EMPTY_SKETCH = Object.freeze({ nodes: Object.freeze([]) })
export const sketch = (key = 'sketch', label = 'Drawing') => ({
  kind: 'sketch',
  key,
  label,
  default: EMPTY_SKETCH,
  digest: digestSketch,
})

/** `options` is [{ value, label }]; values may be numbers or strings. */
export const choice = (key, label, def, options, opts = {}) => ({
  kind: 'choice',
  key,
  label,
  default: def,
  options,
  ...opts,
})

/* -------------------------------------------------------------- values -- */

export function defaultsOf(specs) {
  const out = {}
  for (const s of specs) out[s.key] = s.default
  return out
}

/** Coerce one value into the spec's type and range. Returns the default on junk. */
export function coerce(spec, value) {
  switch (spec.kind) {
    case 'bool':
      return typeof value === 'boolean' ? value : spec.default
    case 'choice':
      return spec.options.some((o) => o.value === value) ? value : spec.default
    case 'mesh':
      return typeof value === 'string' ? value : spec.default
    // Always a fresh, validated document — never the object it was handed.
    // A file or a clipboard can carry any nonsense at all, and two blocks
    // must not end up pointing at one drawing.
    case 'sketch':
      return normalizeSketch(value)
    case 'text': {
      // Runs of whitespace collapse and the ends are trimmed, so two spellings
      // of the same words settle to one stored value — and therefore, once
      // stored, to one cache key. (`paramsKey` keys on what it is handed, so
      // that only holds for params that have been through here, which is every
      // param the store keeps.) Empty is not a shape, so it falls back rather
      // than building nothing at all.
      const t = String(value ?? '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, spec.maxLength)
      return t || spec.default
    }
    case 'int': {
      const n = Math.round(Number(value))
      if (!Number.isFinite(n)) return spec.default
      return clamp(n, spec.min, spec.max)
    }
    default: {
      const n = Number(value)
      if (!Number.isFinite(n)) return spec.default
      // Trim float noise so the cache key of a typed 0.3 and a stepped 0.3 match.
      return round(clamp(n, spec.min, spec.max))
    }
  }
}

/** Fill in every parameter the shape declares, dropping anything it doesn't. */
export function normalize(specs, raw) {
  const out = {}
  for (const s of specs) out[s.key] = coerce(s, raw?.[s.key])
  return out
}

/* ----------------------------------------------------------- variables -- */

/**
 * Which kind of variable can drive this parameter. `int` collapses into
 * `number`: a tooth count and a radius are the same kind of thing to a
 * variable, and binding one to the other just rounds on the way in. Keeping
 * them apart would mean a "12" you couldn't use as a side count.
 */
export const kindOf = (spec) => (spec.kind === 'int' ? 'number' : spec.kind)

/**
 * Can this variable drive this parameter? Numbers and booleans go by kind
 * alone — bounds are handled by `coerce`, which clamps, so a variable that is
 * too big for one shape still works, just pinned to that shape's limit.
 *
 * Choices are different: `hand` and `pressureAngle` are both choices but share
 * no values, so compatibility is by the value actually being on the menu here.
 */
export function accepts(spec, variable) {
  if (!variable || kindOf(spec) !== variable.kind) return false
  if (spec.kind === 'choice') return spec.options.some((o) => o.value === variable.value)
  return true
}

/** Stable cache key — spec order, so it never depends on object key order. */
export function paramsKey(specs, params) {
  let key = ''
  for (const s of specs) {
    const value = params?.[s.key] ?? s.default
    // A drawing is an object, and an object stringifies to `[object Object]`:
    // without its digest every sketch in a build would share one cache entry
    // and they would all show the same solid.
    key += `|${s.key}:${s.digest ? s.digest(value) : value}`
  }
  return key
}

/**
 * Are two parameter values the same?
 *
 * Everything here is a scalar and compares with `===` — except a drawing,
 * which is an object, and a freshly coerced one is never the same object as
 * the last even when it is the same drawing. Somewhere that matters: the two
 * `sameParams` checks, in `sceneStore` and in `scene/variables`, are what stop
 * a no-op landing on the undo stack.
 */
export const sameParamValue = (a, b) => {
  if (a === b) return true
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
  return digestSketch(a) === digestSketch(b)
}

export const clamp = (n, lo, hi) => (n < lo ? lo : n > hi ? hi : n)

const round = (n) => {
  const v = Math.round(n * 1e6) / 1e6
  return Object.is(v, -0) ? 0 : v
}
