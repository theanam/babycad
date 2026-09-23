/**
 * Open builds, one per tab.
 *
 * The scene store holds exactly one build — every panel, the gizmo, the undo
 * stack and the exporters all read it, and making each of them tab-aware
 * would touch the whole app. So the scene store stays as it is and *is* the
 * active tab: switching tabs lifts the current build out of it and drops the
 * next one in. What moves is the build itself, what's selected, and the undo
 * stack, because an undo belongs to the build it undoes.
 *
 * What does not move is anything about the app rather than the build — the
 * snap grid, whether the align targets are up. Those are settings, and a
 * setting that changed every time you switched tabs would be a bug.
 *
 * A tab's file is its `handle`, where the browser gives us one. A handle
 * cannot be written to JSON, so it does not survive a refresh: the builds
 * come back from the session cache, but the first Save after a reload has to
 * ask where to put them again.
 */
import { create } from 'zustand'
import { useScene } from '../scene/sceneStore'
import { SCENE_VERSION } from '../constants'

const uid = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : 'doc-' + Math.random().toString(36).slice(2)

/** The part of the scene store that belongs to one build. */
const SESSION_KEYS = ['objects', 'groups', 'variables', 'selectedIds', 'past', 'future']

const emptySession = () => ({
  objects: [],
  groups: [],
  variables: [],
  selectedIds: [],
  past: [],
  future: [],
})

const sceneParts = (scene) => ({
  objects: scene?.objects ?? [],
  groups: scene?.groups ?? [],
  variables: scene?.variables ?? [],
})
const sessionOf = (scene) => ({ ...emptySession(), ...sceneParts(scene) })

const captureSession = () => {
  const st = useScene.getState()
  return Object.fromEntries(SESSION_KEYS.map((k) => [k, st[k]]))
}

const restoreSession = (session) => {
  // Aligning is cleared on the way in: its targets belong to a selection in
  // the build that was showing a moment ago.
  useScene.setState({ ...emptySession(), ...session, aligning: false, mirroring: false })
}

/**
 * What a build looks like right now, as one string. Comparing it with the
 * string taken when the build was last saved is how a tab knows it has
 * unsaved changes — cheaper to keep honest than a flag, which has to be
 * remembered to clear and still says "changed" after a change and its undo.
 */
export const fingerprint = (parts) =>
  JSON.stringify([
    parts.objects ?? [],
    parts.groups ?? [],
    parts.variables ?? [],
  ])

const untitled = (docs) => {
  const taken = new Set(docs.map((d) => d.name))
  if (!taken.has('Untitled')) return 'Untitled'
  for (let n = 2; ; n++) if (!taken.has(`Untitled ${n}`)) return `Untitled ${n}`
}

const makeDoc = (docs, { name, handle = null, scene = null, saved = false }) => {
  const session = sessionOf(scene)
  const mark = fingerprint(session)
  // Opened from a file: clean, it matches what is on disk. Empty: clean too,
  // since there is nothing in it to lose and a dot on a blank tab is a
  // warning about nothing. Anything else — an example, a rescued build —
  // starts dirty, because there is no file it matches yet.
  const clean = saved || !session.objects.length
  return {
    id: uid(),
    name: name || untitled(docs),
    handle,
    session,
    savedMark: clean ? mark : null,
    liveMark: mark,
  }
}

export const useDocs = create((set, get) => ({
  docs: [],
  activeId: null,

  active() {
    const { docs, activeId } = get()
    return docs.find((d) => d.id === activeId) ?? null
  },

  /** Put a build in a new tab and switch to it. */
  open({ name, handle, scene, saved } = {}) {
    const { docs, activeId } = get()
    const doc = makeDoc(docs, { name, handle, scene, saved })
    set({
      docs: [...docs.map((d) => (d.id === activeId ? { ...d, session: captureSession() } : d)), doc],
      activeId: doc.id,
    })
    restoreSession(doc.session)
    return doc
  },

  activate(id) {
    const { docs, activeId } = get()
    if (id === activeId) return
    const next = docs.find((d) => d.id === id)
    if (!next) return
    set({
      docs: docs.map((d) => (d.id === activeId ? { ...d, session: captureSession() } : d)),
      activeId: id,
    })
    restoreSession(next.session)
  },

  /**
   * Close a tab. Closing the last one leaves nothing open, which is the state
   * the welcome screen exists for — a blank build conjured in its place would
   * be answering a question nobody asked.
   */
  close(id) {
    const { docs, activeId } = get()
    const at = docs.findIndex((d) => d.id === id)
    if (at === -1) return
    const rest = docs.filter((d) => d.id !== id)

    if (!rest.length) {
      set({ docs: [], activeId: null })
      restoreSession(emptySession())
      return
    }
    if (id !== activeId) {
      set({ docs: rest })
      return
    }
    // The neighbour to the right, or the last one if this was the right-most.
    const next = rest[Math.min(at, rest.length - 1)]
    set({ docs: rest, activeId: next.id })
    restoreSession(next.session)
  },

  rename(id, name) {
    const clean = String(name ?? '').trim().slice(0, 40)
    if (!clean) return
    set((s) => ({ docs: s.docs.map((d) => (d.id === id ? { ...d, name: clean } : d)) }))
  },

  /**
   * Record that a tab now matches a file on disk. The fingerprint is taken
   * from the live scene rather than from `liveMark`, which is only refreshed
   * on the autosave beat: what was written to the file is what is on screen
   * now, not what it looked like up to half a second ago.
   */
  markSaved(id, { handle, name }) {
    const mark = fingerprint(useScene.getState())
    set((s) => ({
      docs: s.docs.map((d) =>
        d.id === id
          ? { ...d, handle: handle ?? d.handle, name: name || d.name, savedMark: mark, liveMark: mark }
          : d
      ),
    }))
  },

  /** Recompute the active tab's fingerprint. Called on the autosave beat. */
  touch() {
    const { activeId } = get()
    if (!activeId) return
    const mark = fingerprint(useScene.getState())
    set((s) => ({
      docs: s.docs.map((d) =>
        d.id === activeId ? (d.liveMark === mark ? d : { ...d, liveMark: mark }) : d
      ),
    }))
  },

  /** Every open build, as plain scenes — for the session cache. */
  snapshot() {
    const { docs, activeId } = get()
    const live = useScene.getState()
    return {
      activeId,
      docs: docs.map((d) => {
        const parts = d.id === activeId ? sceneParts(live) : sceneParts(d.session)
        return {
          id: d.id,
          name: d.name,
          dirty: d.savedMark !== d.liveMark,
          scene: { version: SCENE_VERSION, ...parts },
        }
      }),
    }
  },

  /** Put back what `snapshot` wrote, after a refresh. */
  restore({ docs, activeId }) {
    if (!docs?.length) return false
    const made = []
    for (const d of docs) {
      const doc = makeDoc(made, { name: d.name, scene: d.scene, saved: !d.dirty })
      doc.id = d.id ?? doc.id
      made.push(doc)
    }
    const active = made.find((d) => d.id === activeId) ?? made[0]
    set({ docs: made, activeId: active.id })
    restoreSession(active.session)
    return true
  },
}))

export const isDirty = (doc) => Boolean(doc) && doc.savedMark !== doc.liveMark
