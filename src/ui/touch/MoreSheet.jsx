import Sheet from './Sheet'
import { REPO_URL } from '../../links'
import { useScene } from '../../scene/sceneStore'
import {
  ExportIcon,
  GithubIcon,
  HelpIcon,
  ImportIcon,
  ShareIcon,
  VariableIcon,
} from '../icons'

/**
 * Everything the desktop top bar carries that a thumb does not need mid-build.
 *
 * Save says Share, and means it: on a handheld the file goes to the system's
 * own sheet — Save to Files, AirDrop it to the machine with the slicer on it,
 * mail it to a parent — because a phone's downloads folder is not somewhere
 * anybody goes looking. Where the device won't take a `.babycad` it falls back
 * to a download and the toast says which happened. See io/share.
 *
 * "Save as" does not come across. It exists on the desktop because a saved
 * build holds on to its file and Save writes straight back to it; a shared
 * file is gone the moment it is sent, so every save here is already a fresh
 * one and the second command would say nothing the first does not.
 */
export default function MoreSheet({ onClose, onSave, onImport, onExport, onVariables, onHelp, sharing }) {
  const variableCount = useScene((s) => s.variables.length)
  const objects = useScene((s) => s.objects.length)

  const row = (icon, name, hint, onClick, { disabled = false } = {}) => (
    <button className="sheet-row" onClick={onClick} disabled={disabled}>
      {icon}
      <span className="sheet-row-name">{name}</span>
      {hint && <em>{hint}</em>}
    </button>
  )

  const run = (fn) => () => {
    onClose()
    fn()
  }

  return (
    <Sheet scrim title="More" onClose={onClose}>
      <div className="sheet-list">
        {row(
          <ShareIcon size={20} stroke="#C8B6FF" />,
          sharing ? 'Share this build' : 'Save this build',
          '.babycad',
          run(onSave)
        )}
        {row(
          <ExportIcon size={20} stroke="#C8B6FF" />,
          'Take it with you',
          'STL or GLB',
          run(onExport),
          { disabled: !objects }
        )}
        {row(
          <ImportIcon size={20} stroke="#8A93A5" />,
          'Bring a model in',
          'STL, OBJ, 3MF',
          run(onImport)
        )}
      </div>

      <div className="sheet-list" style={{ marginTop: 14 }}>
        {row(
          <VariableIcon size={20} stroke="#8A93A5" />,
          'Variables',
          variableCount ? String(variableCount) : 'none yet',
          run(onVariables)
        )}
        {row(<HelpIcon size={20} stroke="#8A93A5" />, 'How this works', null, run(onHelp))}
        <a className="sheet-row" href={REPO_URL} target="_blank" rel="noreferrer noopener">
          <GithubIcon size={19} fill="#8A93A5" />
          <span className="sheet-row-name">Source on GitHub</span>
        </a>
      </div>
    </Sheet>
  )
}
