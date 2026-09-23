/**
 * The session cache, and nothing else.
 *
 * Builds used to live in this browser's localStorage under names, which made
 * the browser look like a filing cabinet it is not: clear your site data and
 * the cabinet is empty. Builds are files on disk now (see io/files); what is
 * left here is a cache of the tabs you had open, so a refresh or a closed
 * laptop doesn't cost you the afternoon. It is a safety net under the file,
 * never the place the file lives.
 */
import { SCENE_VERSION } from '../constants'
import { getShapeDef, normalizeParams } from '../shapes'
import { adoptMeshes, meshesFor } from '../shapes/meshStore'
import { resolvePatches, sanitizeVariables } from '../scene/variables'

const SESSION_KEY = 'babycad.session.v1'

// Where builds used to be kept, back when the app had a library of its own.
// Read once, to hand them back as tabs, and then left alone.
const LEGACY_PROJECTS_KEY = 'babycad.projects.v1'
const LEGACY_AUTOSAVE_KEY = 'babycad.autosave.v1'
const LEGACY_TAKEN_KEY = 'babycad.projects.rescued.v1'

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    // Quota exceeded, or storage blocked (private mode / disabled cookies).
    return false
  }
}

export function isStorageAvailable() {
  try {
    const probe = '__babycad__'
    localStorage.setItem(probe, '1')
    localStorage.removeItem(probe)
    return true
  } catch {
    return false
  }
}

/* ------------------------------------------------------------- session -- */

/** Keep the open tabs across an accidental refresh. */
export function writeSession(snapshot) {
  writeJSON(SESSION_KEY, snapshot)
}

/** The tabs from last time, each build brought up to the current schema. */
export function readSession() {
  const saved = readJSON(SESSION_KEY, null)
  const docs = (saved?.docs ?? [])
    .map((d) => ({ ...d, scene: migrate(d.scene) }))
    .filter((d) => d.scene)
  if (!docs.length) return null
  return { activeId: saved.activeId, docs }
}

/**
 * The builds from the old in-browser library, handed over once so they can be
 * opened as tabs and saved somewhere real. They are not deleted: the key is
 * simply never read again, which costs a few kilobytes and means a mistake
 * here isn't the kind you can't take back.
 */
export function takeLegacyProjects() {
  try {
    if (localStorage.getItem(LEGACY_TAKEN_KEY)) return []
    localStorage.setItem(LEGACY_TAKEN_KEY, new Date().toISOString())
    const all = readJSON(LEGACY_PROJECTS_KEY, {})
    return Object.entries(all)
      .map(([name, entry]) => ({ name, scene: migrate(entry?.scene) }))
      .filter((p) => p.scene?.objects?.length)
      .slice(0, 12)
  } catch {
    return []
  }
}

/** The single build the old autosave held, if this is the first run since. */
export function takeLegacyAutosave() {
  const scene = readJSON(LEGACY_AUTOSAVE_KEY, null)
  return scene ? migrate(scene) : null
}

/**
 * Bring an older scene up to the current schema.
 *
 * v1 scenes have no `params` at all. `normalizeParams` fills in the shape's
 * defaults, which are precisely the fixed geometry v1 drew — so an old build
 * reopens looking identical, and is editable from there. It also clamps and
 * type-checks every value, so a hand-edited or truncated file can't reach a
 * builder with a tooth count of `"lots"`.
 *
 * v2 scenes have no variables, which is just an empty list. The one thing
 * worth care is a *binding* pointing at a variable that isn't in the file:
 * `resolvePatches` prunes those, and then the parameters it re-resolves are
 * exactly the plain numbers already stored, so a half-edited file degrades to
 * unlinked values rather than to a crash.
 */
