import { useMemo, useRef, useState } from 'react'
import { useScene } from '../scene/sceneStore'
import { KIND_LABEL, usageCounts } from '../scene/variables'
import { CloseIcon, PlusIcon, TrashIcon, VariableIcon } from './icons'

const show = (value) => {
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  if (typeof value === 'number') {
    const rounded = Math.round(value * 1000) / 1000
    return String(Object.is(rounded, -0) ? 0 : rounded)
  }
  return String(value)
}

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n))

const TICKS = 1000

/**
 * The span a variable's slider covers. A variable has no bounds of its own —
 * it isn't attached to any one parameter — so they come from its magnitude:
 * zero to three times where it sits now, which makes a 0.06 tooth size drag
 * with the same feel as a 16-tooth count. Type in the field for anything else.
 */
function spanFor(value) {
  const reach = Math.abs(value) * 3 || 1
  return value < 0 ? { lo: -reach, hi: 0 } : { lo: 0, hi: reach }
}

/**
 * The slider runs 0..1000 and the value is mapped onto it by hand, rather than
 * putting the real numbers in `min`/`max`/`step`.
 *
 * That indirection is load-bearing. With real bounds on the element they have
 * to move as the value does, and changing `step` on a range input makes the
 * browser re-snap its value to the new grid and fire an `input` event for it —
 * which arrives just after the drag ends, reads as one more user edit, and
 * lands a second undo entry holding a number nobody chose. Fixed attributes
 * can't re-snap, so the whole class of problem goes away.
 */
const toTicks = (value, span) =>
  Math.round(clamp((value - span.lo) / (span.hi - span.lo), 0, 1) * TICKS)

const fromTicks = (ticks, span) => {
  const raw = span.lo + ((span.hi - span.lo) * ticks) / TICKS
  // Round to the slider's own resolution, so a drag yields 0.155 not 0.1546695.
  const step = (span.hi - span.lo) / TICKS
  const places = Math.max(0, Math.ceil(-Math.log10(step)) + 1)
  return Number(raw.toFixed(Math.min(places, 8)))
}

/** A text field that keeps its draft while focused, so typing "1.7" survives. */
function ValueField({ value, onCommit, label }) {
  const [draft, setDraft] = useState(null)
  return (
    <input
      className="var-value"
      inputMode="decimal"
      aria-label={label}
      value={draft ?? show(value)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={(e) => {
        setDraft(null)
        const n = parseFloat(e.target.value)
        if (Number.isFinite(n)) onCommit(n)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') {
          setDraft(null)
          e.currentTarget.blur()
        }
      }}
    />
  )
}

