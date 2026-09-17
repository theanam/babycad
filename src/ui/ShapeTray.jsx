import { useEffect, useRef, useState } from 'react'
import { SHAPES } from '../constants'
import { useScene } from '../scene/sceneStore'
import { viewport } from '../scene/viewportApi'
import { ChevronUpIcon, ResetIcon, ShapeIcon } from './icons'

/**
 * Left rail of primitives. Tapping a shape drops one at the camera's look-at
 * point. The flyout shows the same six with their names, for kids who want the
 * words as well as the pictures.
 *
 * The header is a real button rather than the design's 24px caption, so the
 * flyout has a 44px target and never depends on hover.
 */
export default function ShapeTray() {
  const [open, setOpen] = useState(false)
  const addShape = useScene((s) => s.addShape)
  const wrap = useRef(null)

  const place = (type) => {
    addShape(type, viewport.placementPoint(type, useScene.getState().objects))
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

        {SHAPES.map((s) => (
          <button
            key={s.type}
            className="tray-btn"
            onClick={() => place(s.type)}
            title={`Add a ${s.label.toLowerCase()}`}
            aria-label={`Add a ${s.label.toLowerCase()}`}
          >
            <ShapeIcon type={s.type} size={open ? 38 : 34} />
          </button>
        ))}

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
          <div className="flyout-label">TAP TO PLACE</div>
          <div className="flyout-grid">
            {SHAPES.map((s) => (
              <button
                key={s.type}
                className="flyout-btn"
                role="menuitem"
                title={`Add a ${s.label.toLowerCase()}`}
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
      )}
    </div>
  )
}
