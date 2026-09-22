import { useCallback, useEffect, useRef, useState } from 'react'
import Viewport from './scene/Viewport'
import { useScene } from './scene/sceneStore'
import { viewport } from './scene/viewportApi'
import TopBar from './ui/TopBar'
import ShapeTray from './ui/ShapeTray'
import ViewTools from './ui/ViewTools'
import PropertiesPanel from './ui/PropertiesPanel'
import ViewCube from './ui/ViewCube'
import ExportMenu from './ui/ExportMenu'
import VariablesPanel from './ui/VariablesPanel'
import ConfirmDialog from './ui/ConfirmDialog'
import WelcomeScreen from './ui/WelcomeScreen'
import HelpModal from './ui/HelpModal'
import TabStrip from './ui/TabStrip'
import Toasts, { toast } from './ui/Toast'
import { buildExample, getExample } from './examples'
import { isDirty, useDocs } from './state/documents'
import { canUseFileSystem, openFromDisk, saveToDisk } from './io/files'
import {
  hasBeenWelcomed,
  isStorageAvailable,
  markWelcomed,
  migrate,
  readSession,
  takeLegacyAutosave,
  takeLegacyProjects,
  writeSession,
} from './io/persistence'

export default function App() {
  const objects = useScene((s) => s.objects)
  const undo = useScene((s) => s.undo)
  const redo = useScene((s) => s.redo)

  const docs = useDocs((s) => s.docs)
  const activeId = useDocs((s) => s.activeId)

  const [sheet, setSheet] = useState(null) // 'export' | 'help' | null
  const [closing, setClosing] = useState(null) // a tab with unsaved changes
  // Variables aren't a sheet: they take over the right rail, so the build they
  // are reshaping stays in full view while a value is dragged.
  const [showVariables, setShowVariables] = useState(false)
  // The welcome is a first-run screen and nothing else. Whether this is a
  // first run is decided in the startup effect below, which is the only place
  // that knows whether there was anything to come back to; nothing after
  // startup turns it back on except asking for it from Help.
  const [welcoming, setWelcoming] = useState(false)

  /* ----------------------------------------------------------- startup -- */

  // Put the tabs back after a refresh. Files themselves are on disk; this is
  // only the cache of what was open — see io/persistence.
  const started = useRef(false)
  useEffect(() => {
    // Once, even though React runs effects twice in development — opening the
    // first tab twice would leave a stray empty one every time.
    if (started.current) return
    started.current = true

    const store = useDocs.getState()
    const session = readSession()
    let restored = store.restore(session ?? {})

    // First run since builds stopped living in the browser: whatever was in
    // the old library opens as tabs, so nothing is stranded somewhere the app
    // no longer looks. They arrive unsaved, because they are not files yet.
    const rescued = takeLegacyProjects()
    const strays = [...rescued]
    if (!restored) {
      const carried = takeLegacyAutosave()
      if (carried?.objects?.length) strays.unshift({ name: 'Untitled', scene: carried })
    }
    for (const { name, scene } of strays) store.open({ name, scene })
    if (strays.length) restored = true
    if (rescued.length) {
      toast(
        `${rescued.length} build${rescued.length > 1 ? 's' : ''} from this browser opened as tabs — save them to a file to keep them`,
        'warn'
      )
    }
    if (!restored) store.open({})

    // Never been here before, and nothing to come back to: show the way in.
    if (!hasBeenWelcomed() && !restored) setWelcoming(true)

    // And then remember that they have been here, whether or not they were
    // shown the way in. Marking this only when the welcome was dismissed left
    // it unwritten forever for anyone whose tabs come back every time — so the
    // first load where the session couldn't be read, from a cleared cache or
    // a private window or a bad write, dropped them on the welcome screen
    // instead of on their work.
    markWelcomed()

    if (!isStorageAvailable()) {
      toast("This browser won't remember your open tabs — save to a file as you go", 'warn')
    }
  }, [])

  // Cache the open tabs, throttled, so a refresh doesn't cost the afternoon.
  // The same beat re-reads the active build's fingerprint, which is what puts
  // the unsaved dot on its tab.
  // Names and open tabs matter to the cache as much as the blocks do, so a
  // rename alone is enough to write it. `touch` only writes when a build has
  // actually changed, so this can't chase its own tail.
  const docsKey = docs.map((d) => `${d.id}:${d.name}`).join('|')
  useEffect(() => {
    const id = setTimeout(() => {
      useDocs.getState().touch()
      writeSession(useDocs.getState().snapshot())
    }, 600)
    return () => clearTimeout(id)
  }, [objects, activeId, docsKey])

  // A build with changes not yet written to disk is worth a word on the way
  // out. Browsers show their own text, not ours; all we control is whether
  // they ask at all.
  useEffect(() => {
    const onBeforeUnload = (e) => {
      if (!useDocs.getState().docs.some(isDirty)) return
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  /* --------------------------------------------------------- shortcuts -- */

  // The save and open handlers are reached through refs, so the key listener
  // is bound once rather than re-bound every time a tab changes.
  const saveRef = useRef(() => {})
  const openRef = useRef(() => {})

  useEffect(() => {
    // A focused text field owns its own undo stack, so the shortcuts stay out
    // of its way. A slider has no such thing, and leaving one focused after a
    // drag shouldn't quietly disable Cmd-Z.
    const typing = (e) =>
      (e.target instanceof HTMLInputElement && e.target.type !== 'range') ||
      e.target.isContentEditable

    const onKeyDown = (e) => {
      // Alt suspends grid snapping for as long as it's held.
      if (e.key === 'Alt') useScene.getState().setFreeMove(true)
      if (typing(e)) return

      const meta = e.metaKey || e.ctrlKey
      const store = useScene.getState()

      if (meta && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        e.shiftKey ? redo() : undo()
      } else if (meta && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        redo()
      } else if (meta && e.key.toLowerCase() === 'a') {
        // Select all. Worth pre-empting the browser's own select-all even when
        // the yard is empty: highlighting the whole page is never what someone
        // reaching for Ctrl-A in a CAD program wanted.
        e.preventDefault()
        store.selectAll()
      } else if (meta && e.key.toLowerCase() === 's') {
        e.preventDefault()
        saveRef.current(e.shiftKey)
      } else if (meta && e.key.toLowerCase() === 'o') {
        e.preventDefault()
        openRef.current()
      } else if (meta && e.key.toLowerCase() === 'd') {
        e.preventDefault()
        store.duplicate()
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (store.selectedIds.length) {
          e.preventDefault()
          store.deleteSelection()
        }
      } else if (e.key.toLowerCase() === 'l' && !meta) {
        // Tinkercad's shortcut for the same thing, and it does nothing at all
        // unless there is more than one block to line up.
        if (store.selectedIds.length > 1) {
          e.preventDefault()
          store.toggleAlign()
        }
      } else if (e.key === 'Escape') {
        // Escape backs out of aligning first, and only clears the selection
        // once there is no mode left to leave.
        if (store.aligning) store.toggleAlign()
        else store.clearSelection()
      }
    }

    const onKeyUp = (e) => {
      if (e.key === 'Alt') useScene.getState().setFreeMove(false)
    }
    // Alt-tabbing away can swallow the keyup, so clear on blur too.
    const onBlur = () => useScene.getState().setFreeMove(false)

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [undo, redo])

  /* ------------------------------------------------------------ actions -- */

  const onNew = useCallback(() => {
    useDocs.getState().open({})
    viewport.resetView()
  }, [])

  const onOpen = useCallback(async () => {
    let files
    try {
      files = await openFromDisk()
    } catch {
      return toast("That file couldn't be opened", 'warn')
    }
    let opened = 0
    for (const file of files) {
      let scene = null
      try {
        scene = migrate(JSON.parse(file.text))
      } catch {
        scene = null
      }
      if (!scene?.objects?.length) {
        toast(`${file.name} isn't a BabyCAD build`, 'warn')
        continue
      }
      useDocs.getState().open({ name: file.name, handle: file.handle, scene, saved: true })
      opened++
    }
    if (opened) {
      requestAnimationFrame(() => viewport.fit())
      toast(opened > 1 ? `Opened ${opened} builds` : 'Opened it')
    }
  }, [])

  const save = useCallback(async (saveAs) => {
    const store = useDocs.getState()
    const doc = store.active()
    if (!doc) return
    const text = JSON.stringify(useScene.getState().serialize(), null, 2)
    let result
    try {
      result = await saveToDisk({ handle: doc.handle, name: doc.name, text, saveAs })
    } catch {
      return toast("That save didn't work — try Save as", 'warn')
    }
    if (!result) return // the dialog was dismissed; nothing to report
    store.markSaved(doc.id, result)
    toast(result.downloaded ? `Downloaded ${result.name}.babycad` : `Saved ${result.name}.babycad`)
  }, [])

  const onSave = useCallback(() => save(false), [save])
  const onSaveAs = useCallback(() => save(true), [save])

  /** Closing a tab with unsaved work asks first; a clean one just goes. */
  const onCloseRequest = useCallback((id) => {
    const doc = useDocs.getState().docs.find((d) => d.id === id)
    if (doc && isDirty(doc)) setClosing(doc)
    else useDocs.getState().close(id)
  }, [])

  /* ----------------------------------------------------------- welcome -- */

  const dismissWelcome = useCallback(() => setWelcoming(false), [])

  const startBlank = useCallback(() => {
    dismissWelcome()
    setSheet(null)
  }, [dismissWelcome])

  const startExample = useCallback(
    (id) => {
      const example = getExample(id)
      if (!example) return
      const scene = buildExample(example)
      if (!scene) return toast("That example didn't open — start with a blank plate", 'warn')
      // Into whichever tab is showing if it is still empty, otherwise a new
      // one: opening an example should never tip out work in progress.
      const store = useDocs.getState()
      if (useScene.getState().objects.length) store.open({ name: example.name, scene })
      else {
        useScene.getState().loadScene(scene, `open ${example.name}`)
        store.rename(store.activeId, example.name)
      }
      dismissWelcome()
      // Frame it once the meshes exist; the scene has only just been written.
      requestAnimationFrame(() => viewport.fit())
      toast(`Opened the ${example.name.toLowerCase()} — it's yours to take apart`)
    },
    [dismissWelcome]
  )

  const onOpenFile = useCallback(() => {
    dismissWelcome()
    onOpen()
  }, [dismissWelcome, onOpen])

  saveRef.current = (shift) => save(Boolean(shift))
  openRef.current = onOpen

  return (
    <div className="app">
      <TopBar
        onNew={onNew}
        onSave={onSave}
        onSaveAs={onSaveAs}
        onOpen={onOpen}
        onExport={() => setSheet('export')}
        onVariables={() => setShowVariables((on) => !on)}
        onHelp={() => setSheet('help')}
        variablesOpen={showVariables}
      />

      <TabStrip onNew={onNew} onCloseRequest={onCloseRequest} />

      <div className="stage">
        <Viewport />

        {!objects.length && <div className="empty-hint">pick a shape to start</div>}

        <ShapeTray />
        {/* The right rail: the scene-wide switches (snapping, aligning) in a
            strip of their own, then whichever panel is showing beneath. */}
        <div className="rail">
          {objects.length > 0 && <ViewTools />}
          {showVariables ? (
            <VariablesPanel onClose={() => setShowVariables(false)} />
          ) : (
            <PropertiesPanel />
          )}
        </div>
        <ViewCube />
      </div>

      {sheet === 'export' && <ExportMenu onClose={() => setSheet(null)} />}
      {sheet === 'help' && (
        <HelpModal
          onClose={() => setSheet(null)}
          onShowWelcome={() => {
            setSheet(null)
            setWelcoming(true)
          }}
        />
      )}
      {closing && (
        <ConfirmDialog
          title={`Close ${closing.name}?`}
          body="It has changes that aren't in a file yet. Closing the tab loses them, and this one can't be undone."
          confirmLabel="Close it"
          confirmHint="Close the tab and lose the changes"
          onConfirm={() => {
            useDocs.getState().close(closing.id)
            setClosing(null)
          }}
          onCancel={() => setClosing(null)}
        />
      )}

      {welcoming && (
        <WelcomeScreen
          onBlank={startBlank}
          onExample={startExample}
          onOpenFile={onOpenFile}
          onHelp={() => {
            dismissWelcome()
            setSheet('help')
          }}
        />
      )}

      <Toasts />
    </div>
  )
}
