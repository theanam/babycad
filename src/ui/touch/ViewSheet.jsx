import Sheet from './Sheet'
import { useScene } from '../../scene/sceneStore'
import { viewport } from '../../scene/viewportApi'
import { FitIcon, IsoIcon, ResetIcon } from '../icons'

/**
 * Where to look from.
 *
 * The view cube does this on the desktop, and on a tablet it still does — it
 * is a good touch target and dragging it turns the view. A phone has no corner
 * to spare for a 132px widget, so the six sides it offers are spelt out here
 * instead, in the CAD names the rest of the app uses.
 *
 * Directions are in the scene's own y-up frame; TOP is +Y, and FRONT is the
 * +Z the camera starts in front of. See scene/axes for why the labels and the
 * numbers disagree with the internals on purpose.
 */
const SIDES = [
  ['Top', [0, 1, 0]],
  ['Front', [0, 0, 1]],
  ['Right', [1, 0, 0]],
  ['Bottom', [0, -1, 0]],
  ['Back', [0, 0, -1]],
  ['Left', [-1, 0, 0]],
]

export default function ViewSheet({ onClose }) {
  const selectedIds = useScene((s) => s.selectedIds)

  const go = (fn) => () => {
    fn()
    onClose()
  }

  return (
    <Sheet scrim title="View" onClose={onClose}>
      <div className="view-grid">
        <button className="view-cell wide" onClick={go(() => viewport.resetView())}>
          <ResetIcon size={20} stroke="#C3CAD9" />
          Start again
        </button>
        <button className="view-cell wide" onClick={go(() => viewport.fit(selectedIds))}>
          <FitIcon size={20} stroke="#C3CAD9" />
          {selectedIds.length ? 'Fit what’s picked' : 'Fit it all'}
        </button>
        <button className="view-cell wide" onClick={go(() => viewport.isoView())}>
          <IsoIcon size={20} stroke="#C3CAD9" />
          Corner
        </button>
      </div>

      <div className="sheet-label" style={{ marginTop: 16 }}>LOOK FROM</div>
      <div className="view-grid">
        {SIDES.map(([label, dir]) => (
          <button key={label} className="view-cell" onClick={go(() => viewport.lookFrom(dir))}>
            {label}
          </button>
        ))}
      </div>
    </Sheet>
  )
}
