import { useEffect, useRef, useState } from 'react'
import { defaultParams, GENERATORS, SOLIDS } from '../shapes'
import { useScene } from '../scene/sceneStore'
import { viewport } from '../scene/viewportApi'
import { ChevronUpIcon, ResetIcon, ShapeIcon } from './icons'

/**
 * Left rail of shapes. Tapping one drops it at the camera's look-at point,
 * with its default parameters; everything about it is editable afterwards in
 * the properties panel.
 *
 * Two sections, because they are two different kinds of thing: the solids are
 * shapes you size, the generators are mechanisms you specify. The rail scrolls
 * rather than shrinking the buttons — the flyout is there for anyone who wants
 * the names as well as the pictures.
 */
export default function ShapeTray() {
  const [open, setOpen] = useState(false)
  const addShape = useScene((s) => s.addShape)
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
      title={s.blurb ? `Add a ${s.label.toLowerCase()} — ${s.blurb}` : `Add a ${s.label.toLowerCase()}`}
      aria-label={`Add a ${s.label.toLowerCase()}`}
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
          title={open ? 'Hide the shape names' : 'Show the shape names'}
          aria-label={open ? 'Hide shape names' : 'Show shape names'}
        >
          <span>SHAPES</span>
          <ChevronUpIcon size={14} stroke="#59627A" style={{ transform: open ? 'rotate(-90deg)' : 'rotate(90deg)' }} />
        </button>

        <div className="tray-scroll">
          {SOLIDS.map(trayButton)}
          <div className="tray-divider">
            <span>MAKERS</span>
          </div>
          {GENERATORS.map(trayButton)}
        </div>

        <button
          className="tray-home"
          onClick={() => viewport.resetView()}
          title="Put the camera back where it started"
          aria-label="Reset the view"
        >
          <ResetIcon stroke="#8A93A5" />
          <span>HOME</span>
        </button>
      </nav>

      {open && (
        <div className="flyout" role="menu" aria-label="Pick a shape">
          {[
            ['TAP TO PLACE', SOLIDS],
            ['GENERATORS', GENERATORS],
          ].map(([label, shapes]) => (
            <div key={label} className="flyout-section">
              <div className="flyout-label">{label}</div>
              <div className="flyout-grid">
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
