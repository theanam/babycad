import { useScene } from '../scene/sceneStore'
import { SNAP } from '../constants'
import { AlignIcon, SnapIcon } from './icons'

/**
 * The scene-wide switches, in a strip at the top of the right rail: grid
 * snapping and, once more than one block is picked, the align targets. There
 * are no tool modes for *editing* — the bounding box handles pick the
 * operation — so this is all there is. It used to float over the scene, where
 * a single switch on its own read as a stray button; in the rail it reads as
 * a setting. Multi-select is shift-click (or Ctrl/Cmd-A for the lot) rather
 * than a mode you have to turn on first.
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
    <div className="tools" role="group" aria-label="Tools">
      <div className="tools-row">
        <button
          className={`tools-btn${snapping ? ' on' : ''}`}
          onClick={toggleSnap}
          aria-pressed={snapEnabled}
          title="Snap to the grid while dragging (hold Alt to suspend)"
        >
          <SnapIcon size={20} stroke={snapping ? '#fff' : '#8A93A5'} />
          {snapping ? `Snap ${SNAP.move} mm` : 'Free move'}
        </button>

        {multi && (
          <button
            className={`tools-btn${aligning ? ' on' : ''}`}
            onClick={toggleAlign}
            aria-pressed={aligning}
            title="Line the picked blocks up — tap a dot for the edge to bring them to (L)"
          >
            <AlignIcon size={20} stroke={aligning ? '#fff' : '#8A93A5'} />
            Align
          </button>
        )}
      </div>

      {/* Nine dots with nothing written on them is a puzzle; this is the key
          to it, and it sits here rather than in the scene so it never covers
          the blocks it's talking about. */}
      {aligning && multi && (
        <div className="tools-legend" role="note">
          Each row of dots is one axis — <i style={{ color: '#FF5A47' }}>X</i>,{' '}
          <i style={{ color: '#35C46B' }}>Y</i>, <i style={{ color: '#2E7DF6' }}>Z</i>.{' '}
          <b>Outer dots</b> bring those sides together, the <b>middle dot</b> centres them.
          Hover one to see where things will land.
        </div>
      )}
    </div>
  )
}
