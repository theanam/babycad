import { create } from 'zustand'
import * as THREE from 'three'
import * as cmd from '../history/undoRedo'
import { FOOTPRINT, MAX_HISTORY, SCENE_VERSION, SNAP_DEFAULT, SNAP_STEPS } from '../constants'
import { groupsAbove, pack, unpack } from './clipboard'
import { adoptMeshes, meshesFor } from '../shapes/meshStore'
import { defaultParams, normalizeParams, SHAPE_COLOR } from '../shapes'
import { resizeToParams } from '../shapes/resize'
import { measure, restingHeight } from '../shapes/geometryCache'
import { alignBounds, alignOffsets } from './align'
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

export function makeObject(type, position = [], color, params) {
  const shapeParams = params ? normalizeParams(type, params) : defaultParams(type)
  return {
    id: uid(),
    type,
    params: shapeParams,
    bindings: null, // { [paramKey]: variableId } once something is linked
    // A height of nothing means "rest it on the plate"; a height of zero means
    // zero. This was `||`, which cannot tell those apart — so a block asked for
    // at exactly y = 0 was quietly lifted to its resting height instead, and
    // the only way to place one there was to ask for 0.0001. It cost the
    // underside of the dice its pips: six cutters meant to sit in the bottom
    // face were stood up on the plate, cutting nothing.
    position: [
      position[0] ?? 0,
      position[1] ?? restingHeight(type, shapeParams),
      position[2] ?? 0,
    ],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    color: color ?? SHAPE_COLOR[type] ?? '#FFC93D',
    hole: false, // a hole cuts the solids it is combined with — see shapes/csg
    parentGroupId: null,
  }
}

/** Selecting any member of a group selects the whole group. */
/**
 * Groups nest, and a group knows its parent.
 *
 * Combining two things that are already combined makes an outer group holding
 * the inner ones, rather than dissolving them into one flat heap — so a build
 * keeps the structure it was assembled with, and Split apart takes the last
 * step back instead of every step at once.
 *
 * An object always points at its *innermost* group; a group points at the one
 * it was folded into. Everything that asks "what am I picking up when I click
 * this" walks that chain to the top.
 */
export const rootGroupId = (groupId, groups) => {
  const byId = groups instanceof Map ? groups : new Map(groups.map((g) => [g.id, g]))
  let g = byId.get(groupId)
  let guard = 0
  // A file hand-edited into a cycle would otherwise spin here forever.
  while (g?.parentGroupId && byId.get(g.parentGroupId) && guard++ < 64) g = byId.get(g.parentGroupId)
  // A group nobody has heard of is still a group: falling back to the id keeps
  // blocks that name it together, rather than scattering them into singletons
  // because the list of groups was not to hand.
  return g?.id ?? groupId
}

/** The outermost thing a block belongs to: its top group, or itself. */
export const rootUnitOf = (object, groups) =>
  (object.parentGroupId && rootGroupId(object.parentGroupId, groups)) || object.id

/** Selecting any member of a group selects everything under its top group. */
export function expandSelection(ids, objects, groups = []) {
  const byId = new Map(objects.map((o) => [o.id, o]))
  const byGroup = new Map(groups.map((g) => [g.id, g]))
  const roots = new Set()
  for (const id of ids) {
    const o = byId.get(id)
    if (o?.parentGroupId) roots.add(rootGroupId(o.parentGroupId, byGroup))
  }
  const out = new Set(ids.filter((id) => byId.has(id)))
  if (roots.size) {
    for (const o of objects) {
      if (o.parentGroupId && roots.has(rootGroupId(o.parentGroupId, byGroup))) out.add(o.id)
    }
  }
  return [...out]
}

/**
 * Copy a set of blocks and the groups above them, with new ids throughout.
 *
 * Both the blocks and the groups are renamed, and every pointer between them
 * is rewritten to match: a block to its group, and — this is the part that was
 * missing — a group to the group it was folded into. Without that last one a
 * duplicated nest came out flat, with the outer combine gone, because only the
 * innermost link was ever remapped.
 *
 * `shift` moves the copies along the floor, and `variableMap` renames the
 * variables the blocks are bound to, which paste needs and duplicate does not.
 */
