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
 * `kind` is one of 'number' | 'int' | 'bool' | 'choice' | 'text'.
 */

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
  for (const s of specs) key += `|${s.key}:${params?.[s.key] ?? s.default}`
  return key
}

export const clamp = (n, lo, hi) => (n < lo ? lo : n > hi ? hi : n)

const round = (n) => {
  const v = Math.round(n * 1e6) / 1e6
  return Object.is(v, -0) ? 0 : v
}
