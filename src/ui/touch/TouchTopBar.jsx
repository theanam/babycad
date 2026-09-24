import { isDirty, useDocs } from '../../state/documents'
import { ChevronUpIcon, MoreIcon, RedoIcon, UndoIcon } from '../icons'
import { useScene } from '../../scene/sceneStore'

/**
 * The top bar, on a handheld.
 *
 * Almost nothing is up here. The desktop bar carries eleven controls because a
 * mouse can reach all of them without moving the hand holding the machine; on
 * a tablet the same row would be a strip of targets at the far end of a reach,
 * so only the two that are genuinely used mid-build stay — undo and redo — and
 * the rest go to the overflow sheet, which opens at the bottom where a thumb
 * already is.
 *
 * The name of the build is the third thing, and it is a button: it says which
 * of the open builds this is and whether it has been saved, which on a device
 * with no tab strip is the only place that can be said.
 */
export default function TouchTopBar({ onMore, onDocs, compact }) {
  const doc = useDocs((s) => s.active())
  const count = useDocs((s) => s.docs.length)
  const undo = useScene((s) => s.undo)
  const redo = useScene((s) => s.redo)
  const canUndo = useScene((s) => s.past.length > 0)
  const canRedo = useScene((s) => s.future.length > 0)
  const dirty = isDirty(doc)

  return (
    <header className="topbar touch-topbar">
      {!compact && (
        <div className="brand-mark" aria-hidden="true">
          <i /><i /><i />
        </div>
      )}

      <button
        className="touch-doc"
        onClick={onDocs}
        aria-haspopup="dialog"
        aria-label={`${doc?.name ?? 'BabyCAD'} — open builds`}
      >
        <span className="touch-doc-name">{doc?.name ?? 'BabyCAD'}</span>
        {dirty && <i className="tab-dot" aria-label="not saved yet" />}
        {count > 1 && <span className="touch-doc-count">{count}</span>}
        <ChevronUpIcon size={13} stroke="#8A93A5" style={{ transform: 'rotate(180deg)' }} />
      </button>

      <div className="touch-topbar-right">
        <button className="icon-btn" onClick={undo} disabled={!canUndo} aria-label="Undo">
          <UndoIcon stroke="#8A93A5" />
        </button>
        <button className="icon-btn" onClick={redo} disabled={!canRedo} aria-label="Redo">
          <RedoIcon stroke="#8A93A5" />
        </button>
        <button className="icon-btn" onClick={onMore} aria-haspopup="dialog" aria-label="More">
          <MoreIcon stroke="#8A93A5" />
        </button>
      </div>
    </header>
  )
}
