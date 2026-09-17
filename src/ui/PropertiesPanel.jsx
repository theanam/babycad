import { useState } from 'react'
import { useScene } from '../scene/sceneStore'
import { useLive } from '../scene/liveStore'
import { COLOR_NAME, PALETTE, SHAPE_LABEL, SNAP } from '../constants'
import { ColorDot, CombineIcon, CopyIcon, SplitIcon, TrashIcon } from './icons'

const DEG = 180 / Math.PI
const round = (n, places = 2) => {
  const v = Number(n.toFixed(places))
  return Object.is(v, -0) ? 0 : v
}
const replaceAt = (triple, index, value) => triple.map((v, i) => (i === index ? value : v))

/**
 * A number you can type into or step. The draft is held locally while the
 * field has focus so typing "1.7" doesn't get rewritten after the "1".
 */
function NumField({ label, value, step, onCommit, disabled, suffix, hint }) {
  const [draft, setDraft] = useState(null)
  const shown = draft ?? (value == null ? '' : String(round(value)))

  const commit = (raw) => {
    setDraft(null)
    const n = parseFloat(raw)
    if (Number.isFinite(n)) onCommit(n)
  }

  return (
    <label className="numfield" title={hint}>
      <span className="numfield-axis">{label}</span>
      <input
        type="text"
        inputMode="decimal"
        value={shown}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') {
            setDraft(null)
            e.currentTarget.blur()
          }
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault()
            if (value != null) onCommit(value + (e.key === 'ArrowUp' ? step : -step))
          }
        }}
      />
      {suffix && <span className="numfield-suffix">{suffix}</span>}
    </label>
  )
}

function Row({ title, children }) {
  return (
    <div className="prop-row">
      <div className="prop-label">{title}</div>
      <div className="prop-fields">{children}</div>
    </div>
  )
}

/**
 * The one place a block is edited: what's picked, its color, its exact numbers
 * and the actions, in a single full-height rail. Everything that used to sit in
 * a bottom bar and a pop-over color sheet lives here, so the scene below the
 * canvas is never covered and there's only one place to look.
 *
 * Mid-drag it reads the live values, since the scene store deliberately doesn't
 * update until the drag ends.
 */