function cloneUnits(objects, groups, shift = 0, variableMap = null) {
  const groupIds = new Map(groups.map((g) => [g.id, uid()]))
  const rename = (id) => (id && groupIds.get(id)) || null

  const cloned = objects.map((o) => {
    const bindings = o.bindings
      ? Object.fromEntries(
          Object.entries(o.bindings).map(([key, id]) => [key, variableMap?.get(id) ?? id])
        )
      : null
    return {
      ...o,
      id: uid(),
      position: [o.position[0] + shift, o.position[1], o.position[2] + shift],
      parentGroupId: rename(o.parentGroupId),
      ...(bindings ? { bindings } : {}),
    }
  })

  const oldToNew = new Map(objects.map((o, i) => [o.id, cloned[i].id]))
  const clonedGroups = groups.map((g) => ({
    ...g,
    id: groupIds.get(g.id),
    parentGroupId: rename(g.parentGroupId),
    // A group's members can be blocks or other groups, so both namings apply.
    memberIds: (g.memberIds ?? [])
      .map((id) => oldToNew.get(id) ?? groupIds.get(id))
      .filter(Boolean),
  }))
  return { objects: cloned, groups: clonedGroups }
}

/**
 * Align and Mirror are modes, and a mode does not outlive the selection it was
 * opened for.
 *
 * Both replace the box handles for whatever is picked, so a flag left standing
 * after the blocks are gone is a mode with nothing to act on — and it does not
 * stay quiet: it lies in wait for the next thing selected. Turn on Mirror,
 * delete the block, drop a fresh one on the plate, and the new block arrived
 * wearing flip handles nobody asked for.
 *
 * So the flags are settled wherever the selection changes rather than only
 * where a mode is switched: `NO_MODE` for the changes that mean a new job —
 * picking something else, adding a block, loading a build — and `modesAfter`
 * for the ones that merely thin the selection out, like an undo that takes
 * some blocks away, where a mode is kept as long as what is left can still use
 * it. Aligning needs two blocks to line up; mirroring is happy with one.
 */
const NO_MODE = { aligning: false, mirroring: false }
const modesAfter = (st, ids) => ({
  aligning: st.aligning && ids.length > 1,
  mirroring: st.mirroring && ids.length > 0,
})

const emptyScene = () => ({ objects: [], groups: [], variables: [] })

/**
 * How somebody likes to work: the grid, and whether the plate is sticky.
 *
 * Kept for the app rather than in the build, because it is a preference and
 * not a property of the model — two people opening the same file should each
 * get their own. Remembered between visits, so a choice made once is still the
 * choice tomorrow; a browser that refuses storage simply starts on the
 * defaults every time, which is no worse than not remembering.
 */
const PREFS_KEY = 'babycad.snap'

const readPrefs = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null')
    if (!saved || typeof saved !== 'object') return {}
    return {
      snapStep: SNAP_STEPS.some((s) => s.mm === saved.snapStep) ? saved.snapStep : SNAP_DEFAULT,
      snapEnabled: saved.snapEnabled !== false,
      floorSnap: saved.floorSnap !== false,
    }
  } catch {
    return {}
  }
}

const writePrefs = () => {
  try {
    const { snapStep, snapEnabled, floorSnap } = useScene.getState()
    localStorage.setItem(PREFS_KEY, JSON.stringify({ snapStep, snapEnabled, floorSnap }))
  } catch {
    /* private window, storage disabled — the settings just do not persist */
  }
}

