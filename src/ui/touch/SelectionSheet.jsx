import { useEffect, useState } from 'react'
import Sheet from './Sheet'
import PropertiesPanel from '../PropertiesPanel'
import { useScene } from '../../scene/sceneStore'
import { useUI } from '../../state/ui'
import { SHAPE_LABEL } from '../../shapes'
import { AddPickIcon, AlignIcon, ColorDot, MirrorIcon } from '../icons'

/**
 * The properties rail, as a sheet that comes up when something is picked.
 *
 * It is attached rather than modal — no scrim, nothing dimmed — because the
 * block being edited has to stay in view and stay draggable. That is the whole
 * arrangement: the sheet takes the bottom of the screen, the block stays in
 * the top of it, and a colour and a corner drag are two taps apart.
 *
 * Two heights. Peeking shows the modes, what is picked, and the actions at the
 * foot; pulled up it shows the numbers. Which one you want depends on whether
 * you are shaping by hand or by millimetre, and it is a drag or a tap on the
 * grab bar between them.
 *
 * Turning on Align or Mirror drops it back to peeking on its own. Both put
 * targets in the scene to press, and a sheet standing over them is a sheet
 * standing over the only thing the mode is for.
 */
export default function SelectionSheet() {
  const sel = useScene((s) => s.selectedIds)
  const objects = useScene((s) => s.objects)
  const clearSelection = useScene((s) => s.clearSelection)
  const aligning = useScene((s) => s.aligning)
  const toggleAlign = useScene((s) => s.toggleAlign)
  const mirroring = useScene((s) => s.mirroring)
  const toggleMirror = useScene((s) => s.toggleMirror)
  const pickMore = useUI((s) => s.pickMore)
  const togglePickMore = useUI((s) => s.togglePickMore)

  const [detent, setDetent] = useState('peek')

  // A mode that draws in the scene needs the scene visible.
  useEffect(() => {
    if (aligning || mirroring) setDetent('peek')
  }, [aligning, mirroring])

  const picked = objects.filter((o) => sel.includes(o.id))
  if (!picked.length) return null

  const multi = picked.length > 1
  const primary = picked[0]

  return (
    <Sheet
      flush
      detent={detent}
      onDetent={setDetent}
      onClose={clearSelection}
      label="What's picked"
      className="selection-sheet"
      lead={
        multi ? (
          <div className="sel-stack">
            {picked.slice(0, 3).map((o) => (
              <i key={o.id} style={{ background: o.color }} />
            ))}
          </div>
        ) : (
          <ColorDot color={primary.color} type={primary.type} size={26} />
        )
      }
      title={multi ? `${picked.length} blocks` : (SHAPE_LABEL[primary.type] ?? 'Block')}
      subtitle={
        multi
          ? picked.slice(0, 3).map((o) => SHAPE_LABEL[o.type]?.toLowerCase()).join(' · ') +
            (picked.length > 3 ? ' · …' : '')
          : '1 picked'
      }
    >
      <div className="sel-modes">
        <button
          className={`sel-mode${pickMore ? ' on' : ''}`}
          onClick={togglePickMore}
          aria-pressed={pickMore}
        >
          <AddPickIcon size={19} stroke={pickMore ? '#fff' : '#8A93A5'} />
          Pick more
        </button>
        {multi && (
          <button
            className={`sel-mode${aligning ? ' on' : ''}`}
            onClick={toggleAlign}
            aria-pressed={aligning}
          >
            <AlignIcon size={19} stroke={aligning ? '#fff' : '#8A93A5'} />
            Line up
          </button>
        )}
        <button
          className={`sel-mode${mirroring ? ' on' : ''}`}
          onClick={toggleMirror}
          aria-pressed={mirroring}
        >
          <MirrorIcon size={19} stroke={mirroring ? '#fff' : '#8A93A5'} />
          Flip
        </button>
      </div>

      {/* Nine unlabelled dots in the scene are a puzzle. On the desktop the
          key to them sits in the tool strip; here it goes above the scrolling
          body, so it is on screen at the short rung the mode drops to. */}
      {aligning && multi && (
        <div className="tools-legend sel-legend" role="note">
          Each row of dots is one axis — <i style={{ color: '#FF5A47' }}>X</i>,{' '}
          <i style={{ color: '#35C46B' }}>Y</i>, <i style={{ color: '#2E7DF6' }}>Z</i>.{' '}
          <b>Outer dots</b> bring those sides together, the <b>middle dot</b> centres them.
        </div>
      )}

      <PropertiesPanel embedded />
    </Sheet>
  )
}
