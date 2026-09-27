import Sheet from './Sheet'
import { defaultParams, GENERATORS, SOLIDS } from '../../shapes'
import { useScene } from '../../scene/sceneStore'
import { viewport } from '../../scene/viewportApi'
import { ShapeIcon } from '../icons'
import { useUI } from '../../state/ui'

/**
 * The shape tray, as a sheet.
 *
 * The desktop rail is a column of pictures you hover for a name. There is no
 * hover here, so every shape carries its label — which is also why this is a
 * sheet rather than a rail: twenty-three named buttons need width, and width
 * is the one thing a handheld has more of than height.
 *
 * It closes on placing, the way the desktop flyout does. The block lands in
 * front of the camera, and a sheet still covering half the plate would hide
 * the thing that just happened.
 */
export default function ShapeSheet({ onClose }) {
  const addShape = useScene((s) => s.addShape)
  const drawNew = useUI((s) => s.drawNew)

  const place = (type) => {
    const params = defaultParams(type)
    addShape(type, viewport.placementPoint(type, useScene.getState().objects, params), params)
    onClose()
  }

  return (
    <Sheet scrim title="Put something down" onClose={onClose} className="shape-sheet">
      {[
        ['SHAPES', SOLIDS, false],
        ['MAKERS', GENERATORS, true],
      ].map(([label, shapes, leadsWithDrawing]) => (
        <section key={label} className="sheet-section">
          <div className="sheet-label">{label}</div>
          <div className="shape-grid">
            {/* First of the makers: the one that makes a shape of your own
                rather than one of ours. */}
            {leadsWithDrawing && (
              <button
                className="shape-cell"
                onClick={() => {
                  drawNew()
                  onClose()
                }}
                aria-label="Draw an outline"
              >
                <ShapeIcon type="sketch" size={36} />
                <span>Drawing</span>
              </button>
            )}
            {shapes.map((s) => (
              <button
                key={s.type}
                className="shape-cell"
                onClick={() => place(s.type)}
                aria-label={`Add a ${s.label.toLowerCase()}`}
              >
                <ShapeIcon type={s.type} size={36} />
                <span>{s.label}</span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </Sheet>
  )
}
