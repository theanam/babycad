import { useCallback, useEffect, useState } from 'react'
import Viewport from './scene/Viewport'
import { useScene } from './scene/sceneStore'
import { viewport } from './scene/viewportApi'
import TopBar from './ui/TopBar'
import ShapeTray from './ui/ShapeTray'
import ViewTools from './ui/ViewTools'
import PropertiesPanel from './ui/PropertiesPanel'
import ViewCube from './ui/ViewCube'
import ProjectsModal from './ui/ProjectsModal'
import ExportMenu from './ui/ExportMenu'
import VariablesPanel from './ui/VariablesPanel'
import ConfirmDialog from './ui/ConfirmDialog'
import Toasts, { toast } from './ui/Toast'
import { isStorageAvailable, readAutosave, writeAutosave } from './io/persistence'

export default function App() {
  const objects = useScene((s) => s.objects)
  const undo = useScene((s) => s.undo)
  const redo = useScene((s) => s.redo)

  const [sheet, setSheet] = useState(null) // 'projects' | 'export' | 'new' | null
  // Variables aren't a sheet: they take over the right rail, so the build they
  // are reshaping stays in full view while a value is dragged.
  const [showVariables, setShowVariables] = useState(false)

  /* ----------------------------------------------------------- startup -- */

  // Pick the scene back up after an accidental refresh. The undo stack is
  // deliberately not restored — only the build itself is.
  useEffect(() => {
    const saved = readAutosave()
    if (saved?.objects?.length) {
      useScene.setState({
        objects: saved.objects,
        groups: saved.groups,
        variables: saved.variables ?? [],
      })
    }
    if (!isStorageAvailable()) {
      toast("This browser won't let BabyCAD save — your build will vanish on refresh", 'warn')
    }
  }, [])

  // Autosave, throttled, so a long build session survives a closed tab.
  useEffect(() => {
    const id = setTimeout(() => writeAutosave(useScene.getState().serialize()), 600)
    return () => clearTimeout(id)
  }, [objects])

  /* --------------------------------------------------------- shortcuts -- */

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
      } else if (meta && e.key.toLowerCase() === 'd') {
        e.preventDefault()
        store.duplicate()
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (store.selectedIds.length) {
          e.preventDefault()
          store.deleteSelection()
        }
      } else if (e.key === 'Escape') {
        store.clearSelection()
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

  const confirmNew = useCallback(() => {
    useScene.getState().newScene()
    viewport.resetView()
    setSheet(null)
    toast('Fresh yard')
  }, [])

  const onNew = () => (objects.length ? setSheet('new') : toast('Already a fresh yard'))

  return (
    <div className="app">
      <TopBar
        onNew={onNew}
        onSave={() => setSheet('projects')}
        onLoad={() => setSheet('projects')}
        onExport={() => setSheet('export')}
        onVariables={() => setShowVariables((on) => !on)}
        variablesOpen={showVariables}
      />

      <div className="stage">
        <Viewport />

        {!objects.length && <div className="empty-hint">pick a shape to start</div>}

        <ShapeTray />
        {objects.length > 0 && <ViewTools />}
        {showVariables ? (
          <VariablesPanel onClose={() => setShowVariables(false)} />
        ) : (
          <PropertiesPanel />
        )}
        <ViewCube />
      </div>

      {sheet === 'projects' && (
        <ProjectsModal
          onClose={() => setSheet(null)}
          onRequestNew={() => (objects.length ? setSheet('new') : confirmNew())}
        />
      )}
      {sheet === 'export' && <ExportMenu onClose={() => setSheet(null)} />}
      {sheet === 'new' && (
        <ConfirmDialog
          title="Start a new build?"
          body="This clears the yard. Anything you haven't saved will be gone — and this one can't be undone."
          confirmLabel="Clear it"
          confirmHint="Empty the yard and start over — this can't be undone"
          onConfirm={confirmNew}
          onCancel={() => setSheet(null)}
        />
      )}

      <Toasts />
    </div>
  )
}
