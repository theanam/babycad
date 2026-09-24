/**
 * Command-pattern history.
 *
 * A command is a pair of pure functions over the scene slice
 * `{ objects, groups, variables }`. Each factory captures everything needed to
 * run the change and to run its exact inverse, so undo never has to guess.
 *
 *   cmd = { label, forward(scene) -> scene, backward(scene) -> scene }
 *
 * Every command must return the *whole* slice. Spread `...s` unless you mean
 * to replace a part of it — a command that returns only `{ objects, groups }`
 * silently wipes the variables.
 *
 * The stack itself lives in the scene store (see sceneStore.js); this module
 * only knows how to build and invert commands.
 */

const withoutIds = (objects, ids) => {
  const drop = new Set(ids)
  return objects.filter((o) => !drop.has(o.id))
}

const patchObjects = (objects, byId) =>
  objects.map((o) => (byId[o.id] ? { ...o, ...byId[o.id] } : o))

/** Add objects (and optionally the groups they belong to). Inverse removes both. */
export function addObjects(added, addedGroups = [], label, addedVariables = []) {
  const ids = added.map((o) => o.id)
  const groupIds = addedGroups.map((g) => g.id)
  // Pasted blocks can bring variables with them. They are part of the same
  // step, so undoing the paste has to take them away again — a stack of
  // orphaned numbers left behind by an undone paste is its own little mess.
  const variableIds = addedVariables.map((v) => v.id)
  return {
    label: label ?? (added.length > 1 ? `add ${added.length} blocks` : 'add block'),
    forward: (s) => ({
      ...s,
      objects: [...s.objects, ...added],
      groups: [...s.groups, ...addedGroups],
      variables: [...s.variables, ...addedVariables],
    }),
    backward: (s) => ({
      ...s,
      objects: withoutIds(s.objects, ids),
      groups: s.groups.filter((g) => !groupIds.includes(g.id)),
      variables: s.variables.filter((v) => !variableIds.includes(v.id)),
    }),
  }
}

/**
 * Delete objects (and any groups left empty by the deletion). The inverse
 * puts both back, which is why we capture the removed groups too.
 */
export function deleteObjects(removedObjects, removedGroups = []) {
  const objIds = removedObjects.map((o) => o.id)
  const groupIds = removedGroups.map((g) => g.id)
  return {
    label: 'delete',
    forward: (s) => ({
      ...s,
      objects: withoutIds(s.objects, objIds),
      groups: s.groups.filter((g) => !groupIds.includes(g.id)),
    }),
    backward: (s) => ({
      ...s,
      objects: [...s.objects, ...removedObjects],
      groups: [...s.groups, ...removedGroups],
    }),
  }
}

/**
 * Transform commit. `patches` is [{ id, before, after }] where before/after
 * hold whichever of position/rotation/scale actually moved.
 */
export function transformObjects(patches, label = 'move') {
  const after = Object.fromEntries(patches.map((p) => [p.id, p.after]))
  const before = Object.fromEntries(patches.map((p) => [p.id, p.before]))
  return {
    label,
    forward: (s) => ({ ...s, objects: patchObjects(s.objects, after) }),
    backward: (s) => ({ ...s, objects: patchObjects(s.objects, before) }),
  }
}

/**
 * Shape parameter edit. `patches` is [{ id, before, after }] where each side
 * is `{ params, position }`: the whole parameter set, not a delta, so undo
 * restores exactly the shape that was there even if the edit touched several
 * fields at once — and the position, because changing a height moves the
 * block to keep its underside where it was (see sceneStore's `reseated`).
 */
export function reshapeObjects(patches, label = 'reshape') {
  const after = Object.fromEntries(patches.map((p) => [p.id, { ...p.after }]))
  const before = Object.fromEntries(patches.map((p) => [p.id, { ...p.before }]))
  return {
    label,
    forward: (s) => ({ ...s, objects: patchObjects(s.objects, after) }),
    backward: (s) => ({ ...s, objects: patchObjects(s.objects, before) }),
  }
}

/** Solid <-> hole. `patches` is [{ id, before, after }] of booleans. */
export function markHoles(patches) {
  const after = Object.fromEntries(patches.map((p) => [p.id, { hole: p.after }]))
  const before = Object.fromEntries(patches.map((p) => [p.id, { hole: p.before }]))
  return {
    label: patches[0]?.after ? 'make a hole' : 'make it solid',
    forward: (s) => ({ ...s, objects: patchObjects(s.objects, after) }),
    backward: (s) => ({ ...s, objects: patchObjects(s.objects, before) }),
  }
}

/** Lock or unlock. `patches` is [{ id, before, after }] of booleans. */
export function markLocked(patches) {
  const after = Object.fromEntries(patches.map((p) => [p.id, { locked: p.after }]))
  const before = Object.fromEntries(patches.map((p) => [p.id, { locked: p.before }]))
  return {
    label: patches[0]?.after ? 'lock' : 'unlock',
    forward: (s) => ({ ...s, objects: patchObjects(s.objects, after) }),
    backward: (s) => ({ ...s, objects: patchObjects(s.objects, before) }),
  }
}

/** Recolor. `patches` is [{ id, before, after }] of hex strings. */
export function recolorObjects(patches) {
  const after = Object.fromEntries(patches.map((p) => [p.id, { color: p.after }]))
  const before = Object.fromEntries(patches.map((p) => [p.id, { color: p.before }]))
  return {
    label: 'recolor',
    forward: (s) => ({ ...s, objects: patchObjects(s.objects, after) }),
    backward: (s) => ({ ...s, objects: patchObjects(s.objects, before) }),
  }
}

