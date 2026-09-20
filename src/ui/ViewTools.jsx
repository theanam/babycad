import { useScene } from '../scene/sceneStore'
import { SNAP } from '../constants'
import { AlignIcon, SnapIcon } from './icons'

/**
 * What changes how the gizmo behaves. There are no tool modes for *editing* —
 * the bounding box handles pick the operation — so all that floats over the
 * scene is grid snapping and, once there is more than one block picked, the
 * switch to the align targets. Multi-select is shift-click (or Ctrl/Cmd-A for
 * the lot) rather than a mode you have to turn on first.
 */
export default function ViewTools() {
  const snapEnabled = useScene((s) => s.snapEnabled)
  const toggleSnap = useScene((s) => s.toggleSnap)
  const freeMove = useScene((s) => s.freeMove)
  const aligning = useScene((s) => s.aligning)
  const toggleAlign = useScene((s) => s.toggleAlign)
  const multi = useScene((s) => s.selectedIds.length > 1)

  const snapping = snapEnabled && !freeMove

  return (
    <div className="mode-switch" role="group" aria-label="Tools">
      <button
        className={`mode-btn wide${snapping ? ' on' : ''}`}
        onClick={toggleSnap}
        aria-pressed={snapEnabled}
        title="Snap to the grid while dragging (hold Alt to suspend)"
      >
        <SnapIcon size={22} stroke={snapping ? '#fff' : '#8A93A5'} />
        {snapping ? `Snap ${SNAP.move}` : 'Free'}
      </button>

      {multi && (
        <>
          <div className="mode-sep" />
          <button
            className={`mode-btn wide${aligning ? ' on' : ''}`}
            onClick={toggleAlign}
            aria-pressed={aligning}
            title="Line the picked blocks up — tap a dot for the edge to bring them to (L)"
          >
            <AlignIcon size={22} stroke={aligning ? '#fff' : '#8A93A5'} />
            Align
          </button>
        </>
      )}
    </div>
  )
}
