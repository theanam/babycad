import { create } from 'zustand'
import * as THREE from 'three'
import * as cmd from '../history/undoRedo'
import { FOOTPRINT, MAX_HISTORY, SCENE_VERSION } from '../constants'
import { defaultParams, normalizeParams, SHAPE_COLOR } from '../shapes'
import { resizeToParams } from '../shapes/resize'
import { measure, restingHeight } from '../shapes/geometryCache'
import { alignOffsets } from './align'
import { meshes } from './meshRegistry'
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
    hole: false, // a hole cuts the solids it is combined with — see shapes/csg
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
  snapEnabled: true, // grid snapping, on by default
  freeMove: false, // Alt held: temporarily ignore the snap grid
  aligning: false, // the align targets are showing instead of the box handles
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
    if (st.aligning) set({ aligning: false })
    if (!id) return set({ selectedIds: [] })
    let base = additive ? st.selectedIds : []
    if (additive && st.selectedIds.includes(id)) {
      // Toggling off removes the whole group the block belongs to.
      const drop = new Set(expandSelection([id], st.objects))
      base = st.selectedIds.filter((x) => !drop.has(x))
      return set({ selectedIds: base })
    }
    set({ selectedIds: expandSelection([...base, id], st.objects) })
  },

  setSelection(ids) {
    set({ selectedIds: expandSelection(ids, get().objects), aligning: false })
  },

  clearSelection() {
    set({ selectedIds: [], aligning: false })
  },

  selectAll() {
    const st = get()
    if (!st.objects.length) return false
    set({ selectedIds: st.objects.map((o) => o.id), aligning: false })
    return true
  },

  /**
   * Show the align targets instead of the box handles. They are a mode rather
   * than more handles on the box because the box has no free side left: the
   * turn levers already reach out along +X, −X and +Z, which is exactly where
   * an align target wants to sit to be visible.
   */
  toggleAlign() {
    set((st) => ({ aligning: !st.aligning && st.selectedIds.length > 1 }))
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
        objects: st.objects.map((o) => {
          if (!patch[o.id]) return o
          const params = settle(o, { ...o.params, ...patch[o.id] }, byId)
          return { ...o, params, position: reseated(o, params) }
        }),
      }
    })
  },

  /**
   * Close out a slider drag: diff against the snapshot taken when it started.
   * `before` holds `{ params, position }` per block, since a height change
   * moves the block as well as reshaping it.
   */
  commitParams(before, label = 'reshape') {
    const st = get()
    const patches = []
    for (const o of st.objects) {
      const was = before[o.id]
      if (!was || (sameParams(was.params, o.params) && same(was.position, o.position))) continue
      patches.push({ id: o.id, before: was, after: { params: o.params, position: o.position } })
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
      const params = settle(o, { ...o.params, ...patch[o.id] }, byId)
      if (sameParams(o.params, params)) continue
      patches.push({
        id: o.id,
        before: { params: o.params, position: o.position },
        after: { params, position: reseated(o, params) },
      })
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

  /**
   * Close out a drag: diff against the snapshot taken when it started.
   *
   * A resize is the interesting one. The drag painted a `scale` multiplier
   * onto the mesh because that is cheap to redo every frame — but a multiplier
   * sitting on top of the shape's millimetres would leave a cube that is
   * plainly 40 mm wide still reporting a Width of 20. So on release the
   * multiplier is folded back into the shape's own numbers wherever the shape
   * can express it (see shapes/resize) and `scale` goes back where it was.
   * Nothing moves on screen: the geometry comes out the size the multiplier
   * was showing, and the block and the rail finally agree.
   *
   * Returns the parameters it had to refuse, so the caller can say why.
   */
  commitTransform(before, label = 'move') {
    const st = get()
    const patches = []
    const reverts = {}
    const blocked = new Set()
    let baked = false

    for (const o of st.objects) {
      const b = before[o.id]
      if (!b) continue
      const was = { position: b.position, rotation: b.rotation, scale: b.scale }
      const now = { position: o.position, rotation: o.rotation, scale: o.scale }
      if (same(was.position, now.position) && same(was.rotation, now.rotation) && same(was.scale, now.scale)) {
        continue
      }

      const fold = bakeResize(o, was, now)
      if (fold.blocked) {
        // The drag is already staged on screen, so refusing it means putting
        // the block back rather than simply declining to record anything.
        blocked.add(fold.blocked)
        reverts[o.id] = was
        continue
      }
      if (fold.undoParams) {
        was.params = fold.undoParams
        baked = true
      }
      patches.push({ id: o.id, before: was, after: fold.after })
    }

    if (Object.keys(reverts).length) {
      set((s) => ({
        objects: s.objects.map((o) => (reverts[o.id] ? { ...o, ...reverts[o.id] } : o)),
      }))
    }
    if (patches.length) {
      const command = cmd.transformObjects(patches, label)
      // A baked resize rewrites what is already staged, so its command has to
      // be *run*; a plain move is only recorded, since the move already
      // happened on the way in.
      if (baked) st.apply(command)
      else st.record(command)
    }
    return [...blocked]
  },

  /**
   * Discrete transform from the panel steppers. Resizes are folded into the
   * shape's numbers here too, so typing a size in the rail and dragging a
   * corner in the yard land in exactly the same place.
   */
  transformSelection(fn, label) {
    const st = get()
    const sel = st.selectedObjects()
    if (!sel.length) return []
    const patches = []
    const blocked = new Set()
    for (const o of sel) {
      const was = { position: o.position, rotation: o.rotation, scale: o.scale }
      const fold = bakeResize(o, was, fn(o))
      if (fold.blocked) {
        blocked.add(fold.blocked)
        continue
      }
      if (fold.undoParams) was.params = fold.undoParams
      patches.push({ id: o.id, before: was, after: fold.after })
    }
    if (patches.length) st.apply(cmd.transformObjects(patches, label))
    return [...blocked]
  },

  /**
   * Bring the selection into line on one axis — see scene/align. Each group
   * travels as a unit, so an aligned selection keeps whatever was combined
   * inside it.
   */
  alignSelection(slot, mode) {
    const st = get()
    const sel = st.selectedObjects()
    if (sel.length < 2) return false
    const offsets = alignOffsets(sel, meshes, slot, mode)
    if (!offsets.size) return false

    const patches = []
    for (const o of sel) {
      const delta = offsets.get(o.id)
      if (delta === undefined) continue
      const position = [...o.position]
      position[slot] += delta
      patches.push({
        id: o.id,
        before: { position: o.position, rotation: o.rotation, scale: o.scale },
        after: { position, rotation: o.rotation, scale: o.scale },
      })
    }
    if (!patches.length) return false
    st.apply(cmd.transformObjects(patches, 'align'))
    return true
  },

  /**
   * Turn the selection into holes, or back into solids. A hole only cuts once
   * it is combined with something, so this reports whether any of what it just
   * changed is still sitting on its own, for the rail to say so.
   */
  setHole(hole) {
    const st = get()
    const sel = st.selectedObjects().filter((o) => Boolean(o.hole) !== hole)
    if (!sel.length) return
    st.apply(cmd.markHoles(sel.map((o) => ({ id: o.id, before: Boolean(o.hole), after: hole }))))
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
      position: [o.position[0] + FOOTPRINT / 2, o.position[1], o.position[2] + FOOTPRINT / 2],
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

/**
 * Fold a change in `scale` into the shape's own parameters, so a block never
 * holds two different answers to how big it is.
 *
 * Returns the transform to store — with `params` written and `scale` put back
 * when the shape could express the resize, and untouched when it couldn't —
 * alongside the parameters undo has to restore, and the label of any parameter
 * that had to be refused because it follows a variable.
 */
function bakeResize(object, was, now) {
  if (same(was.scale, now.scale)) return { after: now }

  const ratio = [0, 1, 2].map((i) => (was.scale[i] ? now.scale[i] / was.scale[i] : 1))
  const resize = resizeToParams(object, ratio)
  if (resize?.blocked) return { blocked: resize.blocked }
  if (!resize?.params) return { after: now } // not expressible; the multiplier stands

  return {
    after: { ...now, params: resize.params, scale: was.scale },
    // Only `scale` moved on the way in, so the object is still holding the
    // parameters this resize replaces — those are what undo puts back.
    undoParams: object.params,
  }
}

/**
 * Where a block's underside is, relative to its own position, once its
 * geometry has been turned and stretched the way the block is. The eight
 * corners of the shape's box go through the block's rotation and scale, and
 * the lowest one is the answer.
 */
const _q = new THREE.Quaternion()
const _e = new THREE.Euler()
const _v = new THREE.Vector3()
function bottomOf(object, params) {
  const { min, max } = measure(object.type, params)
  _q.setFromEuler(_e.fromArray(object.rotation))
  let lowest = Infinity
  for (const x of [min.x, max.x]) {
    for (const y of [min.y, max.y]) {
      for (const z of [min.z, max.z]) {
        _v.set(x * object.scale[0], y * object.scale[1], z * object.scale[2]).applyQuaternion(_q)
        if (_v.y < lowest) lowest = _v.y
      }
    }
  }
  return lowest
}

/**
 * The position a block should take with `params` so that its underside stays
 * exactly where it is. Everything in this app rests on the plate and the
 * gizmo grows blocks up from the floor; typing a bigger height into the rail
 * used to grow the block about its middle instead, sinking half the change
 * through the plate. This is the same rule applied to the rail.
 */
function reseated(object, params) {
  const shift = bottomOf(object, object.params) - bottomOf(object, params)
  if (Math.abs(shift) < 1e-9) return object.position
  const position = [...object.position]
  position[1] += shift
  return position
}

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
