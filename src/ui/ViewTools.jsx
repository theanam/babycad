import { useScene } from '../scene/sceneStore'
import { SNAP } from '../constants'
import { PickManyIcon, SnapIcon } from './icons'

/**
 * The two things that change how the gizmo behaves. There are no tool modes
 * any more — the bounding box handles pick the operation — so all that's left
 * floating over the scene is multi-select and grid snapping.
 */
export default function ViewTools() {
  const pickMany = useScene((s) => s.pickMany)
  const togglePickMany = useScene((s) => s.togglePickMany)
  const snapEnabled = useScene((s) => s.snapEnabled)
  const toggleSnap = useScene((s) => s.toggleSnap)
  const freeMove = useScene((s) => s.freeMove)

  const snapping = snapEnabled && !freeMove

  return (
    <div className="mode-switch" role="group" aria-label="Tools">
      <button
        className={`mode-btn wide${pickMany ? ' on' : ''}`}
        onClick={togglePickMany}
        aria-pressed={pickMany}
        title="Tap several blocks in a row"
      >
        <PickManyIcon size={22} stroke={pickMany ? '#fff' : '#8A93A5'} />
        Pick many
      </button>

      <div className="mode-sep" />

      <button
        className={`mode-btn wide${snapping ? ' on' : ''}`}
        onClick={toggleSnap}
        aria-pressed={snapEnabled}
        title="Snap to the grid while dragging (hold Alt to suspend)"
      >
        <SnapIcon size={22} stroke={snapping ? '#fff' : '#8A93A5'} />
        {snapping ? `Snap ${SNAP.move}` : 'Free'}
      </button>
    </div>
  )
}