export const useScene = create((set, get) => ({
  ...emptyScene(),
  selectedIds: [],
  snapEnabled: true, // grid snapping, on by default
  snapStep: SNAP_DEFAULT, // millimetres a drag snaps to while snapping is on
  // Whether the plate takes a block lowered near it. Separate from the grid,
  // because they answer different questions — one is how fine the work is, the
  // other is whether the floor is sticky — and somebody laying out parts a
  // hair above the plate wants the grid without the floor.
  floorSnap: true,
  ...readPrefs(),
  // The last paste, so pasting the same blocks again steps further along the
  // floor instead of landing on the copy already sitting there.
  pasteRun: null,
  mirroring: false, // the flip handles are showing instead of the box handles
  freeMove: false, // Alt held: temporarily ignore the snap grid
  aligning: false, // the align targets are showing instead of the box handles
  past: [],
  future: [],

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
      ...(() => {
        const ids = st.selectedIds.filter((id) => alive.has(id))
        return { selectedIds: ids, ...modesAfter(st, ids) }
      })(),
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
      ...(() => {
        const ids = st.selectedIds.filter((id) => alive.has(id))
        return { selectedIds: ids, ...modesAfter(st, ids) }
      })(),
    })
  },

  // -------------------------------------------------------- selection --

  select(id, additive = false) {
    const st = get()
    if (!id) return set({ selectedIds: [], ...NO_MODE })
    let base = additive ? st.selectedIds : []
    if (additive && st.selectedIds.includes(id)) {
      // Toggling off removes the whole group the block belongs to.
      const drop = new Set(expandSelection([id], st.objects, st.groups))
      base = st.selectedIds.filter((x) => !drop.has(x))
      return set({ selectedIds: base, ...NO_MODE })
    }
    set({ selectedIds: expandSelection([...base, id], st.objects, st.groups), ...NO_MODE })
  },

  setSelection(ids) {
    set({ selectedIds: expandSelection(ids, get().objects, get().groups), ...NO_MODE })
  },

  clearSelection() {
    set({ selectedIds: [], ...NO_MODE })
  },

  selectAll() {
    const st = get()
    if (!st.objects.length) return false
    set({ selectedIds: st.objects.map((o) => o.id), ...NO_MODE })
    return true
  },

  /**
   * Show the align targets instead of the box handles. They are a mode rather
   * than more handles on the box because the box has no free side left: the
   * turn levers already reach out along +X, −X and +Z, which is exactly where
   * an align target wants to sit to be visible.
   */
  toggleAlign() {
    set((st) => ({ aligning: !st.aligning && st.selectedIds.length > 1, mirroring: false }))
  },

  /**
   * Mirroring needs only one block, unlike aligning, which needs something to
   * line up against. The two replace the box handles, so only one of them can
   * be showing.
   */
  toggleMirror() {
    set((st) => ({ mirroring: !st.mirroring && st.selectedIds.length > 0, aligning: false }))
  },

  setFreeMove(freeMove) {
    set({ freeMove })
  },

  toggleSnap() {
    set((st) => ({ snapEnabled: !st.snapEnabled }))
    writePrefs()
  },

  toggleFloorSnap() {
    set((st) => ({ floorSnap: !st.floorSnap }))
    writePrefs()
  },

  /** Pick a grid to snap to, and snap. `0` is the same as switching it off. */
  setSnapStep(step) {
    set(step > 0 ? { snapStep: step, snapEnabled: true } : { snapEnabled: false })
    writePrefs()
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
    set({ selectedIds: [obj.id], ...NO_MODE })
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
    const offsets = alignOffsets(sel, meshes, slot, mode, st.groups)
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
   * Flip the selection over, through the plane across the middle of it.
   *
   * The whole selection reflects about one plane, so two blocks swap sides and
   * each is flipped where it stands. One block on its own reflects about its
   * own middle, which leaves it exactly where it was — the point of mirroring
   * a single thing is the handedness, not the position.
   *
   * Done as a matrix rather than by negating a number, because a reflection
   * does not commute with a turn: a block lying at forty degrees, flipped,
   * lies at minus forty, and no amount of sign-flipping the stored angles
   * arrives at that on its own. Building each block's transform, reflecting
   * it, and taking it apart again is the one way that is right for every
   * block however it is sitting.
   *
   * What comes back out has a negative number in its scale — that is what a
   * reflection *is*, and there is nowhere else to put it. Three things have to
   * know: the renderer, which flips its winding for a negative determinant by
   * itself; the exporter, which does not, and so reverses the triangles on the
   * way out (see `io/exporters`); and resizing, which reads its own scale back
   * and keeps it.
   */
  mirrorSelection(slot) {
    const st = get()
    const sel = st.selectedObjects()
    if (!sel.length) return false
    const { whole } = alignBounds(sel, meshes, st.groups)
    if (whole.isEmpty()) return false

    const axis = ['x', 'y', 'z'][slot]
    const middle = (whole.min[axis] + whole.max[axis]) / 2

    // Reflect about the plane across the middle: negate the axis, then put the
    // middle back where it was.
    const flip = new THREE.Matrix4().makeScale(
      slot === 0 ? -1 : 1,
      slot === 1 ? -1 : 1,
      slot === 2 ? -1 : 1
    )
    flip.premultiply(
      new THREE.Matrix4().makeTranslation(
        slot === 0 ? 2 * middle : 0,
        slot === 1 ? 2 * middle : 0,
        slot === 2 ? 2 * middle : 0
      )
    )

    const position = new THREE.Vector3()
    const quaternion = new THREE.Quaternion()
    const scale = new THREE.Vector3()
    const euler = new THREE.Euler()
    const matrix = new THREE.Matrix4()

    const patches = sel.map((o) => {
      matrix.compose(
        position.fromArray(o.position),
        quaternion.setFromEuler(euler.fromArray(o.rotation)),
        scale.fromArray(o.scale)
      )
      matrix.premultiply(flip)
      matrix.decompose(position, quaternion, scale)
      euler.setFromQuaternion(quaternion)
      return {
        id: o.id,
        before: { position: o.position, rotation: o.rotation, scale: o.scale },
        after: {
          position: position.toArray(),
          rotation: [euler.x, euler.y, euler.z],
          scale: scale.toArray(),
        },
      }
    })
    st.apply(cmd.transformObjects(patches, 'mirror'))
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

  /**
   * Combine, and make the parts look like one thing.
   *
   * They take the colour of whichever covers the most plate. A thing built out
   * of six colours is six blocks that happen to be touching; once it is one
   * object it should read as one, and the biggest part is the one somebody
   * would name if asked what colour it is.
   *
   * Holes do not get a vote — they are drawn grey whatever colour they carry,
   * so letting one decide would pick a colour nobody can see. They are
   * recoloured along with everything else, so splitting the group apart later
   * does not suddenly produce an odd one out.
   */
  combine() {
    const st = get()
    const ids = st.selectedIds
    if (ids.length < 2) return
    const sel = st.selectedObjects()

    // What is being combined is the *top* things in the selection: a group
    // already made goes in whole, as one child, rather than being dissolved
    // into its parts. That is what gives combining levels — and what lets
    // Split apart take one level back off rather than all of them.
    const units = [...new Set(sel.map((o) => rootUnitOf(o, st.groups)))]
    if (units.length < 2) return
    const childGroupIds = units.filter((id) => st.groups.some((g) => g.id === id))

    const prev = Object.fromEntries(
      sel.map((o) => [o.id, { parentGroupId: o.parentGroupId ?? null, color: o.color }])
    )
    // The group remembers what everything looked like before it existed, so
    // Split apart can hand the colours back — see `ungroupObjects`. It is
    // written into the group rather than kept beside it because the group is
    // what gets saved, and a build should still come apart properly tomorrow.
    const group = {
      id: uid(),
      // Every block underneath, however deep: what deletion and the colours
      // need. `childGroupIds` is what says which of them came in as a unit.
      memberIds: [...ids],
      childGroupIds,
      parentGroupId: null,
      colors: Object.fromEntries(sel.map((o) => [o.id, o.color])),
    }

    const voters = sel.filter((o) => !o.hole)
    const widest = (voters.length ? voters : sel).reduce(
      (best, o) => (footprintOf(o) > footprintOf(best) ? o : best),
      voters[0] ?? sel[0]
    )
    const color = sel.every((o) => o.color === widest.color) ? null : widest.color
    if (color) group.combinedColor = color

    // Only the blocks that were loose get their parent set to the new group;
    // the ones already inside a child group keep pointing at it, and the child
    // group is what now points upward.
    const loose = sel.filter((o) => !o.parentGroupId).map((o) => o.id)
    st.apply(cmd.combineObjects(group, prev, color, loose, childGroupIds))
  },

  /**
   * Take one level of combining off.
   *
   * Only the outermost group goes: whatever was combined before it stays
   * combined, and comes out as its own object again. Splitting all the way
   * down in one go would throw away the structure somebody built, and there
   * would be no way to get it back short of starting over.
   */
  ungroup() {
    const st = get()
    const sel = st.selectedObjects()
    const ids = new Set(
      sel.map((o) => o.parentGroupId && rootGroupId(o.parentGroupId, st.groups)).filter(Boolean)
    )
    const groups = st.groups.filter((g) => ids.has(g.id))
    if (!groups.length) return
    st.apply(cmd.ungroupObjects(groups, st.groups))
  },

  duplicate() {
    const st = get()
    const sel = st.selectedObjects()
    if (!sel.length) return
    const made = cloneUnits(sel, groupsAbove(sel, st.groups), FOOTPRINT / 2)
    st.apply(cmd.addObjects(made.objects, made.groups, 'copy'))
    set({ selectedIds: made.objects.map((o) => o.id), ...NO_MODE })
  },

  /* ------------------------------------------------------- clipboard -- */

  /**
   * The text to put on the clipboard for whatever is selected, or null if
   * nothing is. Putting it there is the caller's job — only a real `copy`
   * event may write to the clipboard, so `App` owns that half.
   */
  copyPayload() {
    const st = get()
    const sel = st.selectedObjects()
    if (!sel.length) return null
    return pack({ objects: sel, groups: st.groups, variables: st.variables })
  },

  /**
   * Put pasted blocks on the plate.
   *
   * Three things have to be settled on the way in:
   *
   *  - **Where.** Blocks pasted into a different build keep the places they
   *    had, so a part lands where it was designed to sit. Pasted back into the
   *    build they came from they would land exactly on top of the originals
   *    and look like nothing happened, so those are stepped aside — and
   *    stepped again each time, so pasting four times gives four blocks rather
   *    than a pile of one.
   *  - **Variables.** A number bound to `wall` should go on meaning `wall` if
   *    the build it arrives in already has one. Matching by name and kind
   *    joins them up; anything unmatched arrives as a new variable of its own
   *    rather than silently losing the link.
   *  - **Imported models.** The triangles live in `shapes/meshStore`, not in
   *    the block, so they are adopted before anything is placed.
   */
  paste(text) {
    const payload = unpack(text)
    if (!payload) return false
    const st = get()

    adoptMeshes(payload.meshes)

    // Variables first: the clones need to know what to point at.
    const byOldVariable = new Map()
    const freshVariables = []
    for (const v of sanitizeVariables(payload.variables)) {
      const match = st.variables.find((existing) => existing.name === v.name && existing.kind === v.kind)
      if (match) {
        byOldVariable.set(v.id, match.id)
        continue
      }
      const made = { ...v, id: uid(), name: uniqueName(v.name, [...st.variables, ...freshVariables]) }
      byOldVariable.set(v.id, made.id)
      freshVariables.push(made)
    }

    // Landing back where it came from? Step it aside, and further each time.
    const here = new Set(st.objects.map((o) => o.id))
    const home = payload.objects.some((o) => here.has(o.id))
    const key = `${payload.objects.map((o) => o.id).join(',')}`
    const times = get().pasteRun?.key === key ? get().pasteRun.times + 1 : 1
    const shift = home ? (FOOTPRINT / 2) * times : 0

    const made = cloneUnits(payload.objects, payload.groups, shift, byOldVariable)
    st.apply(
      cmd.addObjects(
        made.objects,
        made.groups,
        made.objects.length > 1 ? `paste ${made.objects.length} blocks` : 'paste block',
        freshVariables
      )
    )
    set({ selectedIds: made.objects.map((o) => o.id), pasteRun: { key, times }, ...NO_MODE })
    return true
  },

  deleteSelection() {
    const st = get()
    const sel = st.selectedObjects()
    if (!sel.length) return
    const removing = new Set(sel.map((o) => o.id))
    const deadGroups = st.groups.filter((g) => g.memberIds.every((id) => removing.has(id)))
    st.apply(cmd.deleteObjects(sel, deadGroups))
    set({ selectedIds: [], ...NO_MODE })
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
    set({ selectedIds: [], ...NO_MODE })
  },

  /** Plain-JSON snapshot — this is exactly what gets persisted and exported. */
  serialize(createdAt) {
    const st = get()
    const now = new Date().toISOString()
    return {
      version: SCENE_VERSION,
      objects: st.objects,
      // An imported model's triangles are not in the object — see
      // shapes/meshStore — so a saved build has to carry the ones it uses, or
      // it opens with a block that refers to a model nobody has.
      meshes: meshesFor(st.objects),
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
 * the lowest one is the answer. Negative: it is how far below the block's
 * centre the block reaches. The rail uses it to show Z as the height of the
 * underside above the plate, which is what anyone means by "how high is it".
 */
const _q = new THREE.Quaternion()
const _e = new THREE.Euler()
const _v = new THREE.Vector3()
export function bottomOf(object, params = object.params) {
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
 * How much plate a block covers, in square millimetres.
 *
 * The shape's own box, turned and stretched the way the block is, measured
 * across the floor. Not its volume: "footprint" is already what this app calls
 * the floor space a block takes, and a wide flat base is what somebody points
 * at when they say which part a thing mostly *is*.
 */
export function footprintOf(object) {
  const { min, max } = measure(object.type, object.params)
  _q.setFromEuler(_e.fromArray(object.rotation))
  let lowX = Infinity
  let highX = -Infinity
  let lowZ = Infinity
  let highZ = -Infinity
  for (const x of [min.x, max.x]) {
    for (const y of [min.y, max.y]) {
      for (const z of [min.z, max.z]) {
        _v.set(x * object.scale[0], y * object.scale[1], z * object.scale[2]).applyQuaternion(_q)
        if (_v.x < lowX) lowX = _v.x
        if (_v.x > highX) highX = _v.x
        if (_v.z < lowZ) lowZ = _v.z
        if (_v.z > highZ) highZ = _v.z
      }
    }
  }
  return (highX - lowX) * (highZ - lowZ)
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
