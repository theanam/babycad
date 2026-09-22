import { useEffect, useRef, useState } from 'react'
import { useScene } from '../scene/sceneStore'
import { SNAP_STEPS } from '../constants'
import { AlignIcon, ChevronUpIcon, SnapIcon } from './icons'

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
  const snapStep = useScene((s) => s.snapStep)
  const toggleSnap = useScene((s) => s.toggleSnap)
  const setSnapStep = useScene((s) => s.setSnapStep)
  const freeMove = useScene((s) => s.freeMove)

  // The step menu: right-click the switch, or press the arrow beside it for
  // anyone without a right button. Light dismiss on a tap anywhere else or
  // on Escape.
  const [menu, setMenu] = useState(false)
  const wrap = useRef(null)
  useEffect(() => {
    if (!menu) return
    const onDown = (e) => {
      if (!wrap.current?.contains(e.target)) setMenu(false)
    }
    const onKey = (e) => e.key === 'Escape' && setMenu(false)
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menu])
  const pick = (step) => {
    setSnapStep(step)
    setMenu(false)
  }
  const aligning = useScene((s) => s.aligning)
  const toggleAlign = useScene((s) => s.toggleAlign)
  const multi = useScene((s) => s.selectedIds.length > 1)

  const snapping = snapEnabled && !freeMove

  return (
    <div className="tools" role="group" aria-label="Tools">
      <div className="tools-row">
        <div className="tools-snap" ref={wrap}>
          <button
            className={`tools-btn${snapping ? ' on' : ''}`}
            onClick={toggleSnap}
            onContextMenu={(e) => {
              e.preventDefault()
              setMenu((m) => !m)
            }}
            aria-pressed={snapEnabled}
            title="Snap to the grid while dragging — right-click for the grid, which sets the turn step too (hold Alt to suspend)"
          >
            <SnapIcon size={20} stroke={snapping ? '#fff' : '#8A93A5'} />
            {snapping ? `Snap ${snapStep} mm` : 'Free move'}
          </button>
          <button
            className={`tools-chevron${snapping ? ' on' : ''}`}
            onClick={() => setMenu((m) => !m)}
            aria-haspopup="menu"
            aria-expanded={menu}
            aria-label="Choose the snap grid"
            title="Choose the snap grid"
          >
            <ChevronUpIcon size={16} stroke={snapping ? '#fff' : '#8A93A5'} style={{ transform: 'rotate(180deg)' }} />
          </button>

          {menu && (
            <div className="tools-menu" role="menu" aria-label="Snap grid">
              {SNAP_STEPS.map(({ mm, deg }) => (
                <button
                  key={mm}
                  role="menuitemradio"
                  className={snapEnabled && snapStep === mm ? 'on' : ''}
                  aria-checked={snapEnabled && snapStep === mm}
                  onClick={() => pick(mm)}
                >
                  Snap {mm} mm <em>· {deg}°</em>
                </button>
              ))}
              <button
                role="menuitemradio"
                className={!snapEnabled ? 'on' : ''}
                aria-checked={!snapEnabled}
                onClick={() => pick(0)}
              >
                Free move
              </button>
            </div>
          )}
        </div>

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
