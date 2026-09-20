/**
 * Local-only persistence. Everything lives in this browser's localStorage —
 * there is no server, no account, and nothing leaves the device.
 */
import { SCENE_VERSION } from '../constants'
import { getShapeDef, normalizeParams } from '../shapes'
import { resolvePatches, sanitizeVariables } from '../scene/variables'

const PROJECTS_KEY = 'babycad.projects.v1'
const AUTOSAVE_KEY = 'babycad.autosave.v1'
const WELCOMED_KEY = 'babycad.welcomed.v1'

// The project was called Blockyard before it was called BabyCAD, and a browser
// that used it still holds its builds under the old keys. Carry them over once,
// on first load, so the rename doesn't look like the builds were deleted. The
// old keys are left in place: copying is cheap, and a half-finished migration
// that has already removed them would lose the builds for good.
;(function adoptLegacyKeys() {
  try {
    for (const [now, before] of [
      [PROJECTS_KEY, 'blockyard.projects.v1'],
      [AUTOSAVE_KEY, 'blockyard.autosave.v1'],
    ]) {
      const legacy = localStorage.getItem(before)
      if (legacy !== null && localStorage.getItem(now) === null) {
        localStorage.setItem(now, legacy)
      }
    }
  } catch {
    // Storage blocked. The app already warns about that; nothing to do here.
  }
})()

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

/** All saved builds, newest first. */
export function listProjects() {
  const all = readJSON(PROJECTS_KEY, {})
  return Object.entries(all)
    .map(([name, p]) => ({ name, ...p }))
    .sort((a, b) => (b.scene?.updatedAt ?? '').localeCompare(a.scene?.updatedAt ?? ''))
}

export function saveProject(name, scene, thumbnail) {
  const all = readJSON(PROJECTS_KEY, {})
  const existing = all[name]
  all[name] = {
    scene: { ...scene, createdAt: existing?.scene?.createdAt ?? scene.createdAt },
    thumbnail: thumbnail ?? existing?.thumbnail ?? null,
  }
  if (writeJSON(PROJECTS_KEY, all)) return { ok: true }

  // Most likely the thumbnails have filled the quota — retry without this one.
  all[name].thumbnail = null
  if (writeJSON(PROJECTS_KEY, all)) return { ok: true, droppedThumbnail: true }
  return { ok: false }
}

export function deleteProject(name) {
  const all = readJSON(PROJECTS_KEY, {})
  delete all[name]
  writeJSON(PROJECTS_KEY, all)
}

export function loadProject(name) {
  const all = readJSON(PROJECTS_KEY, {})
  const entry = all[name]
  return entry ? migrate(entry.scene) : null
}

/** Keeps a kid's in-progress build across an accidental refresh. */
export function writeAutosave(scene) {
  writeJSON(AUTOSAVE_KEY, scene)
}

export function readAutosave() {
  const scene = readJSON(AUTOSAVE_KEY, null)
  return scene ? migrate(scene) : null
}

/* ------------------------------------------------------------- welcome -- */

/**
 * Whether the welcome screen has had its turn. It shows once, on a browser
 * that has never opened BabyCAD before, and never again — coming back to a
 * build only to be asked what you would like to start is worse than no
 * welcome at all. Help has a link for anyone who wants to see it again.
 *
 * Storage being blocked reads as "already welcomed": somewhere the flag can't
 * be written is somewhere it would show on every single load.
 */
export function hasBeenWelcomed() {
  try {
    return localStorage.getItem(WELCOMED_KEY) !== null
  } catch {
    return true
  }
}

export function markWelcomed() {
  writeJSON(WELCOMED_KEY, new Date().toISOString())
}

export function clearAutosave() {
  try {
    localStorage.removeItem(AUTOSAVE_KEY)
  } catch {
    /* nothing we can do, and nothing that should break the app */
  }
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
