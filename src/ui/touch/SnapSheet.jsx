import Sheet from './Sheet'
import { SNAP_STEPS } from '../../constants'
import { useScene } from '../../scene/sceneStore'
import { CheckIcon } from '../icons'

/**
 * How finely things place — the desktop's snap switch and its drop-down, as
 * one list.
 *
 * On the desktop the switch is a toggle with a menu hung off an arrow beside
 * it, and the grid is chosen by right-clicking. Neither the narrow arrow nor
 * the right-click survives the trip to a finger, so the on/off and the choice
 * of grid become one row each in a list of rows — which is what they always
 * were underneath: free move is simply the step that isn't a step.
 */
export default function SnapSheet({ onClose }) {
  const snapEnabled = useScene((s) => s.snapEnabled)
  const snapStep = useScene((s) => s.snapStep)
  const setSnapStep = useScene((s) => s.setSnapStep)
  const floorSnap = useScene((s) => s.floorSnap)
  const toggleFloorSnap = useScene((s) => s.toggleFloorSnap)

  const row = (on, label, hint, onClick) => (
    <button className={`sheet-row${on ? ' on' : ''}`} onClick={onClick} aria-checked={on} role="menuitemradio">
      <span className="sheet-row-name">{label}</span>
      {hint && <em>{hint}</em>}
      {on && <CheckIcon size={18} stroke="#C9B6FF" />}
    </button>
  )

  return (
    <Sheet scrim title="Grid" subtitle="How far a block jumps as you drag it" onClose={onClose}>
      <div className="sheet-list" role="menu">
        {SNAP_STEPS.map(({ mm, deg }) =>
          row(snapEnabled && snapStep === mm, `${mm} mm`, `turns by ${deg}°`, () => setSnapStep(mm))
        )}
        {row(!snapEnabled, 'Free move', 'no grid at all', () => setSnapStep(0))}
      </div>

      <div className="sheet-list" style={{ marginTop: 14 }}>
        <button
          className={`sheet-row${floorSnap ? ' on' : ''}`}
          onClick={toggleFloorSnap}
          role="menuitemcheckbox"
          aria-checked={floorSnap}
        >
          <span className="sheet-row-name">Snap to the plate</span>
          <em>{floorSnap ? 'on' : 'off'}</em>
          {floorSnap && <CheckIcon size={18} stroke="#C9B6FF" />}
        </button>
      </div>
    </Sheet>
  )
}