/**
 * Combine into a group. Members may already belong to other groups, so we
 * capture each member's previous parent to restore on undo.
 */
/**
 * @param prev `{ id: { parentGroupId, color } }` — what each member was before,
 *   so undo puts back both the grouping *and* the colour it overwrote.
 * @param color the one colour the combined parts take, or null to leave them.
 */
/**
 * @param prev `{ id: { parentGroupId, color } }` — what each block was before.
 * @param color the one colour the combined parts take, or null to leave them.
 * @param loose ids of the blocks that were not in a group, which are the only
 *   ones whose parent changes; anything already in a group keeps pointing at
 *   it, and that group is what now points at this one.
 * @param childGroupIds groups folded into this one as units. They survive —
 *   that is what makes combining have levels — and are handed back by a split.
 */
export function combineObjects(group, prev, color, loose = [], childGroupIds = []) {
  const stamp = {}
  for (const id of group.memberIds) {
    // A colour for everything underneath; a new parent only for the loose.
    const patch = {}
    if (color) patch.color = color
    if (loose.includes(id)) patch.parentGroupId = group.id
    if (Object.keys(patch).length) stamp[id] = patch
  }
  const restore = Object.fromEntries(
    Object.entries(prev).map(([id, was]) => [id, { parentGroupId: was.parentGroupId, color: was.color }])
  )
  const adopt = (groups) =>
    groups.map((g) => (childGroupIds.includes(g.id) ? { ...g, parentGroupId: group.id } : g))
  const orphan = (groups) =>
    groups.map((g) => (childGroupIds.includes(g.id) ? { ...g, parentGroupId: null } : g))
  return {
    label: 'combine',
    forward: (s) => ({
      ...s,
      objects: patchObjects(s.objects, stamp),
      groups: [...adopt(s.groups), group],
    }),
    backward: (s) => ({
      ...s,
      objects: patchObjects(s.objects, restore),
      groups: orphan(s.groups.filter((g) => g.id !== group.id)),
    }),
  }
}

/** Split a group apart. Inverse re-creates the groups and re-stamps members. */
/**
 * Split groups apart, giving each part the colour it had before it was
 * combined.
 *
 * Combining paints the parts one colour, so splitting has to be able to undo
 * that — otherwise a thing taken apart is a heap of identically coloured
 * blocks and the build is no longer readable. The colours are carried on the
 * group itself, written there when it was made: the group is the only thing
 * that knows what it absorbed, and it is saved with the build, so a build
 * opened next week still comes apart into its own colours.
 *
 * A group with no record of them — one made before this, or one an example
 * declared — leaves the colours alone rather than inventing any.
 */
/** Is this block inside one of the group's child groups, rather than in it? */
function insideAChild(id, group, allGroups) {
  for (const childId of group.childGroupIds ?? []) {
    const child = allGroups.find((g) => g.id === childId)
    if (child?.memberIds?.includes(id)) return true
  }
  return false
}

export function ungroupObjects(groups, allGroups = []) {
  const groupIds = groups.map((g) => g.id)
  const clear = {}
  const restore = {}
  // Only the blocks that sat directly in the group being removed lose their
  // parent. Ones inside a child group keep it — the child is what comes out as
  // an object in its own right.
  const directly = (g) => g.memberIds.filter((id) => !insideAChild(id, g, allGroups))
  for (const g of groups) {
    const direct = new Set(directly(g))
    for (const id of g.memberIds) {
      const was = g.colors?.[id]
      const patch = {}
      if (direct.has(id)) patch.parentGroupId = null
      if (was) patch.color = was
      if (Object.keys(patch).length) clear[id] = patch
      restore[id] = direct.has(id) ? { parentGroupId: g.id } : {}
    }
  }
  // Putting the group back has to put the one colour back with it.
  for (const g of groups) {
    if (!g.combinedColor) continue
    for (const id of g.memberIds) restore[id] = { ...restore[id], color: g.combinedColor }
  }
  const children = groups.flatMap((g) => g.childGroupIds ?? [])
  const release = (gs) => gs.map((g) => (children.includes(g.id) ? { ...g, parentGroupId: null } : g))
  const reclaim = (gs) =>
    gs.map((g) => {
      const owner = groups.find((x) => (x.childGroupIds ?? []).includes(g.id))
      return owner ? { ...g, parentGroupId: owner.id } : g
    })
  return {
    label: 'split apart',
    forward: (s) => ({
      ...s,
      objects: patchObjects(s.objects, clear),
      groups: release(s.groups.filter((g) => !groupIds.includes(g.id))),
    }),
    backward: (s) => ({
      ...s,
      objects: patchObjects(s.objects, restore),
      groups: [...reclaim(s.groups), ...groups],
    }),
  }
}

/** Wholesale scene replacement (load / clear). Inverse restores the old scene. */
export function replaceScene(before, after, label = 'load') {
  return {
    label,
    forward: () => ({ ...after }),
    backward: () => ({ ...before }),
  }
}

/**
 * Anything that touches the variable list. Changing a variable's value also
 * rewrites the resolved `params` of every object bound to it, so the object
 * patches travel with the variable list in one command — undoing a variable
 * edit has to put the shapes back too, in a single step.
 */
export function editVariables(label, beforeVariables, afterVariables, patches = []) {
  const after = Object.fromEntries(patches.map((p) => [p.id, p.after]))
  const before = Object.fromEntries(patches.map((p) => [p.id, p.before]))
  return {
    label,
    forward: (s) => ({
      ...s,
      variables: afterVariables,
      objects: patchObjects(s.objects, after),
    }),
    backward: (s) => ({
      ...s,
      variables: beforeVariables,
      objects: patchObjects(s.objects, before),
    }),
  }
}
