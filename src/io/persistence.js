/**
 * Local-only persistence. Everything lives in this browser's localStorage —
 * there is no server, no account, and nothing leaves the device.
 */
import { SCENE_VERSION } from '../constants'
import { normalizeParams } from '../shapes'
import { resolvePatches, sanitizeVariables } from '../scene/variables'

const PROJECTS_KEY = 'babycad.projects.v1'
const AUTOSAVE_KEY = 'babycad.autosave.v1'

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

  const objects = rawObjects
    // A type this build doesn't know (a scene from a newer version) is kept
    // rather than dropped; it falls back to a cube instead of vanishing.
    .filter((o) => o && typeof o.id === 'string' && typeof o.type === 'string')
    .map((o) => ({
      id: o.id,
      type: o.type,
      params: normalizeParams(o.type, o.params),
      bindings: bindingsOf(o.bindings, known),
      position: triple(o.position, [0, 0.5, 0]),
      rotation: triple(o.rotation, [0, 0, 0]),
      scale: triple(o.scale, [1, 1, 1]),
      color: typeof o.color === 'string' ? o.color : '#FFC93D',
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
