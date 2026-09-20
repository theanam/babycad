import { useScene } from '../scene/sceneStore'
import { REPO_URL } from '../links'
import {
  ExportIcon,
  FolderIcon,
  GithubIcon,
  HelpIcon,
  PlusIcon,
  RedoIcon,
  SaveIcon,
  UndoIcon,
  VariableIcon,
} from './icons'

export default function TopBar({
  onNew,
  onSave,
  onLoad,
  onExport,
  onVariables,
  onHelp,
  variablesOpen,
}) {
  const undo = useScene((s) => s.undo)
  const redo = useScene((s) => s.redo)
  const canUndo = useScene((s) => s.past.length > 0)
  const canRedo = useScene((s) => s.future.length > 0)
  const variableCount = useScene((s) => s.variables.length)

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

        <button className="bar-btn" onClick={onNew} title="Start a fresh build">
          <PlusIcon size={18} stroke="#8A93A5" />
          New
        </button>
        <button className="bar-btn" onClick={onSave} title="Save this build in your browser">
          <SaveIcon size={18} stroke="#8A93A5" />
          Save
        </button>
        <button className="bar-btn" onClick={onLoad} title="Open one of your saved builds">
          <FolderIcon size={18} stroke="#8A93A5" />
          Load
        </button>
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
