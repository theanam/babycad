import { useEffect, useRef, useState } from 'react'
import { defaultParams, GENERATORS, SOLIDS } from '../shapes'
import { useScene } from '../scene/sceneStore'
import { useUI } from '../state/ui'
import { viewport } from '../scene/viewportApi'
import { ChevronUpIcon, ShapeIcon } from './icons'
import { useTooltip } from './Tooltip'

/**
 * Left rail of shapes. Tapping one drops it at the camera's look-at point,
 * with its default parameters; everything about it is editable afterwards in
 * the properties panel.
 *
 * Two sections, because they are two different kinds of thing: the solids are
 * shapes you size, the generators are mechanisms you specify. The rail scrolls
 * rather than shrinking the buttons — the flyout is there for anyone who wants
 * the names as well as the pictures.
 *
 * Shapes and nothing else. It used to end in a Home button that put the camera
 * back, which is the view cube's first button doing the same job a few inches
 * below it — two ways to the same place, in a rail that is supposed to answer
 * one question.
 */
export default function ShapeTray() {
  const [open, setOpen] = useState(false)
  const addShape = useScene((s) => s.addShape)
  const drawNew = useUI((s) => s.drawNew)
  // The rail is pictures and nothing else, so hovering one has to say what it
  // is. The browser's own `title` takes over a second to appear, which is
  // longer than anybody spends deciding a rail button is not the one they
  // want — see `ui/Tooltip`.
  const tip = useTooltip()
  const wrap = useRef(null)

  const place = (type) => {
    const params = defaultParams(type)
    addShape(type, viewport.placementPoint(type, useScene.getState().objects, params), params)
  }

  // Light dismiss: a tap anywhere outside, or Escape, closes the flyout.
  useEffect(() => {
    if (!open) return
    const onDown = (e) => {
      if (!wrap.current?.contains(e.target)) setOpen(false)
    }
    const onKey = (e) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const trayButton = (s) => (
    <button
      key={s.type}
      className="tray-btn"
      onClick={() => place(s.type)}
      aria-label={`Add a ${s.label.toLowerCase()}`}
      {...tip.bind(s.label, s.blurb)}
    >
      <ShapeIcon type={s.type} size={open ? 38 : 34} />
    </button>
  )

  return (
    <div ref={wrap}>
      <nav className={`tray${open ? ' tall' : ''}`} aria-label="Shapes">
        <button
          className="tray-head"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={open ? 'Hide shape names' : 'Show shape names'}
          {...tip.bind(open ? 'Hide the names' : 'Show the names', 'Every shape, with what it is called')}
        >
          <span>SHAPES</span>
          <ChevronUpIcon size={14} stroke="#59627A" style={{ transform: open ? 'rotate(-90deg)' : 'rotate(90deg)' }} />
        </button>

        <div className="tray-scroll">
          {SOLIDS.map(trayButton)}
          <div className="tray-divider">
            <span>MAKERS</span>
          </div>
          {/* First of the makers, and the one that does not put anything
              down: everything else in this rail is a shape with its numbers
              already in it, and a drawing has to be drawn. It leads the
              group because it is the one that makes a shape of your own
              rather than one of ours. */}
          <button
            className="tray-btn"
            onClick={drawNew}
            aria-label="Draw an outline"
            {...tip.bind('Drawing', 'Draw a flat outline, or open an SVG, and give it a thickness.')}
          >
            <ShapeIcon type="sketch" size={open ? 38 : 34} />
          </button>
          {GENERATORS.map(trayButton)}
        </div>
      </nav>

      {tip.node}

      {open && (
        <div className="flyout" role="menu" aria-label="Pick a shape">
          {[
            ['TAP TO PLACE', SOLIDS, false],
            ['GENERATORS', GENERATORS, true],
          ].map(([label, shapes, leadsWithDrawing]) => (
            <div key={label} className="flyout-section">
              <div className="flyout-label">{label}</div>
              <div className="flyout-grid">
                {leadsWithDrawing && (
                  <button
                    className="flyout-btn"
                    role="menuitem"
                    title="Draw an outline and make it solid"
                    onClick={() => {
                      drawNew()
                      setOpen(false)
                    }}
                  >
                    <ShapeIcon type="sketch" size={34} />
                    Drawing
                  </button>
                )}
                {shapes.map((s) => (
                  <button
                    key={s.type}
                    className="flyout-btn"
                    role="menuitem"
                    title={s.blurb ?? `Add a ${s.label.toLowerCase()}`}
                    onClick={() => {
                      place(s.type)
                      setOpen(false)
                    }}
                  >
                    <ShapeIcon type={s.type} size={34} />
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
