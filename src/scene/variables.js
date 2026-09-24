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
import { evaluate, namesIn } from './expression'
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
    // A sum is kept as it was typed. Only a number can hold one — a yes/no or
    // a menu has nothing to add up — and it is worked out again below rather
    // than trusted, because the file may have been edited by hand or saved by
    // a version that knew different names.
    if (v.kind === 'number' && typeof v.formula === 'string' && v.formula.trim()) {
      variable.formula = v.formula.trim()
    }
    out.push(variable)
  }
  return recompute(out)
}

/** The variable kind a parameter would produce if you promoted it. */
export const variableKindFor = kindOf

const sameParams = (a, b) => {
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every((k) => a[k] === b[k])
}

/* ------------------------------------------------------------- sums -- */

/**
 * Variables built out of other variables.
 *
 * A variable may hold a sum rather than a number — `wall * 2`, `span / 4` —
 * and the sum is kept, so changing what it was built from changes it too. That
 * turns a flat list into a graph, and a graph brings the one problem worth
 * taking seriously here: `a = b * 2` and then `b = a * 2`, each waiting on the
 * other, for ever.
 *
 * It is handled twice over, because either alone would be a mistake:
 *
 *  - **Refused on the way in.** `wouldCycle` is asked before a sum is stored,
 *    so a loop cannot be made in the first place and the person is told why
 *    while they are still looking at the thing they typed. This is the half
 *    that matters, because it means the model never holds a loop.
 *  - **Survived if one ever appears.** `recompute` works out an order before
 *    it evaluates anything, and whatever is left over — which is exactly the
 *    variables caught in a loop — is marked broken and keeps the last number
 *    it had. A hand-edited file, or a bug of mine, then costs a wrong value on
 *    one variable rather than a hung tab.
 *
 * Nothing recurses and nothing loops until it settles: the order is worked out
 * first, by counting what depends on what, and then each sum is evaluated once.
 */

/** The ids a sum leans on, ignoring names that are not variables here. */
function leansOn(formula, variables) {
  const byName = new Map(variables.map((v) => [v.name.toLowerCase(), v.id]))
  const out = []
  for (const name of namesIn(formula)) {
    const id = byName.get(name.toLowerCase())
    if (id && !out.includes(id)) out.push(id)
  }
  return out
}

/**
 * An order to work the sums out in, plus whatever could not be ordered.
 *
 * Kahn's algorithm: repeatedly take something that is waiting on nothing. What
 * is never taken is what is waiting on something that is waiting on it.
 */
function orderOf(variables) {
  const waitingOn = new Map(variables.map((v) => [v.id, v.formula ? leansOn(v.formula, variables) : []]))
  const count = new Map(variables.map((v) => [v.id, 0]))
  const feeds = new Map(variables.map((v) => [v.id, []]))
  for (const [id, deps] of waitingOn) {
    for (const dep of deps) {
      if (!count.has(dep)) continue
      count.set(id, count.get(id) + 1)
      feeds.get(dep).push(id)
    }
  }
  const ready = variables.filter((v) => count.get(v.id) === 0).map((v) => v.id)
  const order = []
  while (ready.length) {
    const id = ready.shift()
    order.push(id)
    for (const next of feeds.get(id)) {
      count.set(next, count.get(next) - 1)
      if (count.get(next) === 0) ready.push(next)
    }
  }
  const looping = variables.filter((v) => !order.includes(v.id)).map((v) => v.id)
  return { order, looping: new Set(looping) }
}

/**
 * Settle every variable that holds a sum. Returns a new list; anything whose
 * sum cannot be worked out keeps the number it last had and is marked broken,
 * so a build never comes back with a hole in it.
 */
export function recompute(variables) {
  if (!variables.some((v) => v.formula)) {
    return variables.some((v) => v.broken) ? variables.map(({ broken, ...v }) => v) : variables
  }
  const { order, looping } = orderOf(variables)
  const byId = new Map(variables.map((v) => [v.id, { ...v }]))
  const scope = {}
  for (const v of variables) if (!v.formula) scope[v.name] = v.value

  for (const id of order) {
    const v = byId.get(id)
    if (!v.formula) continue
    const worked = evaluate(v.formula, scope)
    if (worked === null) v.broken = true
    else {
      v.value = worked
      delete v.broken
    }
    scope[v.name] = v.value
  }
  for (const id of looping) byId.get(id).broken = true
  for (const v of byId.values()) if (!v.broken) delete v.broken
  return variables.map((v) => byId.get(v.id))
}

/**
 * Would giving this variable this sum leave it waiting on itself?
 *
 * Asked before the sum is stored, so the answer can be "no, and here is why"
 * rather than a broken variable.
 */
export function wouldCycle(variables, id, formula) {
  const proposed = variables.map((v) => (v.id === id ? { ...v, formula } : v))
  return orderOf(proposed).looping.has(id)
}

/**
 * Rewrite sums after a rename, so `wall * 2` follows `wall` becoming `side`.
 *
 * Whole words only: renaming `w` must not turn `wall` into `sideall`.
 */
export function renameInFormulas(variables, from, to) {
  if (!from || !to || from === to) return variables
  const pattern = new RegExp(`\\b${from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi')
  return variables.map((v) =>
    v.formula && pattern.test(v.formula) ? { ...v, formula: v.formula.replace(pattern, to) } : v
  )
}

/**
 * Turn any sum that named this variable into the number it last worked out to.
 *
 * For when that variable is deleted. Leaving the sum would leave a name that
 * refers to nothing; dropping the variable outright would move whatever it was
 * holding up. Freezing the last good number keeps the build exactly as it is.
 */
export function freezeFormulasUsing(variables, goneName) {
  return variables.map((v) => {
    if (!v.formula) return v
    const mentions = namesIn(v.formula).some((n) => n.toLowerCase() === goneName.toLowerCase())
    if (!mentions) return v
    const { formula, broken, ...rest } = v
    return rest
  })
}
