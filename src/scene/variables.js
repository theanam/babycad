/**
 * Named values shared across shapes.
 *
 * A variable is `{ id, name, kind, value }`. An object that uses one records
 * it in `bindings`, keyed by parameter:
 *
 *   { type: 'gear', params: { teeth: 16, … }, bindings: { teeth: 'var-id' } }
 *
 * The important part is that `params` always holds the *resolved* value. The
 * geometry builders, the cache key, the exporters and the gizmo never learn
 * that variables exist — they read the same plain numbers they always did.
 * Everything here is about keeping that resolved copy honest: whenever a
 * variable's value changes, or a binding is made or broken, every affected
 * object's `params` is recomputed in the same undoable step.
 *
 * The alternative — storing `{ $var: id }` inside `params` and resolving at
 * build time — pushes variable-awareness into every consumer, including the
 * cache key and the STL exporter. This way it stays in one file.
 */
import { getShapeDef, normalizeParams } from '../shapes'
import { accepts, kindOf } from '../shapes/params'

export const KIND_LABEL = { number: 'Number', bool: 'Yes / no', choice: 'Choice' }

/** A name that is legal, readable and not already taken. */
export function uniqueName(base, variables, ignoreId = null) {
  const clean =
    String(base ?? '')
      .trim()
      .replace(/[^\w ]+/g, '')
      .replace(/\s+(.)/g, (_, c) => c.toUpperCase())
      .replace(/^(.)/, (_, c) => c.toLowerCase())
      .slice(0, 24) || 'value'
  const taken = new Set(variables.filter((v) => v.id !== ignoreId).map((v) => v.name))
  if (!taken.has(clean)) return clean
  for (let n = 2; ; n++) if (!taken.has(clean + n)) return clean + n
}

/** The variables this parameter could be driven by, in name order. */
export function candidatesFor(spec, variables) {
  return variables.filter((v) => accepts(spec, v)).sort((a, b) => a.name.localeCompare(b.name))
}

/** The parameter spec behind a `type` + key, or null if the shape dropped it. */
export function specOf(type, key) {
  return getShapeDef(type).params.find((s) => s.key === key) ?? null
}

/**
 * Resolve one object's parameters against the variables. Returns the object's
 * existing `params` untouched when nothing is bound, so callers can compare by
 * identity to find out whether anything actually moved.
 */
export function resolveParams(object, byId) {
  const bindings = object.bindings
  if (!bindings) return object.params

  let raw = null
  for (const key in bindings) {
    const variable = byId.get(bindings[key])
    if (!variable) continue
    if (!raw) raw = { ...object.params }
    raw[key] = variable.value
  }
  if (!raw) return object.params

  const next = normalizeParams(object.type, raw)
  return sameParams(next, object.params) ? object.params : next
}

/** Drop bindings whose variable is gone, or whose parameter no longer exists. */
export function pruneBindings(object, byId) {
  const bindings = object.bindings
  if (!bindings) return null
  const kept = {}
  let dropped = false
  for (const key in bindings) {
    const variable = byId.get(bindings[key])
    const spec = specOf(object.type, key)
    if (variable && spec && accepts(spec, variable)) kept[key] = bindings[key]
    else dropped = true
  }
  const empty = Object.keys(kept).length === 0
  if (!dropped) return bindings
  return empty ? null : kept
}

/**
 * Re-resolve every object against a set of variables, returning history
 * patches for the ones that changed. `overrides` lets a caller fold a binding
 * edit into the same pass, so making a binding and applying its value land as
 * one undo step rather than two.
 */
export function resolvePatches(objects, variables, overrides = {}) {
  const byId = new Map(variables.map((v) => [v.id, v]))
  const patches = []
  for (const object of objects) {
    const staged = overrides[object.id] ? { ...object, ...overrides[object.id] } : object
    const bindings = pruneBindings(staged, byId)
    const params = resolveParams({ ...staged, bindings }, byId)
    const was = object.bindings ?? null
    if (params === object.params && bindings === was) continue
    patches.push({
      id: object.id,
      before: { params: object.params, bindings: was },
      after: { params, bindings },
    })
  }
  return patches
}

/** How many objects use each variable, for the manager's "used by" column. */
export function usageCounts(objects) {
  const counts = new Map()
  for (const object of objects) {
    for (const key in object.bindings ?? {}) {
      const id = object.bindings[key]
      counts.set(id, (counts.get(id) ?? 0) + 1)
    }
  }
  return counts
}

/** Validate a stored variable list — used by both persistence and loading. */
export function sanitizeVariables(raw) {
  if (!Array.isArray(raw)) return []
  const out = []
  const seen = new Set()
  for (const v of raw) {
    if (!v || typeof v.id !== 'string' || typeof v.name !== 'string') continue
    if (!KIND_LABEL[v.kind] || seen.has(v.id)) continue
    if (v.kind === 'number' && !Number.isFinite(v.value)) continue
    if (v.kind === 'bool' && typeof v.value !== 'boolean') continue

    let options
    if (v.kind === 'choice') {
      options = Array.isArray(v.options)
        ? v.options.filter((o) => o && 'value' in o).map((o) => ({ value: o.value, label: String(o.label ?? o.value) }))
        : []
      // A choice with no menu, or a value that isn't on it, can't be edited
      // anywhere — drop it and let the bindings prune themselves.
      if (!options.some((o) => o.value === v.value)) continue
    }

    seen.add(v.id)
    const variable = { id: v.id, name: uniqueName(v.name, out), kind: v.kind, value: v.value }
    if (options) variable.options = options
    out.push(variable)
  }
  return out
}

/** The variable kind a parameter would produce if you promoted it. */
export const variableKindFor = kindOf

const sameParams = (a, b) => {
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every((k) => a[k] === b[k])
}
