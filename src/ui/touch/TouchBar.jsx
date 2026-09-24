import { useScene } from '../../scene/sceneStore'
import { IsoIcon, MeasureIcon, ShapesIcon, SnapIcon } from '../icons'

/**
 * The bottom bar: four things, always the same four, always in the same place.
 *
 * It is the whole of the desktop's left rail and tool strip, reduced to the
 * four questions somebody actually asks while building — what shall I put
 * down, how finely am I placing it, how big is that, and where am I looking
 * from. Each opens a sheet rather than a menu, because a sheet comes up under
 * the thumb and a menu drops down away from it.
 *
 * Deliberately not contextual. A bar whose buttons move when a block is
 * selected costs a child the one thing a toolbar is for, which is knowing
 * where the button was last time. Everything to do with the selection is in
 * the sheet that appears above this bar instead.
 */
export default function TouchBar({ open, onOpen }) {
  const snapEnabled = useScene((s) => s.snapEnabled)
  const snapStep = useScene((s) => s.snapStep)
  const measuring = useScene((s) => s.measuring)
  const toggleMeasure = useScene((s) => s.toggleMeasure)

  // Four, and they keep their words on a phone: the type comes down in
  // styles/touch.css rather than the labels coming off, because a row of bare
  // glyphs is a puzzle and this is a tool for children.
  const item = (id, label, icon, { on = false, onClick } = {}) => (
    <button
      className={`touchbar-btn${on ? ' on' : ''}`}
      onClick={onClick ?? (() => onOpen(open === id ? null : id))}
      aria-pressed={on || undefined}
      aria-label={label}
    >
      {icon}
      <span>{label}</span>
    </button>
  )

  return (
    <nav className="touchbar" aria-label="Tools">
      <button
        className={`touchbar-btn primary${open === 'shapes' ? ' on' : ''}`}
        onClick={() => onOpen(open === 'shapes' ? null : 'shapes')}
        aria-label="Shapes"
      >
        <ShapesIcon size={24} stroke="#fff" />
        <span>Shapes</span>
      </button>

      {item(
        'snap',
        snapEnabled ? `${snapStep} mm` : 'Free',
        <SnapIcon size={22} stroke={snapEnabled ? '#C9B6FF' : '#8A93A5'} />,
        { on: open === 'snap' }
      )}

      {item('measure', 'Measure', <MeasureIcon size={22} stroke={measuring ? '#fff' : '#8A93A5'} />, {
        on: measuring,
        onClick: toggleMeasure,
      })}

      {item('view', 'View', <IsoIcon size={22} stroke="#8A93A5" />, { on: open === 'view' })}
    </nav>
  )
}
