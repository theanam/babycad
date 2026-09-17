import { create } from 'zustand'
import * as cmd from '../history/undoRedo'
import { MAX_HISTORY, SCENE_VERSION, SHAPE_COLOR } from '../constants'
import { restingHeight } from './geometry'

const uid = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36)

export function makeObject(type, position = [0, 0, 0], color) {
  return {
    id: uid(),
    type,
    position: [position[0], position[1] || restingHeight(type), position[2]],
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

const emptyScene = () => ({ objects: [], groups: [] })

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

  /** Run a command and record it. */
  apply(command) {
    set((st) => {
      const next = command.forward({ objects: st.objects, groups: st.groups })
      return {
        objects: next.objects,
        groups: next.groups,
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
    const next = command.backward({ objects: st.objects, groups: st.groups })
    const alive = new Set(next.objects.map((o) => o.id))
    set({
      objects: next.objects,
      groups: next.groups,
      past: st.past.slice(0, -1),
      future: [command, ...st.future],
      selectedIds: st.selectedIds.filter((id) => alive.has(id)),
    })
  },

  redo() {
    const st = get()
    const command = st.future[0]
    if (!command) return
    const next = command.forward({ objects: st.objects, groups: st.groups })
    const alive = new Set(next.objects.map((o) => o.id))
    set({
      objects: next.objects,
      groups: next.groups,
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

  addShape(type, position) {
    const obj = makeObject(type, position)
    get().apply(cmd.addObjects([obj]))
    set({ selectedIds: [obj.id] })
    return obj
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
    const before = { objects: st.objects, groups: st.groups }
    const after = { objects: scene.objects ?? [], groups: scene.groups ?? [] }
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
      createdAt: createdAt ?? now,
      updatedAt: now,
    }
  },
}))

const same = (a = [], b = []) =>
  Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6 && Math.abs(a[2] - b[2]) < 1e-6
