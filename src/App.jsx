import { useCallback, useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
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
import ErrorBoundary from './ui/ErrorBoundary'
import TouchTopBar from './ui/touch/TouchTopBar'
import TouchBar from './ui/touch/TouchBar'
import ShapeSheet from './ui/touch/ShapeSheet'
import SnapSheet from './ui/touch/SnapSheet'
import ViewSheet from './ui/touch/ViewSheet'
import MoreSheet from './ui/touch/MoreSheet'
import DocsSheet from './ui/touch/DocsSheet'
import SelectionSheet from './ui/touch/SelectionSheet'
import VariablesSheet from './ui/touch/VariablesSheet'
import { useDevice } from './state/device'
import { mark, trace } from './debug/trace'

/**
 * Arrow key -> [how far away from the camera, how far to its right], before
 * either is turned into a world direction.
 */
const ARROWS = {
  ArrowUp: [1, 0],
  ArrowDown: [-1, 0],
  ArrowRight: [0, 1],
  ArrowLeft: [0, -1],
}
import { pickModelFiles, readModelFile } from './io/importModel'
import { warmFontsFor } from './shapes/fontStore'
import HelpModal from './ui/HelpModal'
import TabStrip from './ui/TabStrip'
import Toasts, { toast } from './ui/Toast'
import { buildExample, getExample } from './examples'
import { isDirty, useDocs } from './state/documents'
import { useUI } from './state/ui'
import { canUseFileSystem, openFromDisk, saveToDisk } from './io/files'
import {
  isStorageAvailable,
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
  // Which shell to draw. `touch` is about the pointer, not the screen size —
  // see state/device — and it swaps the rails, the tray and the menus for a
  // bottom bar and a stack of sheets. `compact` is a phone rather than a
  // tablet, and only tightens what the touch shell already is.
  const { touch, compact } = useDevice()
  // The one sheet the bottom bar has open, if any.
  const [bar, setBar] = useState(null) // 'shapes' | 'snap' | 'view' | 'more' | 'docs'
  // Variables aren't a sheet: they take over the right rail, so the build they
  // are reshaping stays in full view while a value is dragged. The state is in
  // the UI store because a variable's name is clickable from inside the canvas
  // as well as from the rail — see state/ui.
  const showVariables = useUI((s) => s.variablesOpen)
  const toggleVariables = useUI((s) => s.toggleVariables)
  const closeVariables = useUI((s) => s.closeVariables)
  // The welcome screen is simply what no open builds looks like — on a first
  // visit, and again when the last tab is closed. Nothing has to remember
  // whether it has been shown before, which is one fewer flag to get wrong:
  // if there is something open you are working, and if there isn't you are
  // choosing what to work on. Help can also ask for it over open work.
  const [welcomeAsked, setWelcomeAsked] = useState(false)
  const welcoming = docs.length === 0 || welcomeAsked

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
    const { session, droppedModels } = readSession()
    let restored = store.restore(session ?? {})
    // An imported model's triangles are far too big for the session cache and
    // live in the build's file instead, so a refresh cannot bring one back —
    // see io/persistence. Saying so beats leaving a hole in the build.
    if (droppedModels) {
      toast(
        droppedModels > 1
          ? `${droppedModels} imported models couldn't come back after the refresh — open the build's file for those`
          : "An imported model couldn't come back after the refresh — open the build's file for it",
        'warn'
      )
    }

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
    // Nothing came back: leave it empty, and the welcome screen takes the
    // floor of its own accord.

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
      trace('autosave: touch()', () => useDocs.getState().touch())
      trace('autosave: writeSession()', () => writeSession(useDocs.getState().snapshot()))
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

  /**
   * Arrow keys walk the selection across the plate.
   *
   * Which way is "up" depends on where you are standing. The arrows are read
   * against the camera: whichever world axis the camera is most nearly looking
   * along becomes the up arrow, and the other three follow from it. Snapping
   * to an axis rather than using the camera's exact heading is deliberate —
   * a block nudged along the true view direction would walk off the grid and
   * never land on a round number again.
   *
   * The step is the snap grid, so a nudge and a drag agree about where blocks
   * are allowed to sit. Shift takes ten at a time, for crossing the plate.
   */
  const nudging = useRef(null)

  const nudge = useCallback((key, big) => {
    const store = useScene.getState()
    // Only what is free to move. A locked block stays where it is, and a
    // selection that is entirely locked does nothing at all — the arrow keys
    // are a transform like any other.
    const sel = store.movableSelection()
    if (!sel.length || !viewport.camera) return false

    // The camera's heading, flattened onto the plate and snapped to an axis.
    const look = viewport.camera.getWorldDirection(new THREE.Vector3())
    const away =
      Math.abs(look.x) > Math.abs(look.z)
        ? { x: Math.sign(look.x), z: 0 }
        : { x: 0, z: Math.sign(look.z) }
    const right = { x: -away.z, z: away.x }

    const [ax, az] = ARROWS[key]
    const step = (store.snapEnabled ? store.snapStep : 1) * (big ? 10 : 1)
    const dx = (away.x * ax + right.x * az) * step
    const dz = (away.z * ax + right.z * az) * step

    // One run of held keypresses is one move: `before` is taken once, at the
    // first press, and kept until the key comes up.
    if (!nudging.current) {
      nudging.current = Object.fromEntries(
        sel.map((o) => [o.id, { position: [...o.position], rotation: [...o.rotation], scale: [...o.scale] }])
      )
    }
    store.stageTransform(
      sel.map((o) => ({
        id: o.id,
        position: [o.position[0] + dx, o.position[1], o.position[2] + dz],
        rotation: [...o.rotation],
        scale: [...o.scale],
      }))
    )
    return true
  }, [])

  const endNudge = useCallback(() => {
    const before = nudging.current
    nudging.current = null
    if (before) useScene.getState().commitTransform(before, 'move')
  }, [])

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
      } else if (ARROWS[e.key]) {
        if (nudge(e.key, e.shiftKey)) e.preventDefault()
      } else if (e.key === 'Escape') {
        // Escape backs out of whichever mode is showing first, and only
        // clears the selection once there is no mode left to leave.
        if (store.aligning) store.toggleAlign()
        else if (store.mirroring) store.toggleMirror()
        // Escape drops a half-made measurement first, and puts the tape away
        // only once there is nothing half-made to drop.
        else if (store.measuring && store.measurePoints.length) store.clearMeasure()
        else if (store.measuring) store.toggleMeasure()
        else store.clearSelection()
      }
    }

    const onKeyUp = (e) => {
      if (e.key === 'Alt') useScene.getState().setFreeMove(false)
      // A held arrow repeats, and one undo step per repeat would bury the
      // state before it. The whole run of a press is staged and committed once
      // on release, the same shape a drag has.
      if (ARROWS[e.key]) endNudge()
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
  }, [undo, redo, nudge, endNudge])

  /* --------------------------------------------------------- clipboard -- */

  /**
   * Copy, cut and paste, through the browser's own clipboard events.
   *
   * Not the keydown handler above, and not `navigator.clipboard`: only a real
   * `copy` event is allowed to write to the clipboard, and reading it any
   * other way needs a permission Firefox does not grant web pages at all.
   * These three events carry the data with no permission anywhere, because
   * pressing the keys is the consent. What is actually carried is in
   * `scene/clipboard`.
   *
   * A text field being edited keeps its own copy and paste. Someone renaming a
   * variable with the keyboard is copying words, not blocks.
   */
  useEffect(() => {
    const inAField = (e) => {
      const el = e.target
      return (
        (el instanceof HTMLInputElement && el.type !== 'range') ||
        el instanceof HTMLTextAreaElement ||
        el?.isContentEditable
      )
    }

    const write = (e) => {
      const text = useScene.getState().copyPayload()
      if (!text) return null
      e.clipboardData.setData('text/plain', text)
      e.preventDefault()
      return useScene.getState().selectedIds.length
    }

    const onCopy = (e) => {
      if (inAField(e)) return
      const n = write(e)
      if (n) toast(n > 1 ? `Copied ${n} blocks` : 'Copied it')
    }

    const onCut = (e) => {
      if (inAField(e)) return
      const n = write(e)
      if (!n) return
      useScene.getState().deleteSelection()
      toast(n > 1 ? `Cut ${n} blocks` : 'Cut it')
    }

    const onPaste = (e) => {
      if (inAField(e)) return
      const text = e.clipboardData?.getData('text/plain')
      if (!text) return
      // Somewhere to paste into. Arriving with the welcome screen up is a
      // perfectly reasonable way to start a build.
      const hadDoc = useDocs.getState().docs.length > 0
      if (!hadDoc) useDocs.getState().open({})
      if (!useScene.getState().paste(text)) {
        // Not ours — ordinary text somebody pasted out of habit. Leave the
        // empty build we may have just opened alone rather than closing it
        // out from under them.
        return
      }
      e.preventDefault()
      setWelcomeAsked(false)
      const n = useScene.getState().selectedIds.length
      toast(n > 1 ? `Pasted ${n} blocks` : 'Pasted it')
    }

    document.addEventListener('copy', onCopy)
    document.addEventListener('cut', onCut)
    document.addEventListener('paste', onPaste)
    return () => {
      document.removeEventListener('copy', onCopy)
      document.removeEventListener('cut', onCut)
      document.removeEventListener('paste', onPaste)
    }
  }, [])

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
        // Start fetching any typeface the build names, so words that use one
        // settle into it rather than staying in the fallback face.
        if (scene) warmFontsFor(scene.objects)
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

  /**
   * Write the build out.
   *
   * On a touch device this goes to the system's share sheet rather than to a
   * file picker that isn't there or a downloads folder nobody opens — Save to
   * Files, AirDrop, send it on. Where the device won't take a `.babycad` the
   * old paths still run underneath, and the toast says which one did, because
   * "saved", "sent" and "downloaded" leave the file in three different places
   * and only one of them can be written back to.
   */
  const save = useCallback(
    async (saveAs) => {
      const store = useDocs.getState()
      const doc = store.active()
      if (!doc) return
      const text = JSON.stringify(useScene.getState().serialize(), null, 2)
      let result
      try {
        result = await saveToDisk({ handle: doc.handle, name: doc.name, text, saveAs, share: touch })
      } catch {
        // "Save as" is a desktop-only way out; on a handheld there is only the
        // one Save, so pointing at the other one would be pointing at nothing.
        return toast(
          touch ? "That save didn't work — try again" : "That save didn't work — try Save as",
          'warn'
        )
      }
      if (!result) return // the dialog was dismissed; nothing to report
      store.markSaved(doc.id, result)
      const verb = result.shared ? 'Sent' : result.downloaded ? 'Downloaded' : 'Saved'
      toast(`${verb} ${result.name}.babycad`)
    },
    [touch]
  )

  const onSave = useCallback(() => save(false), [save])
  const onSaveAs = useCallback(() => save(true), [save])

  /** Closing a tab with unsaved work asks first; a clean one just goes. */
  const onCloseRequest = useCallback((id) => {
    const doc = useDocs.getState().docs.find((d) => d.id === id)
    if (doc && isDirty(doc)) setClosing(doc)
    else useDocs.getState().close(id)
  }, [])

  /* ----------------------------------------------------------- welcome -- */

  /** Leaving the welcome screen: there has to be something open behind it. */
  /**
   * A blank build. Only ever reached from "Start with an empty plate" — making
   * a document is something somebody asks for, never a side effect of getting
   * out of the way of this screen.
   */
  const startBlank = useCallback(() => {
    if (!useDocs.getState().docs.length) useDocs.getState().open({})
    setWelcomeAsked(false)
    setSheet(null)
  }, [])

  /**
   * Put the welcome screen away without making anything. With a build already
   * open this goes back to it; on a first visit `welcoming` is still true
   * because there are no documents, so the screen stays and nothing happens —
   * which is the right nothing, since there is nowhere to go back to.
   */
  const dismissWelcome = useCallback(() => {
    setWelcomeAsked(false)
    setSheet(null)
  }, [])

  const startExample = useCallback(
    (id) => {
      const example = getExample(id)
      if (!example) return
      const scene = buildExample(example)
      if (!scene) return toast("That example didn't open — start with a blank plate", 'warn')
      // Into whichever tab is showing if it is still empty, otherwise a new
      // one: opening an example should never tip out work in progress.
      const store = useDocs.getState()
      if (!store.activeId || useScene.getState().objects.length) {
        store.open({ name: example.name, scene })
      } else {
        useScene.getState().loadScene(scene, `open ${example.name}`)
        store.rename(store.activeId, example.name)
      }
      setWelcomeAsked(false)
      // Frame it once the meshes exist; the scene has only just been written.
      requestAnimationFrame(() => viewport.fit())
      toast(`Opened the ${example.name.toLowerCase()} — it's yours to take apart`)
    },
    []
  )

  // Opening a file leaves the welcome up until one actually opens — backing
  // out of the file dialog should put you back where you were, not on an
  // empty plate you didn't ask for.
  /**
   * Bring models onto the plate.
   *
   * Each one lands like any other block — placed by the same `placementPoint`,
   * so two imports sit side by side rather than inside one another — and is
   * selected afterwards, because the first thing anybody does with a part they
   * have just brought in is move or resize it.
   */
  const onImport = useCallback(async () => {
    let files = []
    try {
      files = await pickModelFiles()
    } catch {
      return toast('That file could not be opened', 'warn')
    }
    if (!files.length) return
    if (!useDocs.getState().docs.length) useDocs.getState().open({})
    setWelcomeAsked(false)

    const added = []
    for (const file of files) {
      try {
        const model = await readModelFile(file)
        mark(`imported ${model.name}: ${model.triangles.toLocaleString()} triangles`)
        const params = { mesh: model.id }
        const at = viewport.placementPoint('model', useScene.getState().objects, params)
        const object = useScene.getState().addShape('model', at, params)
        added.push({ object, model })
        if (model.busy) {
          toast(`${model.name} is ${Math.round(model.triangles / 1000)}k triangles — it may feel slow`, 'warn')
        }
      } catch (error) {
        toast(error.message ?? 'That model could not be read', 'warn')
      }
    }
    if (!added.length) return
    useScene.getState().setSelection(added.map((a) => a.object.id))
    const [first] = added
    const mm = (n) => Math.round(n * 10) / 10
    toast(
      added.length === 1
        ? `${first.model.name} — ${mm(first.model.size.x)} × ${mm(first.model.size.z)} × ${mm(first.model.size.y)} mm`
        : `${added.length} models brought in`
    )
  }, [])

  const onOpenFile = useCallback(async () => {
    await onOpen()
    if (useDocs.getState().docs.length) setWelcomeAsked(false)
  }, [onOpen])

  saveRef.current = (shift) => save(Boolean(shift))
  openRef.current = onOpen

  /* The plate itself, which both shells put in the same place and neither
     changes. It fails apart from the panels around it: whichever of the two
     stops, the other is still there to save the work with. */
  const plate = (
    <ErrorBoundary
      what="the 3D view"
      fallback={(error, retry) => (
        <div className="panel-crash stage-crash">
          <b>The plate stopped drawing.</b>
          <span>Your blocks are still here.</span>
          <button className="crash-btn" onClick={retry}>
            Try again
          </button>
        </div>
      )}
    >
      <Viewport />
    </ErrorBoundary>
  )

  const panelCrash = (error, retry) => (
    <div className="panel-crash">
      <b>This panel stopped working.</b>
      <span>The block itself is fine — try again, or pick something else.</span>
      <button className="crash-btn" onClick={retry}>
        Try again
      </button>
    </div>
  )

  /* Everything that is a centred modal on either shell, and the welcome
     screen, which is its own full-page thing. Shared rather than duplicated:
     they are already sized off the viewport and already reachable. */
  const overlays = (
    <>
      {sheet === 'export' && <ExportMenu onClose={() => setSheet(null)} />}
      {sheet === 'help' && (
        <HelpModal
          touch={touch}
          onClose={() => setSheet(null)}
          onShowWelcome={() => {
            setSheet(null)
            setWelcomeAsked(true)
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
          onDismiss={dismissWelcome}
          onExample={startExample}
          onOpenFile={onOpenFile}
          onHelp={() => setSheet('help')}
        />
      )}

      <Toasts />
    </>
  )

  /**
   * The touch shell.
   *
   * Same scene, same stores, same panels — a different place to put them. The
   * two rails and every drop-down menu become sheets that come up from the
   * bottom edge, because that is the half of a handheld a thumb can reach, and
   * the tab strip becomes a name in the top bar, because a 96px tab with a
   * 20px close button inside it is not a target a finger has.
   *
   * What is picked gets an attached sheet rather than a modal one: the block
   * being edited has to stay visible and stay draggable while its numbers are
   * on screen. See ui/touch/SelectionSheet.
   */
  if (touch) {
    const closeBar = () => setBar(null)
    return (
      <div className={`app touch${compact ? ' compact' : ''}`}>
        <TouchTopBar compact={compact} onMore={() => setBar('more')} onDocs={() => setBar('docs')} />

        <div className="stage">
          {plate}
          {!objects.length && <div className="empty-hint">tap shapes to start</div>}
          {/* The cube earns its corner on a tablet, where it is a good target
              and dragging it turns the view. A phone has no corner to spare,
              and gets the View sheet instead. */}
          {!compact && <ViewCube />}
        </div>

        <ErrorBoundary what="the panel" fallback={panelCrash}>
          {showVariables ? <VariablesSheet onClose={closeVariables} /> : <SelectionSheet />}
        </ErrorBoundary>

        <TouchBar open={bar} onOpen={setBar} />

        {bar === 'shapes' && <ShapeSheet onClose={closeBar} />}
        {bar === 'snap' && <SnapSheet onClose={closeBar} />}
        {bar === 'view' && <ViewSheet onClose={closeBar} />}
        {bar === 'more' && (
          <MoreSheet
            sharing={touch}
            onClose={closeBar}
            onSave={onSave}
            onImport={onImport}
            onExport={() => setSheet('export')}
            onVariables={toggleVariables}
            onHelp={() => setSheet('help')}
          />
        )}
        {bar === 'docs' && (
          <DocsSheet
            onClose={closeBar}
            onNew={onNew}
            onOpen={onOpen}
            onCloseDoc={onCloseRequest}
          />
        )}

        {overlays}
      </div>
    )
  }

  return (
    <div className="app">
      <TopBar
        onNew={onNew}
        onSave={onSave}
        onSaveAs={onSaveAs}
        onOpen={onOpen}
        onImport={onImport}
        onExport={() => setSheet('export')}
        onVariables={toggleVariables}
        onHelp={() => setSheet('help')}
        variablesOpen={showVariables}
      />

      <TabStrip onNew={onNew} onCloseRequest={onCloseRequest} />

      <div className="stage">
        {plate}

        {!objects.length && <div className="empty-hint">pick a shape to start</div>}

        <ShapeTray />
        {/* The right rail: the scene-wide switches (snapping, aligning) in a
            strip of their own, then whichever panel is showing beneath. */}
        <div className="rail">
          {objects.length > 0 && <ViewTools />}
          <ErrorBoundary what="the panel" fallback={panelCrash}>
            {showVariables ? <VariablesPanel onClose={closeVariables} /> : <PropertiesPanel />}
          </ErrorBoundary>
        </div>
        <ViewCube />
      </div>

      {overlays}
    </div>
  )
}
