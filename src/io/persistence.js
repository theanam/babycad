/**
 * Local-only persistence. Everything lives in this browser's localStorage —
 * there is no server, no account, and nothing leaves the device.
 */
import { SCENE_VERSION } from '../constants'

const PROJECTS_KEY = 'blockyard.projects.v1'
const AUTOSAVE_KEY = 'blockyard.autosave.v1'

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
    const probe = '__blockyard__'
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
 * Bring an older scene up to the current schema. Today there is only one
 * version, so this just validates shape and fills in defaults.
 */
export function migrate(scene) {
  if (!scene || typeof scene !== 'object') return null
  const objects = Array.isArray(scene.objects) ? scene.objects : []
  return {
    version: SCENE_VERSION,
    objects: objects
      .filter((o) => o && typeof o.id === 'string' && typeof o.type === 'string')
      .map((o) => ({
        id: o.id,
        type: o.type,
        position: triple(o.position, [0, 0.5, 0]),
        rotation: triple(o.rotation, [0, 0, 0]),
        scale: triple(o.scale, [1, 1, 1]),
        color: typeof o.color === 'string' ? o.color : '#FFC93D',
        parentGroupId: o.parentGroupId ?? null,
      })),
    groups: (Array.isArray(scene.groups) ? scene.groups : []).filter(
      (g) => g && typeof g.id === 'string' && Array.isArray(g.memberIds)
    ),
    createdAt: scene.createdAt ?? new Date().toISOString(),
    updatedAt: scene.updatedAt ?? new Date().toISOString(),
  }
}

const triple = (v, fallback) =>
  Array.isArray(v) && v.length === 3 && v.every((n) => Number.isFinite(n)) ? [...v] : [...fallback]
