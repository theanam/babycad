/**
 * Copy and paste, for blocks.
 *
 * **Why the system clipboard and not a variable in memory.** A variable would
 * be simpler and would only work in one tab. Putting the blocks on the real
 * clipboard means they travel: between builds in this app, between two windows
 * of it, and — because the payload is plain text — into a message or a file,
 * where somebody can send them to somebody else who pastes them straight back
 * onto a plate. It is the cheapest sharing this app will ever have.
 *
 * **Why the paste event and not `navigator.clipboard`.** The async Clipboard
 * API's read needs a permission that Firefox does not give web pages at all
 * and Chrome prompts for. The `copy`/`cut`/`paste` events hand over the same
 * data with no permission anywhere, because the user pressing the keys is the
 * consent. See `App` for the listeners.
 *
 * **What travels with a block.** Not just the block. A copied selection also
 * carries the groups it was combined into — all the way up a nest, so
 * combining survives the round trip — the variables its numbers are bound to,
 * and, for an imported model, the triangles themselves, which live in
 * `shapes/meshStore` rather than in the block. Miss any of those out and what
 * arrives is a block that has forgotten something.
 */
import { SCENE_VERSION } from '../constants'
import { meshesFor } from '../shapes/meshStore'

/** Marks the text as ours. Anything else pasted in is somebody else's text. */
export const CLIPBOARD_KIND = 'babycad/clipboard'

/**
 * Every group in the chain above a set of blocks.
 *
 * A block points at its innermost group and a group points at the one it was
 * folded into, so copying a doubly combined thing means walking up from each
 * block until the chain runs out. Taking only the innermost would paste the
 * pieces with the outer combine quietly dropped.
 */
export function groupsAbove(objects, groups) {
  const byId = new Map(groups.map((g) => [g.id, g]))
  const wanted = new Map()
  for (const o of objects) {
    let id = o.parentGroupId
    let guard = 0
    while (id && byId.has(id) && !wanted.has(id) && guard++ < 64) {
      const group = byId.get(id)
      wanted.set(id, group)
      id = group.parentGroupId
    }
  }
  return [...wanted.values()]
}

/** The variables a set of blocks actually reads. */
export function variablesUsedBy(objects, variables) {
  const wanted = new Set()
  for (const o of objects) {
    for (const id of Object.values(o.bindings ?? {})) wanted.add(id)
  }
  return variables.filter((v) => wanted.has(v.id))
}

/** The text to put on the clipboard for a selection. */
export function pack({ objects, groups, variables }) {
  return JSON.stringify(
    {
      kind: CLIPBOARD_KIND,
      version: SCENE_VERSION,
      objects,
      groups: groupsAbove(objects, groups),
      variables: variablesUsedBy(objects, variables),
      meshes: meshesFor(objects),
    },
    null,
    2
  )
}

/**
 * Read clipboard text back, or null if it was never ours.
 *
 * Deliberately incurious about anything else on the clipboard: a paste that is
 * not BabyCAD's is not an error and not a warning, it is somebody pressing
 * Ctrl-V out of habit and it should do nothing at all.
 */
export function unpack(text) {
  if (typeof text !== 'string' || !text.includes(CLIPBOARD_KIND)) return null
  let data
  try {
    data = JSON.parse(text)
  } catch {
    return null
  }
  if (data?.kind !== CLIPBOARD_KIND || !Array.isArray(data.objects) || !data.objects.length) {
    return null
  }
  return {
    objects: data.objects.filter((o) => o && typeof o.id === 'string' && typeof o.type === 'string'),
    groups: Array.isArray(data.groups) ? data.groups.filter((g) => g && typeof g.id === 'string') : [],
    variables: Array.isArray(data.variables) ? data.variables : [],
    meshes: data.meshes && typeof data.meshes === 'object' ? data.meshes : {},
  }
}
