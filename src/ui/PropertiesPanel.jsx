import { useRef, useState } from 'react'
import { bottomOf, useScene } from '../scene/sceneStore'
import { AXES } from '../scene/axes'
import { useLive } from '../scene/liveStore'
import { angleStepFor, COLOR_NAME, PALETTE, SNAP } from '../constants'
import { getShapeDef, SHAPE_LABEL } from '../shapes'
import { ColorDot, CombineIcon, CopyIcon, ResetIcon, SplitIcon, TrashIcon } from './icons'
import ParamMenu from './ParamMenu'
import { useUI } from '../state/ui'
import { toast } from './Toast'

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
          <button
            className="param-chip"
            onClick={() => useUI.getState().revealVariable(variable.id)}
            title={`Follows "${variable.name}" — open it in Variables`}
          >
            {variable.name}
          </button>
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

  if (spec.kind === 'text') {
    return (
      <div className="param">
        <div className="param-top">
          <span className="param-name">{spec.label}</span>
          {menu}
        </div>
        {/* Committed on blur and on Enter rather than on every keystroke: each
            commit rebuilds the solid and lands on the undo stack, and a word
            typed letter by letter would leave eight rebuilds and eight steps
            to undo. Escape puts back what was there and gives up focus. */}
        <input
          className="param-text"
          type="text"
          defaultValue={mixed ? '' : value}
          key={mixed ? 'mixed' : value}
          maxLength={spec.maxLength}
          placeholder={mixed ? 'Mixed' : spec.default}
          aria-label={spec.label}
          spellCheck={false}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            else if (e.key === 'Escape') {
              e.currentTarget.value = mixed ? '' : value
              e.currentTarget.blur()
            }
            // The viewport listens for Delete and Ctrl+A on the window; without
            // this, backspacing a letter would delete the block being renamed.
            e.stopPropagation()
          }}
          onBlur={(e) => {
            const next = e.target.value
            if (next !== value) onCommit(next)
          }}
        />
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
  if (spec.kind === 'text') return value
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
    if (!snapshot.current) {
      snapshot.current = Object.fromEntries(
        sel.map((o) => [o.id, { params: o.params, position: o.position }])
      )
    }
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
  const snapStep = useScene((s) => s.snapStep)
  const setColor = useScene((s) => s.setColor)
  const setHole = useScene((s) => s.setHole)
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
  // A mixed selection reads as neither, and picking either makes it all one.
  const isHole = allSame((o) => Boolean(o.hole)) ? Boolean(primary.hole) : null
  // A hole cuts the moment it overlaps something; combining is what tidies the
  // ghost away afterwards. Worth saying, since nothing on screen suggests
  // there is a second step available.
  const looseHole = isHole !== false && sel.some((o) => o.hole && !o.parentGroupId)

  const centroid = [0, 1, 2].map(
    (i) => sel.reduce((sum, o) => sum + o.position[i], 0) / sel.length
  )

  /* Z is not the centre. A block's position is its centre, which is the right
     number for X and Y, but "how high is it" means how far its underside is
     off the plate — a block resting on the plate is at 0, not at half its
     height. So the height axis shows the underside, and typing into it moves
     the underside there. For several blocks it is the lowest underside of the
     lot, and typing moves them all by the same amount. */
  const UP = 1
  const undersideOf = (o, pos = o.position, rot = o.rotation, scl = o.scale) =>
    pos[UP] + bottomOf({ ...o, rotation: rot, scale: scl })
  const shownUnderside = multi
    ? Math.min(...sel.map((o) => undersideOf(o)))
    : undersideOf(primary, position, rotation, scale)

  /* Single selection edits the block directly. A multi-selection moves as a
     unit, so position is applied as a delta from the group's centre and the
     per-block turn and size are left to the gizmo. */
  const setPosition = (i, v) => {
    if (multi) {
      const delta = v - (i === UP ? shownUnderside : centroid[i])
      transformSelection(
        (o) => ({
          position: replaceAt(o.position, i, o.position[i] + delta),
          rotation: o.rotation,
          scale: o.scale,
        }),
        'move'
      )
    } else {
      const target = i === UP ? v - bottomOf(primary) : v
      transformSelection(
        (o) => ({ position: replaceAt(o.position, i, target), rotation: o.rotation, scale: o.scale }),
        'move'
      )
    }
  }

  const setRotation = (i, deg) =>
    transformSelection(
      (o) => ({ position: o.position, rotation: replaceAt(o.rotation, i, deg / DEG), scale: o.scale }),
      'turn'
    )

  // Typing a size goes the same way a corner drag does: into the shape's own
  // millimetres wherever the shape can hold it, so the two never disagree.
  const setScale = (i, v) => {
    const blocked = transformSelection(
      (o) => ({
        position: o.position,
        rotation: o.rotation,
        scale: replaceAt(o.scale, i, Math.max(SNAP.scale, v)),
      }),
      'resize'
    )
    if (blocked?.length) {
      toast(`${blocked.join(' and ')} follows a variable — change it in Variables`, 'warn')
    }
  }

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
          <div className="prop-label">SOLID OR HOLE</div>
          <div className="param-seg prop-seg" role="group" aria-label="Solid or hole">
            <button
              className={`param-seg-btn${isHole === false ? ' on' : ''}`}
              onClick={() => setHole(false)}
              aria-pressed={isHole === false}
              title="A normal block, made of something"
            >
              Solid
            </button>
            <button
              className={`param-seg-btn${isHole === true ? ' on' : ''}`}
              onClick={() => setHole(true)}
              aria-pressed={isHole === true}
              title="Cuts its shape out of whatever it's combined with"
            >
              Hole
            </button>
          </div>
          {looseHole && (
            <div className="prop-hint">
              It&apos;s already cutting whatever it overlaps. <strong>Combine</strong> it with that
              block to put the grey away and leave just the cut.
            </div>
          )}
        </div>

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
          {isHole === true ? (
            <div className="prop-hint">
              Holes are drawn grey and see-through — the colour comes back if you make it solid
              again.
            </div>
          ) : (
            !color && <div className="prop-hint">These blocks are different colors right now.</div>
          )}
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

        {/* Labelled the CAD way — Z is the one that goes up. `slot` is where
            that axis lives in the scene's own y-up triples, and `sign` flips
            the one that points the other way; see scene/axes. */}
        <Row title="POSITION (MM)">
          {AXES.map((a) => (
            <NumField
              key={a.label}
              label={a.label}
              step={snapStep}
              hint={
                a.slot === UP
                  ? `How far ${multi ? 'the lowest block' : 'its underside'} is above the plate — 0 is resting on it`
                  : `Move ${multi ? 'the group' : 'it'} along ${a.label} — arrow keys step by ${snapStep}`
              }
              value={
                a.slot === UP ? shownUnderside : (multi ? centroid[a.slot] : position[a.slot]) * a.sign
              }
              onCommit={(v) => setPosition(a.slot, v * a.sign)}
            />
          ))}
        </Row>

        <Row title="TURN">
          {AXES.map((a) => (
            <NumField
              key={a.label}
              label={a.label}
              step={angleStepFor(snapStep)}
              suffix="°"
              hint={
                multi
                  ? 'Pick a single block to type a turn in'
                  : `Turn it around ${a.label} — arrow keys step by ${angleStepFor(snapStep)}°`
              }
              value={
                multi && !allSame((o) => o.rotation[a.slot])
                  ? null
                  : rotation[a.slot] * DEG * a.sign
              }
              disabled={multi}
              onCommit={(v) => setRotation(a.slot, v * a.sign)}
            />
          ))}
        </Row>

        {/* What's left over after a resize has been written into the shape's
            own millimetres above — see shapes/resize. Most resizes leave
            nothing here and these read 1.00; a ball squashed on one axis has
            no radius that describes it, and that is what this row is for.
            Being a magnitude it takes the axis's slot but not its sign: a
            block stretched 2 deep is 2 deep whichever way the axis runs. */}
        <Row title="STRETCH (×)">
          {AXES.map((a) => (
            <NumField
              key={a.label}
              label={a.label}
              step={SNAP.scale}
              hint={
                multi
                  ? 'Pick a single block to type a stretch in'
                  : `Stretch along ${a.label} — the millimetres are up in ${
                      oneShape ? getShapeDef(primary.type).label.toUpperCase() : 'the shape'
                    }`
              }
              value={multi && !allSame((o) => o.scale[a.slot]) ? null : scale[a.slot]}
              disabled={multi}
              onCommit={(v) => setScale(a.slot, v)}
            />
          ))}
        </Row>

        {multi && (
          <p className="props-note">
            Turn and stretch are per block — pick a single block to type those in, or use the box
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