export function migrate(scene) {
  if (!scene || typeof scene !== 'object') return null
  // Imported models travel inside the file (v6 and up). They go back into the
  // store before anything is built, so a block that refers to one finds it
  // there rather than coming up empty on the first frame. Nothing to adopt is
  // the normal case: only a build with an import in it carries any.
  adoptMeshes(scene.meshes)
  const rawObjects = Array.isArray(scene.objects) ? scene.objects : []
  const variables = sanitizeVariables(scene.variables)
  const known = new Set(variables.map((v) => v.id))

  // Pre-v4 builds were drawn in world units, where a cube was 1 across; the
  // world is millimetres now and that same cube is 20. Scaling on the way in
  // is what keeps an old build the size it looks, rather than a speck in the
  // corner of a plate that grew twenty times around it.
  const legacy = !(Number(scene.version) >= 4)
  if (legacy) scaleVariablesToMm(variables, rawObjects)

  const objects = rawObjects
    // A type this build doesn't know (a scene from a newer version) is kept
    // rather than dropped; it falls back to a cube instead of vanishing.
    .filter((o) => o && typeof o.id === 'string' && typeof o.type === 'string')
    .map((o) => ({
      id: o.id,
      type: o.type,
      params: normalizeParams(o.type, legacy ? paramsToMm(o.type, o.params) : o.params),
      bindings: bindingsOf(o.bindings, known),
      position: scaleTriple(triple(o.position, [0, 0.5 * MM, 0]), legacy ? MM : 1),
      rotation: triple(o.rotation, [0, 0, 0]),
      scale: triple(o.scale, [1, 1, 1]),
      color: typeof o.color === 'string' ? o.color : '#FFC93D',
      // Anything older than v5 predates holes, so `hole` is simply absent and
      // every block comes back solid — which is what it was.
      hole: o.hole === true,
      parentGroupId: o.parentGroupId ?? null,
    }))

  // Apply the variables, so a file whose stored values disagree with its
  // variables (hand-edited, or written by a crash mid-drag) comes back in
  // agreement rather than showing one number and exporting another.
  const settled = [...objects]
  for (const patch of resolvePatches(objects, variables)) {
    const at = settled.findIndex((o) => o.id === patch.id)
    if (at !== -1) settled[at] = { ...settled[at], ...patch.after }
  }

  return {
    version: SCENE_VERSION,
    objects: settled,
    // Only the models this build actually uses, so deleting an imported block
    // and saving does not keep carrying its triangles around forever.
    meshes: meshesFor(settled),
    groups: (Array.isArray(scene.groups) ? scene.groups : []).filter(
      (g) => g && typeof g.id === 'string' && Array.isArray(g.memberIds)
    ),
    variables,
    createdAt: scene.createdAt ?? new Date().toISOString(),
    updatedAt: scene.updatedAt ?? new Date().toISOString(),
  }
}

/* ------------------------------------------------- v3 -> v4: millimetres -- */

const MM = 20

/**
 * Multiply the lengths in one shape's stored parameters, and only those: a
 * gear's tooth *count* and a sweep in degrees mean the same thing at any
 * scale, and multiplying them would turn a 16-tooth gear into a 320-tooth
 * one. `length: true` on the spec is what says a number is a length; see the
 * `size` helper in shapes/index.js.
 */
function paramsToMm(type, raw) {
  if (!raw || typeof raw !== 'object') return raw
  const specs = getShapeDef(type)?.params
  if (!specs) return raw
  const out = { ...raw }
  for (const spec of specs) {
    if (spec.length && Number.isFinite(out[spec.key])) out[spec.key] *= MM
  }
  return out
}

/**
 * A variable is scaled only if every parameter following it is a length. One
 * driving a radius here and a tooth count there has no single right answer —
 * it was already a strange thing to build — and leaving it alone keeps the
 * tooth count right, which is the half a kid is more likely to notice.
 */
function scaleVariablesToMm(variables, rawObjects) {
  const allLengths = new Map()
  for (const o of rawObjects) {
    const specs = getShapeDef(o?.type)?.params
    if (!specs || !o?.bindings) continue
    for (const [key, id] of Object.entries(o.bindings)) {
      const isLength = specs.find((spec) => spec.key === key)?.length === true
      allLengths.set(id, (allLengths.get(id) ?? true) && isLength)
    }
  }
  for (const v of variables) {
    if (v.kind === 'number' && allLengths.get(v.id) && Number.isFinite(v.value)) v.value *= MM
  }
}

const scaleTriple = (t, by) => (by === 1 ? t : t.map((n) => n * by))

const bindingsOf = (raw, known) => {
  if (!raw || typeof raw !== 'object') return null
  const kept = {}
  for (const key of Object.keys(raw)) {
    if (typeof raw[key] === 'string' && known.has(raw[key])) kept[key] = raw[key]
  }
  return Object.keys(kept).length ? kept : null
}

const triple = (v, fallback) =>
  Array.isArray(v) && v.length === 3 && v.every((n) => Number.isFinite(n)) ? [...v] : [...fallback]
