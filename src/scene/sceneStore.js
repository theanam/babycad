import { create } from 'zustand'
import * as cmd from '../history/undoRedo'
import { MAX_HISTORY, SCENE_VERSION } from '../constants'
import { defaultParams, normalizeParams, SHAPE_COLOR } from '../shapes'
import { restingHeight } from '../shapes/geometryCache'
import {
  resolveParams,
  resolvePatches,
  sanitizeVariables,
  specOf,
  uniqueName,
  variableKindFor,
} from './variables'

const uid = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36)

export function makeObject(type, position = [0, 0, 0], color, params) {
  const shapeParams = params ? normalizeParams(type, params) : defaultParams(type)
  return {
    id: uid(),
    type,
    params: shapeParams,
    bindings: null, // { [paramKey]: variableId } once something is linked
    position: [position[0], position[1] || restingHeight(type, shapeParams), position[2]],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    color: color ?? SHAPE_COLOR[type] ?? '#FFC93D',
    parentGroupId: null,
  }
}

/** Selecting any member of a group selects the whole group. */
export function expandSelection(ids, objects) {
  const byId = new Map(objects.map((o) => [o.id, o]))
  const groupIds = new Set()
  for (const id of ids) {
    const o = byId.get(id)
    if (o?.parentGroupId) groupIds.add(o.parentGroupId)
  }
  const out = new Set(ids.filter((id) => byId.has(id)))
  if (groupIds.size) {
    for (const o of objects) if (o.parentGroupId && groupIds.has(o.parentGroupId)) out.add(o.id)
  }
  return [...out]
}

const emptyScene = () => ({ objects: [], groups: [], variables: [] })

