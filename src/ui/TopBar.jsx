import { useEffect, useRef, useState } from 'react'
import { useScene } from '../scene/sceneStore'
import { REPO_URL } from '../links'
import {
  ChevronUpIcon,
  ExportIcon,
  GithubIcon,
  HelpIcon,
  ImportIcon,
  MeasureIcon,
  OpenIcon,
  PlusIcon,
  RedoIcon,
  SaveIcon,
  UndoIcon,
  VariableIcon,
} from './icons'

export default function TopBar({
  onImport,
  onNew,
  onSave,
  onSaveAs,
  onOpen,
  onExport,
  onVariables,
  onHelp,
  variablesOpen,
}) {
  const measuring = useScene((s) => s.measuring)
  const toggleMeasure = useScene((s) => s.toggleMeasure)

  const undo = useScene((s) => s.undo)
  const redo = useScene((s) => s.redo)
  const canUndo = useScene((s) => s.past.length > 0)
  const canRedo = useScene((s) => s.future.length > 0)
  const variableCount = useScene((s) => s.variables.length)

  // Save is a button with a menu hung off it, so "Save as" has somewhere to
  // live without taking a slot of its own in a bar that is full.
  const [menu, setMenu] = useState(false)
  const saveWrap = useRef(null)
  useEffect(() => {
    if (!menu) return
    const onDown = (e) => {
      if (!saveWrap.current?.contains(e.target)) setMenu(false)
    }
    const onKey = (e) => e.key === 'Escape' && setMenu(false)
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menu])

  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-mark" aria-hidden="true">
          <i /><i /><i />
        </div>
        <div className="brand-name">BabyCAD</div>
      </div>

      <div className="rule-v" />

      <div style={{ display: 'flex', gap: 6 }}>
        <button className="icon-btn" onClick={undo} disabled={!canUndo} title="Undo" aria-label="Undo">
          <UndoIcon stroke="#8A93A5" />
        </button>
        <button className="icon-btn" onClick={redo} disabled={!canRedo} title="Redo" aria-label="Redo">
          <RedoIcon stroke="#8A93A5" />
        </button>
      </div>

      <div className="topbar-right">
        <button
          className={`bar-btn${variablesOpen ? ' on' : ''}`}
          onClick={onVariables}
          aria-pressed={variablesOpen}
          title={
            variablesOpen
              ? 'Close the variables panel'
              : 'Numbers you can share between shapes'
          }
        >
          <VariableIcon size={18} stroke={variablesOpen ? '#C9B6FF' : '#8A93A5'} />
          Variables
          {variableCount > 0 && <span className="bar-count">{variableCount}</span>}
        </button>

        <div className="rule-v" />

        <button className="bar-btn" onClick={onNew} title="Start a fresh build in a new tab">
          <PlusIcon size={18} stroke="#8A93A5" />
          New
        </button>
        <button className="bar-btn" onClick={onOpen} title="Open a .babycad file from your computer">
          <OpenIcon size={18} stroke="#8A93A5" />
          Open
        </button>
        {/* Beside Open, and not the same thing: Open replaces what is on the
            plate with a build, Import drops somebody else's part onto it. */}
        <button
          className="bar-btn"
          onClick={onImport}
          title="Bring an STL, OBJ or 3MF onto the plate"
        >
          <ImportIcon size={18} stroke="#8A93A5" />
          Import
        </button>
        <button
          className={`bar-btn${measuring ? ' on' : ''}`}
          onClick={toggleMeasure}
          aria-pressed={measuring}
          title="Measure between two points"
        >
          <MeasureIcon size={18} stroke={measuring ? '#fff' : '#8A93A5'} />
          Measure
        </button>

        <div className="bar-save" ref={saveWrap}>
          <button
            className="bar-btn"
            onClick={onSave}
            title="Save this build to a file on your computer (Ctrl/⌘ + S)"
          >
            <SaveIcon size={18} stroke="#8A93A5" />
            Save
          </button>
          <button
            className="bar-chevron"
            onClick={() => setMenu((m) => !m)}
            aria-haspopup="menu"
            aria-expanded={menu}
            aria-label="More saving options"
            title="More saving options"
          >
            <ChevronUpIcon size={14} stroke="#8A93A5" style={{ transform: 'rotate(180deg)' }} />
          </button>
          {menu && (
            <div className="bar-menu" role="menu">
              <button
                role="menuitem"
                onClick={() => {
                  setMenu(false)
                  onSave()
                }}
              >
                Save
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  setMenu(false)
                  onSaveAs()
                }}
              >
                Save as…
              </button>
            </div>
          )}
        </div>
        <button className="bar-btn accent" onClick={onExport} title="Download this build as a file">
          <ExportIcon size={18} stroke="#fff" width={2.4} />
          Export
        </button>

        <div className="rule-v" />

        <button className="icon-btn" onClick={onHelp} title="How BabyCAD works" aria-label="Help">
          <HelpIcon size={20} stroke="#8A93A5" />
        </button>
        <a
          className="icon-btn"
          href={REPO_URL}
          target="_blank"
          rel="noreferrer noopener"
          title="BabyCAD on GitHub — source, issues and releases"
          aria-label="BabyCAD on GitHub"
        >
          <GithubIcon size={19} fill="#8A93A5" />
        </a>
      </div>
    </header>
  )
}
