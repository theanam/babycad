import { useRef, useState } from 'react'
import { useScene } from '../scene/sceneStore'
import { useLive } from '../scene/liveStore'
import { COLOR_NAME, PALETTE, SNAP } from '../constants'
import { getShapeDef, SHAPE_LABEL } from '../shapes'
import { ColorDot, CombineIcon, CopyIcon, ResetIcon, SplitIcon, TrashIcon } from './icons'
import ParamMenu from './ParamMenu'

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
    <label className={`numfield${label ? '' : ' bare'}`} title={hint}>
      {label && <span className="numfield-axis">{label}</span>}
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

/* ------------------------------------------------------ shape parameters -- */

/**
 * One parameter, rendered from its spec. Numbers get a field *and* a slider:
 * the field is how you hit an exact tooth count, the slider is how you find
 * out what a helix angle even does. Dragging the slider rebuilds the geometry
 * live and lands a single undo entry when you let go.
 */
function ParamField({
  spec,
  value,
  mixed,
  variable,
  variables,
  onBegin,
  onPreview,
  onCommit,
  onRelease,
  onPromote,
  onBind,
  onUnbind,
}) {
  const menu = (
    <ParamMenu
      spec={spec}
      variable={variable}
      variables={variables}
      onPromote={onPromote}
      onBind={onBind}
      onUnbind={onUnbind}
    />
  )

  /* Bound: the variable owns the value, so the control is replaced by the
     variable's name. Editing it here would either fight the variable or
     silently break the link — unlinking is in the menu, deliberately. */
  if (variable) {
    return (
      <div className="param linked">
        <div className="param-top">
          <span className="param-name">{spec.label}</span>
          <div className="param-chip" title={`Follows the variable "${variable.name}"`}>
            {variable.name}
          </div>
          {menu}
        </div>
        <div className="param-readout">
          = {formatValue(spec, value)}
          {spec.unit ?? ''}
        </div>
      </div>
    )
  }

  if (spec.kind === 'choice') {
    return (
      <div className="param">
        <div className="param-top">
          <span className="param-name">{spec.label}</span>
          {menu}
        </div>
        <div className="param-seg" role="group" aria-label={spec.label}>
          {spec.options.map((o) => (
            <button
              key={String(o.value)}
              className={`param-seg-btn${!mixed && o.value === value ? ' on' : ''}`}
              aria-pressed={!mixed && o.value === value}
              onClick={() => onCommit(o.value)}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
    )
  }

  if (spec.kind === 'bool') {
    return (
      <div className="param">
        <div className="param-top">
          <span className="param-name">{spec.label}</span>
          <button
            className={`param-toggle${value ? ' on' : ''}`}
            aria-pressed={!!value}
            onClick={() => onCommit(!value)}
          >
            {value ? 'On' : 'Off'}
          </button>
          {menu}
        </div>
      </div>
    )
  }

  return (
    <div className="param">
      <div className="param-top">
        <span className="param-name">{spec.label}</span>
        <NumField
          value={mixed ? null : value}
          step={spec.step}
          suffix={spec.unit}
          hint={`${spec.label} — ${spec.min} to ${spec.max}`}
          onCommit={onCommit}
        />
        {menu}
      </div>
      <input
        className="param-slider"
        type="range"
        min={spec.min}
        max={spec.max}
        step={spec.step}
        value={value}
        aria-label={spec.label}
        onChange={(e) => onPreview(Number(e.target.value))}
        onPointerDown={onBegin}
        onPointerUp={onRelease}
        onKeyUp={onRelease}
        onBlur={onRelease}
      />
    </div>
  )
}

const formatValue = (spec, value) => {
  if (spec.kind === 'bool') return value ? 'on' : 'off'
  if (spec.kind === 'choice') return spec.options.find((o) => o.value === value)?.label ?? value
  return round(value, 3)
}

/**
 * The parameters of whatever is selected, as long as it's all one shape.
 * Mixed selections get a note instead — there is no sensible way to show a
 * gear's teeth and a sphere's rings in the same list.
 */
function ShapeSection({ sel }) {
  const stageParams = useScene((s) => s.stageParams)
  const setParams = useScene((s) => s.setParams)
  const commitParams = useScene((s) => s.commitParams)
  const resetParams = useScene((s) => s.resetParams)
  const variables = useScene((s) => s.variables)
  const promoteToVariable = useScene((s) => s.promoteToVariable)
  const bindParam = useScene((s) => s.bindParam)
  const unbindParam = useScene((s) => s.unbindParam)
  const snapshot = useRef(null)

  const def = getShapeDef(sel[0].type)
  const primary = sel[0]
  const label = def.label.toLowerCase()
  const ids = sel.map((o) => o.id)
  const byId = new Map(variables.map((v) => [v.id, v]))

  const fanOut = (key, value) => Object.fromEntries(sel.map((o) => [o.id, { [key]: value }]))

  const begin = () => {
    if (!snapshot.current) snapshot.current = Object.fromEntries(sel.map((o) => [o.id, o.params]))
  }
  const release = () => {
    if (!snapshot.current) return
    commitParams(snapshot.current, `shape ${label}`)
    snapshot.current = null
  }

  return (
    <div className="prop-row">
      <div className="prop-label prop-label-row">
        <span>{def.label.toUpperCase()}</span>
        <button
          className="prop-mini"
          onClick={resetParams}
          title={`Put this ${label} back to its starting numbers`}
        >
          <ResetIcon size={13} stroke="#8A93A5" />
          Reset
        </button>
      </div>

      {def.blurb && <div className="prop-hint prop-blurb">{def.blurb}</div>}

      <div className="param-list">
        {def.params.map((spec) => {
          const mixed = sel.some((o) => o.params[spec.key] !== primary.params[spec.key])
          // Only call it bound if the *whole* selection follows the same
          // variable; a half-linked selection reads as unlinked, and picking a
          // variable from the menu links all of it.
          const boundTo = primary.bindings?.[spec.key]
          const allBound = boundTo && sel.every((o) => o.bindings?.[spec.key] === boundTo)
          return (
            <ParamField
              key={spec.key}
              spec={spec}
              value={primary.params[spec.key]}
              mixed={mixed}
              variable={allBound ? byId.get(boundTo) : null}
              variables={variables}
              onPromote={(name) => promoteToVariable(ids, spec.key, name)}
              onBind={(id) => bindParam(ids, spec.key, id)}
              onUnbind={() => unbindParam(ids, spec.key)}
              onBegin={begin}
              onPreview={(value) => {
                begin()
                stageParams(fanOut(spec.key, value))
              }}
              onRelease={release}
              onCommit={(value) => {
                snapshot.current = null
                setParams(fanOut(spec.key, value), `shape ${label}`)
              }}
            />
          )
        })}
      </div>
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
  const oneShape = allSame((o) => o.type)
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

        {oneShape ? (
          <ShapeSection sel={sel} />
        ) : (
          <div className="prop-row">
            <div className="prop-label">SHAPE</div>
            <div className="prop-hint">
              These are different shapes, so there's no one set of numbers to show. Pick just one
              to change what it's made of.
            </div>
          </div>
        )}

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