export const useScene = create((set, get) => ({
  ...emptyScene(),
  selectedIds: [],
  pickMany: false, // touch-friendly multi-select, mirrors shift-click
  snapEnabled: true, // grid snapping, on by default
  freeMove: false, // Alt held: temporarily ignore the snap grid
  past: [],
  future: [],
  projectName: '',

  // ---------------------------------------------------------- history --

  /** The slice every command reads and writes. */
  slice() {
    const st = get()
    return { objects: st.objects, groups: st.groups, variables: st.variables }
  },

  /** Run a command and record it. */
  apply(command) {
    set((st) => {
      const next = command.forward({
        objects: st.objects,
        groups: st.groups,
        variables: st.variables,
      })
      return {
        objects: next.objects,
        groups: next.groups,
        variables: next.variables,
        past: [...st.past, command].slice(-MAX_HISTORY),
        future: [],
      }
    })
  },

  /** Record a command whose effect is already on screen (live drags). */
  record(command) {
    set((st) => ({ past: [...st.past, command].slice(-MAX_HISTORY), future: [] }))
  },

  undo() {
    const st = get()
    const command = st.past[st.past.length - 1]
    if (!command) return
    const next = command.backward(st.slice())
    const alive = new Set(next.objects.map((o) => o.id))
    set({
      objects: next.objects,
      groups: next.groups,
      variables: next.variables,
      past: st.past.slice(0, -1),
      future: [command, ...st.future],
      selectedIds: st.selectedIds.filter((id) => alive.has(id)),
    })
  },

  redo() {
    const st = get()
    const command = st.future[0]
    if (!command) return
    const next = command.forward(st.slice())
    const alive = new Set(next.objects.map((o) => o.id))
    set({
      objects: next.objects,
      groups: next.groups,
      variables: next.variables,
      past: [...st.past, command].slice(-MAX_HISTORY),
      future: st.future.slice(1),
      selectedIds: st.selectedIds.filter((id) => alive.has(id)),
    })
  },

  // -------------------------------------------------------- selection --

  select(id, additive = false) {
    const st = get()
    if (!id) return set({ selectedIds: [] })
    const wantAdditive = additive || st.pickMany
    let base = wantAdditive ? st.selectedIds : []
    if (wantAdditive && st.selectedIds.includes(id)) {
      // Toggling off removes the whole group the block belongs to.
      const drop = new Set(expandSelection([id], st.objects))
      base = st.selectedIds.filter((x) => !drop.has(x))
      return set({ selectedIds: base })
    }
    set({ selectedIds: expandSelection([...base, id], st.objects) })
  },

  setSelection(ids) {
    set({ selectedIds: expandSelection(ids, get().objects) })
  },

  clearSelection() {
    set({ selectedIds: [] })
  },

  togglePickMany() {
    set((st) => ({ pickMany: !st.pickMany }))
  },

  setFreeMove(freeMove) {
    set({ freeMove })
  },

  toggleSnap() {
    set((st) => ({ snapEnabled: !st.snapEnabled }))
  },

  selectedObjects() {
    const st = get()
    const sel = new Set(st.selectedIds)
    return st.objects.filter((o) => sel.has(o.id))
  },

  // ------------------------------------------------------------ edits --

  addShape(type, position, params) {
    const obj = makeObject(type, position, undefined, params)
    get().apply(cmd.addObjects([obj]))
    set({ selectedIds: [obj.id] })
    return obj
  },

  // ---------------------------------------------------- shape parameters --

  /**
   * Live parameter edit — a slider being dragged. Deliberately outside the
   * history, the same deal the gizmo gets: the geometry rebuilds every frame
   * so you can see what you're doing, and one entry lands when you let go.
   */
  stageParams(patch) {
    set((st) => {
      const byId = variableMap(st.variables)
      return {
        objects: st.objects.map((o) =>
          patch[o.id] ? { ...o, params: settle(o, { ...o.params, ...patch[o.id] }, byId) } : o
        ),
      }
    })
  },

  /** Close out a slider drag: diff against the snapshot taken when it started. */
  commitParams(before, label = 'reshape') {
    const st = get()
    const patches = []
    for (const o of st.objects) {
      const was = before[o.id]
      if (!was || sameParams(was, o.params)) continue
      patches.push({ id: o.id, before: was, after: o.params })
    }
    if (patches.length) st.record(cmd.reshapeObjects(patches, label))
  },

  /** One-shot parameter change from a field or a toggle. */
  setParams(patch, label = 'reshape') {
    const st = get()
    const byId = variableMap(st.variables)
    const patches = []
    for (const o of st.objects) {
      if (!patch[o.id]) continue
      const after = settle(o, { ...o.params, ...patch[o.id] }, byId)
      if (sameParams(o.params, after)) continue
      patches.push({ id: o.id, before: o.params, after })
    }
    if (patches.length) st.apply(cmd.reshapeObjects(patches, label))
  },

  /** Put the selection's shape parameters back to the shape's defaults. */
  resetParams() {
    const st = get()
    const sel = st.selectedObjects()
    if (!sel.length) return
    st.setParams(Object.fromEntries(sel.map((o) => [o.id, defaultParams(o.type)])), 'reset shape')
  },

  // ------------------------------------------------------------ variables --

  /**
   * Every variable edit runs through here: swap the list, re-resolve every
   * object against it, and record both halves as one command. That is the
   * whole consistency story — nothing else is allowed to write `variables`, so
   * a bound parameter can never be left holding a stale number.
   *
   * `overrides` folds a binding change into the same pass, so "make this a
   * variable" is one undo step rather than a create and then a bind.
   */
  commitVariables(nextVariables, label, overrides = {}) {
    const st = get()
    const patches = resolvePatches(st.objects, nextVariables, overrides)
    st.apply(cmd.editVariables(label, st.variables, nextVariables, patches))
  },

  /** Promote a parameter's current value to a new variable, and bind it. */
  promoteToVariable(objectIds, key, name) {
    const st = get()
    const ids = new Set(objectIds)
    const source = st.objects.find((o) => ids.has(o.id))
    const spec = source && specOf(source.type, key)
    if (!spec) return null

    const variable = {
      id: uid(),
      name: uniqueName(name || spec.label, st.variables),
      kind: variableKindFor(spec),
      value: source.params[key],
    }
    // A choice variable carries the menu it came from, so the variables sheet
    // can offer the same buttons without having to guess which shape made it.
    if (spec.kind === 'choice') {
      variable.options = spec.options.map((o) => ({ value: o.value, label: o.label }))
    }
    const overrides = {}
    for (const o of st.objects) {
      if (ids.has(o.id)) overrides[o.id] = { bindings: { ...o.bindings, [key]: variable.id } }
    }
    st.commitVariables([...st.variables, variable], `make ${variable.name}`, overrides)
    return variable
  },

  /** Point a parameter at an existing variable. */
  bindParam(objectIds, key, variableId) {
    const st = get()
    const ids = new Set(objectIds)
    const variable = st.variables.find((v) => v.id === variableId)
    if (!variable) return
    const overrides = {}
    for (const o of st.objects) {
      if (ids.has(o.id)) overrides[o.id] = { bindings: { ...o.bindings, [key]: variableId } }
    }
    st.commitVariables(st.variables, `use ${variable.name}`, overrides)
  },

  /** Cut a parameter loose. It keeps whatever value it was showing. */
  unbindParam(objectIds, key) {
    const st = get()
    const ids = new Set(objectIds)
    const overrides = {}
    for (const o of st.objects) {
      if (!ids.has(o.id) || !o.bindings?.[key]) continue
      const rest = { ...o.bindings }
      delete rest[key]
      overrides[o.id] = { bindings: Object.keys(rest).length ? rest : null }
    }
    if (Object.keys(overrides).length) st.commitVariables(st.variables, 'unlink', overrides)
  },

  addVariable(name, kind = 'number', value = 1) {
    const st = get()
    const variable = { id: uid(), name: uniqueName(name, st.variables), kind, value }
    st.commitVariables([...st.variables, variable], `add ${variable.name}`)
    return variable
  },

  setVariableValue(id, value) {
    const st = get()
    const next = st.variables.map((v) => (v.id === id ? { ...v, value } : v))
    if (next.every((v, i) => v === st.variables[i])) return
    st.commitVariables(next, 'change value')
  },

  renameVariable(id, name) {
    const st = get()
    const clean = uniqueName(name, st.variables, id)
    st.commitVariables(
      st.variables.map((v) => (v.id === id ? { ...v, name: clean } : v)),
      'rename'
    )
  },

  /** Delete a variable. Anything bound to it keeps its last value, unlinked. */
  deleteVariable(id) {
    const st = get()
    const variable = st.variables.find((v) => v.id === id)
    if (!variable) return
    // resolvePatches prunes bindings whose variable has gone, so the objects
    // fall back to plain numbers on their own.
    st.commitVariables(
      st.variables.filter((v) => v.id !== id),
      `delete ${variable.name}`
    )
  },

  /** Live variable drag, outside the history — same deal as a shape slider. */
  stageVariableValue(id, value) {
    set((st) => {
      const variables = st.variables.map((v) => (v.id === id ? { ...v, value } : v))
      const byId = variableMap(variables)
      return {
        variables,
        objects: st.objects.map((o) =>
          o.bindings ? { ...o, params: resolveParams(o, byId) } : o
        ),
      }
    })
  },

  /** Close out a variable drag against the snapshot taken when it started. */
  commitVariableDrag(before) {
    const st = get()
    if (!before) return
    const patches = []
    for (const o of st.objects) {
      const was = before.params[o.id]
      if (!was || sameParams(was, o.params)) continue
      patches.push({
        id: o.id,
        before: { params: was, bindings: o.bindings ?? null },
        after: { params: o.params, bindings: o.bindings ?? null },
      })
    }
    const moved = before.variables.some((v, i) => v !== st.variables[i])
    if (moved || patches.length) {
      st.record(cmd.editVariables('change value', before.variables, st.variables, patches))
    }
  },

  /** The snapshot a live variable drag needs in order to be undoable. */
  variableSnapshot() {
    const st = get()
    return {
      variables: st.variables,
      params: Object.fromEntries(st.objects.map((o) => [o.id, o.params])),
    }
  },

  /** Live transform during a gizmo drag — deliberately outside the history. */
  stageTransform(patches) {
    set((st) => {
      const byId = Object.fromEntries(patches.map((p) => [p.id, p]))
      return {
        objects: st.objects.map((o) => {
          const p = byId[o.id]
          if (!p) return o
          const next = { ...o }
          if (p.position) next.position = p.position
          if (p.rotation) next.rotation = p.rotation
          if (p.scale) next.scale = p.scale
          return next
        }),
      }
    })
  },

  /** Close out a drag: diff against the snapshot taken when it started. */
  commitTransform(before, label = 'move') {
    const st = get()
    const patches = []
    for (const o of st.objects) {
      const b = before[o.id]
      if (!b) continue
      const moved =
        !same(b.position, o.position) || !same(b.rotation, o.rotation) || !same(b.scale, o.scale)
      if (!moved) continue
      patches.push({
        id: o.id,
        before: { position: b.position, rotation: b.rotation, scale: b.scale },
        after: { position: o.position, rotation: o.rotation, scale: o.scale },
      })
    }
    if (patches.length) st.record(cmd.transformObjects(patches, label))
  },

  /** Discrete transform from the panel steppers. */
  transformSelection(fn, label) {
    const st = get()
    const sel = st.selectedObjects()
    if (!sel.length) return
    const patches = sel.map((o) => ({
      id: o.id,
      before: { position: o.position, rotation: o.rotation, scale: o.scale },
      after: fn(o),
    }))
    st.apply(cmd.transformObjects(patches, label))
  },

  setColor(color) {
    const st = get()
    const sel = st.selectedObjects().filter((o) => o.color !== color)
    if (!sel.length) return
    st.apply(cmd.recolorObjects(sel.map((o) => ({ id: o.id, before: o.color, after: color }))))
  },

  combine() {
    const st = get()
    const ids = st.selectedIds
    if (ids.length < 2) return
    const group = { id: uid(), memberIds: [...ids] }
    const prevParents = Object.fromEntries(
      st.selectedObjects().map((o) => [o.id, o.parentGroupId ?? null])
    )
    st.apply(cmd.combineObjects(group, prevParents))
  },

  ungroup() {
    const st = get()
    const sel = st.selectedObjects()
    const ids = new Set(sel.map((o) => o.parentGroupId).filter(Boolean))
    const groups = st.groups.filter((g) => ids.has(g.id))
    if (!groups.length) return
    st.apply(cmd.ungroupObjects(groups))
  },

  duplicate() {
    const st = get()
    const sel = st.selectedObjects()
    if (!sel.length) return
    const groupMap = new Map()
    for (const o of sel) {
      if (o.parentGroupId && !groupMap.has(o.parentGroupId)) groupMap.set(o.parentGroupId, uid())
    }
    const clones = sel.map((o) => ({
      ...o,
      id: uid(),
      position: [o.position[0] + 0.5, o.position[1], o.position[2] + 0.5],
      parentGroupId: o.parentGroupId ? groupMap.get(o.parentGroupId) : null,
    }))
    const newGroups = [...groupMap.values()].map((gid) => ({
      id: gid,
      memberIds: clones.filter((c) => c.parentGroupId === gid).map((c) => c.id),
    }))
    st.apply(cmd.addObjects(clones, newGroups, 'copy'))
    set({ selectedIds: clones.map((c) => c.id) })
  },

  deleteSelection() {
    const st = get()
    const sel = st.selectedObjects()
    if (!sel.length) return
    const removing = new Set(sel.map((o) => o.id))
    const deadGroups = st.groups.filter((g) => g.memberIds.every((id) => removing.has(id)))
    st.apply(cmd.deleteObjects(sel, deadGroups))
    set({ selectedIds: [] })
  },

  // ---------------------------------------------------------- lifetime --

  /** Replace the whole scene (undoable), e.g. loading a saved build. */
  loadScene(scene, label = 'load') {
    const st = get()
    const before = st.slice()
    const after = {
      objects: scene.objects ?? [],
      groups: scene.groups ?? [],
      variables: sanitizeVariables(scene.variables),
    }
    st.apply(cmd.replaceScene(before, after, label))
    set({ selectedIds: [] })
  },

  newScene() {
    get().loadScene(emptyScene(), 'new build')
    set({ projectName: '' })
  },

  setProjectName(projectName) {
    set({ projectName })
  },

  /** Plain-JSON snapshot — this is exactly what gets persisted and exported. */
  serialize(createdAt) {
    const st = get()
    const now = new Date().toISOString()
    return {
      version: SCENE_VERSION,
      objects: st.objects,
      groups: st.groups,
      variables: st.variables,
      createdAt: createdAt ?? now,
      updatedAt: now,
    }
  },
}))

const variableMap = (variables) => new Map(variables.map((v) => [v.id, v]))

/**
 * Normalize a parameter set with the object's bindings laid back on top. Any
 * write to `params` goes through this, so a bound parameter can't be talked
 * out of its variable's value by a stray edit somewhere else.
 */
function settle(object, raw, byId) {
  let merged = raw
  for (const key in object.bindings ?? {}) {
    const variable = byId.get(object.bindings[key])
    if (!variable) continue
    if (merged === raw) merged = { ...raw }
    merged[key] = variable.value
  }
  return normalizeParams(object.type, merged)
}

const sameParams = (a = {}, b = {}) => {
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every((k) => a[k] === b[k])
}

const same = (a = [], b = []) =>
  Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6 && Math.abs(a[2] - b[2]) < 1e-6
