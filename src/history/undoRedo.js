/**
 * Command-pattern history.
 *
 * A command is a pair of pure functions over the scene slice
 * `{ objects, groups }`. Each factory captures everything needed to run the
 * change and to run its exact inverse, so undo never has to guess.
 *
 *   cmd = { label, forward(scene) -> scene, backward(scene) -> scene }
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
export function addObjects(added, addedGroups = [], label) {
  const ids = added.map((o) => o.id)
  const groupIds = addedGroups.map((g) => g.id)
  return {
    label: label ?? (added.length > 1 ? `add ${added.length} blocks` : 'add block'),
    forward: (s) => ({
      objects: [...s.objects, ...added],
      groups: [...s.groups, ...addedGroups],
    }),
    backward: (s) => ({
      objects: withoutIds(s.objects, ids),
      groups: s.groups.filter((g) => !groupIds.includes(g.id)),
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
      objects: withoutIds(s.objects, objIds),
      groups: s.groups.filter((g) => !groupIds.includes(g.id)),
    }),
    backward: (s) => ({
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
export function combineObjects(group, prevParents) {
  const stamp = Object.fromEntries(group.memberIds.map((id) => [id, { parentGroupId: group.id }]))
  const restore = Object.fromEntries(
    Object.entries(prevParents).map(([id, parentGroupId]) => [id, { parentGroupId }])
  )
  const absorbedIds = Object.values(prevParents).filter(Boolean)
  return {
    label: 'combine',
    forward: (s) => ({
      objects: patchObjects(s.objects, stamp),
      // A group fully absorbed into the new one stops existing.
      groups: [...s.groups.filter((g) => !absorbedIds.includes(g.id)), group],
    }),
    backward: (s) => ({
      objects: patchObjects(s.objects, restore),
      groups: s.groups.filter((g) => g.id !== group.id),
    }),
  }
}

/** Split a group apart. Inverse re-creates the groups and re-stamps members. */
export function ungroupObjects(groups) {
  const groupIds = groups.map((g) => g.id)
  const clear = {}
  const restore = {}
  for (const g of groups) {
    for (const id of g.memberIds) {
      clear[id] = { parentGroupId: null }
      restore[id] = { parentGroupId: g.id }
    }
  }
  return {
    label: 'split apart',
    forward: (s) => ({
      objects: patchObjects(s.objects, clear),
      groups: s.groups.filter((g) => !groupIds.includes(g.id)),
    }),
    backward: (s) => ({
      objects: patchObjects(s.objects, restore),
      groups: [...s.groups, ...groups],
    }),
  }
}

/** Wholesale scene replacement (load / clear). Inverse restores the old scene. */
export function replaceScene(before, after, label = 'load') {
  return {
    label,
    forward: () => ({ objects: after.objects, groups: after.groups }),
    backward: () => ({ objects: before.objects, groups: before.groups }),
  }
}