export default function PropertiesPanel() {
  const objects = useScene((s) => s.objects)
  const selectedIds = useScene((s) => s.selectedIds)
  const transformSelection = useScene((s) => s.transformSelection)
  const setColor = useScene((s) => s.setColor)
  const duplicate = useScene((s) => s.duplicate)
  const deleteSelection = useScene((s) => s.deleteSelection)
  const combine = useScene((s) => s.combine)
  const ungroup = useScene((s) => s.ungroup)
  const live = useLive((s) => s.live)
  const dragging = useLive((s) => s.dragging)

  const sel = objects.filter((o) => selectedIds.includes(o.id))

  if (!sel.length) {
    return (
      <aside className="props resting" aria-label="Block properties">
        <div className="props-empty">
          <div className="props-empty-art" aria-hidden="true">
            <i /><i /><i />
          </div>
          <p>Nothing selected</p>
          <span>Tap a block in the yard to color it, size it and move it.</span>
        </div>
      </aside>
    )
  }

  const multi = sel.length > 1
  const primary = sel[0]
  const grouped = sel.some((o) => o.parentGroupId)
  const allSame = (pick) => sel.every((o) => pick(o) === pick(primary))
  // Mid-drag the store is stale by design; prefer what's actually on screen.
  const shownOf = (key) => (dragging && live ? live[key] : primary[key])

  const position = shownOf('position')
  const rotation = shownOf('rotation')
  const scale = shownOf('scale')

  const color = allSame((o) => o.color) ? primary.color : null

  const centroid = [0, 1, 2].map(
    (i) => sel.reduce((sum, o) => sum + o.position[i], 0) / sel.length
  )

  /* Single selection edits the block directly. A multi-selection moves as a
     unit, so position is applied as a delta from the group's centre and the
     per-block turn and size are left to the gizmo. */
  const setPosition = (i, v) => {
    if (multi) {
      const delta = v - centroid[i]
      transformSelection(
        (o) => ({
          position: replaceAt(o.position, i, o.position[i] + delta),
          rotation: o.rotation,
          scale: o.scale,
        }),
        'move'
      )
    } else {
      transformSelection(
        (o) => ({ position: replaceAt(o.position, i, v), rotation: o.rotation, scale: o.scale }),
        'move'
      )
    }
  }

  const setRotation = (i, deg) =>
    transformSelection(
      (o) => ({ position: o.position, rotation: replaceAt(o.rotation, i, deg / DEG), scale: o.scale }),
      'turn'
    )

  const setScale = (i, v) =>
    transformSelection(
      (o) => ({
        position: o.position,
        rotation: o.rotation,
        scale: replaceAt(o.scale, i, Math.max(SNAP.scale, v)),
      }),
      'resize'
    )

  const axes = ['X', 'Y', 'Z']

  return (
    <aside className="props" aria-label="Block properties">
      <div className="props-head">
        {multi ? (
          <div className="sel-stack">
            {sel.slice(0, 3).map((o) => (
              <i key={o.id} style={{ background: o.color }} />
            ))}
          </div>
        ) : (
          <ColorDot color={primary.color} type={primary.type} size={28} />
        )}
        <div className="props-title">
          <div className="sel-name">
            {multi ? `${sel.length} blocks` : (SHAPE_LABEL[primary.type] ?? 'Block')}
          </div>
          <div className="sel-sub">
            {multi
              ? sel.slice(0, 3).map((o) => SHAPE_LABEL[o.type]?.toLowerCase()).join(' · ') +
                (sel.length > 3 ? ' · …' : '')
              : '1 selected'}
          </div>
        </div>
      </div>

      <div className="props-body">
        {multi && (
          <div className="prop-row">
            <div className="prop-label">ARRANGE</div>
            <div className="props-btns">
              <button
                className="props-btn"
                onClick={combine}
                title="Join these blocks into one piece"
              >
                <CombineIcon size={20} stroke="#fff" />
                Combine
              </button>
              <button
                className="props-btn ghost"
                onClick={ungroup}
                disabled={!grouped}
                title={grouped ? 'Break this piece back into blocks' : 'Nothing here is joined together'}
              >
                <SplitIcon size={20} stroke={grouped ? '#C3CAD9' : '#8A93A5'} />
                Split apart
              </button>
            </div>
          </div>
        )}

        <div className="prop-row">
          <div className="prop-label">COLOR</div>
          <div className="color-grid">
            {PALETTE.map((c) => (
              <button
                key={c}
                className={`color-cell${color === c ? ' on' : ''}`}
                style={{ background: c }}
                onClick={() => setColor(c)}
                title={`Paint it ${COLOR_NAME[c] ?? c}`}
                aria-label={`Paint it ${COLOR_NAME[c] ?? c}`}
                aria-pressed={color === c}
              />
            ))}
          </div>
          {!color && <div className="prop-hint">These blocks are different colors right now.</div>}
        </div>

        <Row title="POSITION">
          {axes.map((a, i) => (
            <NumField
              key={a}
              label={a}
              step={SNAP.move}
              hint={`Move ${multi ? 'the group' : 'it'} along ${a} — arrow keys step by ${SNAP.move}`}
              value={multi ? centroid[i] : position[i]}
              onCommit={(v) => setPosition(i, v)}
            />
          ))}
        </Row>

        <Row title="TURN">
          {axes.map((a, i) => (
            <NumField
              key={a}
              label={a}
              step={15}
              suffix="°"
              hint={multi ? 'Pick a single block to type a turn in' : `Turn it around ${a} — arrow keys step by 15°`}
              value={multi && !allSame((o) => o.rotation[i]) ? null : rotation[i] * DEG}
              disabled={multi}
              onCommit={(v) => setRotation(i, v)}
            />
          ))}
        </Row>

        <Row title="SIZE">
          {axes.map((a, i) => (
            <NumField
              key={a}
              label={a}
              step={SNAP.scale}
              hint={multi ? 'Pick a single block to type a size in' : `Size along ${a} — arrow keys step by ${SNAP.scale}`}
              value={multi && !allSame((o) => o.scale[i]) ? null : scale[i]}
              disabled={multi}
              onCommit={(v) => setScale(i, v)}
            />
          ))}
        </Row>

        {multi && (
          <p className="props-note">
            Turn and size are per block — pick a single block to type those in, or use the box
            handles to resize the whole group.
          </p>
        )}
      </div>

      <div className="props-foot">
        <button className="props-act" onClick={duplicate} title="Make another one just like this">
          <CopyIcon size={20} stroke="#C3CAD9" />
          Copy
        </button>
        <button
          className="props-act danger"
          onClick={deleteSelection}
          title="Remove what's selected"
        >
          <TrashIcon size={20} stroke="#FF7A6B" />
          Delete
        </button>
      </div>
    </aside>
  )
}