/** One row. Rename, retype the value, drag it, or throw it away. */
function VariableRow({ variable, used }) {
  const setVariableValue = useScene((s) => s.setVariableValue)
  const stageVariableValue = useScene((s) => s.stageVariableValue)
  const commitVariableDrag = useScene((s) => s.commitVariableDrag)
  const variableSnapshot = useScene((s) => s.variableSnapshot)
  const renameVariable = useScene((s) => s.renameVariable)
  const deleteVariable = useScene((s) => s.deleteVariable)
  const [name, setName] = useState(null)
  const [held, setHeld] = useState(null)
  const snapshot = useRef(null)

  // The span is frozen for the length of a drag: derived from the live value
  // it would stretch as the value grows, walking the far end away from the
  // thumb so the slider never catches the cursor.
  const span = held ?? spanFor(variable.value)

  const begin = () => {
    if (snapshot.current) return
    snapshot.current = variableSnapshot()
    setHeld(spanFor(variable.value))
  }
  const release = () => {
    setHeld(null)
    if (!snapshot.current) return
    commitVariableDrag(snapshot.current)
    snapshot.current = null
  }

  return (
    <div className="var-row">
      <input
        className="var-name"
        aria-label="Variable name"
        value={name ?? variable.name}
        maxLength={24}
        onChange={(e) => setName(e.target.value)}
        onBlur={(e) => {
          setName(null)
          if (e.target.value.trim() && e.target.value !== variable.name) {
            renameVariable(variable.id, e.target.value)
          }
        }}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      />

      <div className="var-control">
        {variable.kind === 'number' && (
          <>
            <ValueField
              value={variable.value}
              label={`${variable.name} value`}
              onCommit={(v) => setVariableValue(variable.id, v)}
            />
            <input
              className="param-slider var-slider"
              type="range"
              min={0}
              max={TICKS}
              step={1}
              value={toTicks(variable.value, span)}
              aria-label={`${variable.name} slider`}
              onChange={(e) => {
                begin()
                stageVariableValue(variable.id, fromTicks(Number(e.target.value), span))
              }}
              onPointerDown={begin}
              onPointerUp={release}
              onKeyUp={release}
              onBlur={release}
            />
          </>
        )}

        {variable.kind === 'choice' && (
          <div className="param-seg" role="group" aria-label={variable.name}>
            {(variable.options ?? []).map((o) => (
              <button
                key={String(o.value)}
                className={`param-seg-btn${o.value === variable.value ? ' on' : ''}`}
                aria-pressed={o.value === variable.value}
                onClick={() => setVariableValue(variable.id, o.value)}
              >
                {o.label}
              </button>
            ))}
          </div>
        )}

        {variable.kind === 'bool' && (
          <button
            className={`param-toggle${variable.value ? ' on' : ''}`}
            aria-pressed={variable.value}
            onClick={() => setVariableValue(variable.id, !variable.value)}
          >
            {variable.value ? 'Yes' : 'No'}
          </button>
        )}
      </div>

      <div className="var-used">{used ? `${used} shape${used > 1 ? 's' : ''}` : 'unused'}</div>

      <button
        className="var-del"
        onClick={() => deleteVariable(variable.id)}
        title={
          used
            ? `Delete "${variable.name}" — the ${used} shape${used > 1 ? 's' : ''} using it keep this value`
            : `Delete "${variable.name}"`
        }
        aria-label={`Delete ${variable.name}`}
      >
        <TrashIcon size={18} stroke="#FF7A6B" />
      </button>
    </div>
  )
}

/**
 * Every variable in the build, in one place: what they're called, what they're
 * worth and how many shapes are following each. Changing a value here reshapes
 * everything bound to it in one undoable step.
 */
export default function VariablesModal({ onClose }) {
  const variables = useScene((s) => s.variables)
  const objects = useScene((s) => s.objects)
  const addVariable = useScene((s) => s.addVariable)
  const [draft, setDraft] = useState('')

  const used = useMemo(() => usageCounts(objects), [objects])
  const sorted = useMemo(
    () => [...variables].sort((a, b) => a.name.localeCompare(b.name)),
    [variables]
  )

  const add = () => {
    addVariable(draft.trim() || 'value', 'number', 1)
    setDraft('')
  }

  return (
    <div className="scrim" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal vars-modal" role="dialog" aria-label="Variables">
        <div className="modal-head">
          <div className="modal-title">Variables</div>
          <div className="modal-tag">SHARED ACROSS THIS BUILD</div>
          <button className="modal-close" onClick={onClose} title="Close" aria-label="Close">
            <CloseIcon stroke="#8A93A5" />
          </button>
        </div>

        <div className="save-row">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
            placeholder="name a new number"
            aria-label="New variable name"
            maxLength={24}
          />
          <button className="save-btn" onClick={add} title="Add a number you can use anywhere">
            <PlusIcon stroke="#fff" width={2.4} />
            Add
          </button>
        </div>

        {sorted.length === 0 ? (
          <div className="vars-empty">
            <VariableIcon size={28} stroke="#3A414F" />
            <p>No variables yet</p>
            <span>
              Add one above, or press the <VariableIcon size={13} stroke="#8A93A5" /> beside any
              shape setting to turn that number into one. Anything following a variable changes
              with it.
            </span>
          </div>
        ) : (
          <>
            <div className="var-head">
              <span>NAME</span>
              <span>VALUE</span>
              <span>USED BY</span>
              <span />
            </div>
            <div className="vars-list">
              {sorted.map((v) => (
                <VariableRow key={v.id} variable={v} used={used.get(v.id) ?? 0} />
              ))}
            </div>
            <p className="props-note vars-note">
              Yes/no and either-or variables come from the{' '}
              <VariableIcon size={12} stroke="#8A93A5" /> button on a shape setting — they carry the
              choices that setting offers. {KIND_LABEL.number} variables you can add here.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
