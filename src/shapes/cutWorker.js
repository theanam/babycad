/**
 * The cutting, off the main thread.
 *
 * A hole is cut out of a solid here, in a worker, so that however long a cut
 * takes — and on a big imported model it can take minutes — the tab keeps
 * answering. While it runs the block shows the last cut it had, or the plain
 * shape the first time, and the hole is its grey ghost; when the result comes
 * back the block takes it. Nothing you can do in the meantime waits on it.
 *
 * Geometries are sent once and kept here by key, because a model is megabytes
 * and a hole being lined up asks for a cut on every nudge. A cut names its
 * solid and holes by key; if one is missing — the worker was restarted, or it
 * let an old one go — it says which, and the main thread sends it and asks
 * again. That round trip is the whole of the protocol's error handling, and it
 * is what lets the main thread never need to know what the worker remembers.
 */
import { cutArrays } from './cutCore'

/** Keys we hold geometry for, most recently used last. */
const kept = new Map()
/** Past this many the least recently used goes; a model is megabytes. */
const KEEP = 48

function remember(key, geometry) {
  kept.delete(key)
  kept.set(key, geometry)
  while (kept.size > KEEP) kept.delete(kept.keys().next().value)
}

function recall(key) {
  const g = kept.get(key)
  if (g) {
    kept.delete(key)
    kept.set(key, g) // touched, so it is the newest again
  }
  return g ?? null
}

self.onmessage = ({ data }) => {
  if (data.type === 'geometry') {
    remember(data.key, { positions: data.positions, normals: data.normals })
    return
  }
  if (data.type !== 'cut') return

  const { id, solidKey, holes, geometries } = data
  for (const [key, g] of Object.entries(geometries ?? {})) remember(key, g)

  const missing = [solidKey, ...holes.map((h) => h.key)].filter((k) => !kept.has(k))
  if (missing.length) {
    self.postMessage({ type: 'missing', id, keys: [...new Set(missing)] })
    return
  }

  try {
    const solid = recall(solidKey)
    const cutters = holes.map((h) => ({ ...recall(h.key), matrix: h.matrix }))
    const { positions, normals } = cutArrays(solid, cutters)
    const transfer = [positions.buffer]
    if (normals) transfer.push(normals.buffer)
    self.postMessage({ type: 'done', id, positions, normals }, transfer)
  } catch (error) {
    self.postMessage({ type: 'failed', id, message: String(error?.message ?? error) })
  }
}
