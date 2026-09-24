import { useEffect, useMemo, useRef, useState } from 'react'
import { useScene } from '../scene/sceneStore'
import { useUI } from '../state/ui'
import { KIND_LABEL, usageCounts } from '../scene/variables'
import { CheckIcon, PlusIcon, TrashIcon, VariableIcon } from './icons'
import { toast } from './Toast'

const show = (value) => {
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  if (typeof value === 'number') {
    const rounded = Math.round(value * 1000) / 1000
    return String(Object.is(rounded, -0) ? 0 : rounded)
  }
  return String(value)
}

/**
 * A variable used to have a slider, and it had to invent the range it ran
 * over: zero to three times wherever the value happened to sit. A variable is
 * not attached to any one parameter, so there is no honest answer to how far
 * it should go — and an invented one is worse than none, because it reads as
 * a limit. Drag to the end of a slider and the natural conclusion is that the
 * number stops there.
 *
 * Shape parameters lost theirs for the same reason. What kept them are the
 * numbers with real ends: a shape cannot have fewer than three sides, and a
 * turn past a whole one is the turn it started at.
 */

/** A text field that keeps its draft while focused, so typing "1.7" survives. */
/**
 * The value, which can be typed as a sum.
 *
 * `600 / 4`, `PI * 50`, `2.4 * 3` — the working is often the interesting part,
 * and made to do it themselves people either fetch a calculator or round it,
 * and the rounded one is what ends up in the model. See `scene/expression` for
 * what it reads and, just as deliberately, what it refuses.
 *
 * The sum is worked out once and the answer is kept; the field shows that
 * answer the moment you press Enter, which is the plainest way of saying that
 * nothing is remembering the sum.
 */
function ValueField({ variable, onNumber, onFormula, label, focusRef }) {
  const [draft, setDraft] = useState(null)
  const shown = variable.formula ?? show(variable.value)
  return (
    <input
      ref={focusRef}
      className={`var-value${variable.formula ? ' sum' : ''}${variable.broken ? ' broken' : ''}`}
      inputMode="text"
      aria-label={label}
      title={
        variable.broken
          ? 'This sum cannot be worked out — it is showing the last number it had'
          : 'A number, or a sum: + - * / ( ), PI, and the names of other variables'
      }
      value={draft ?? shown}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={(e) => {
        setDraft(null)
        const text = e.target.value.trim()
        // A plain number is a plain number, and puts away any sum that was
        // there. Anything else is offered as a sum, and the store says whether
        // it took — a name nobody knows, or a loop, comes back as a sentence.
        const plain = Number(text)
        if (text !== '' && Number.isFinite(plain) && !/[a-z(]/i.test(text)) onNumber(plain)
        else if (text !== shown) {
          const why = onFormula(text)
          if (why) toast(why, 'warn')
        }
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

/** One row. Rename it, retype its value or its sum, or throw it away. */
function VariableRow({ variable, used, wanted }) {
  const setVariableValue = useScene((s) => s.setVariableValue)
  const setVariableFormula = useScene((s) => s.setVariableFormula)
  const renameVariable = useScene((s) => s.renameVariable)
  const deleteVariable = useScene((s) => s.deleteVariable)
  const [name, setName] = useState(null)

  /**
   * Somebody asked for this variable by name — from its chip in the rail, or
   * from the size label on the box that it drives. Bring the row into view
   * and put the cursor in its value, so the thing they went looking for is
   * the thing under their hands.
   */
  const row = useRef(null)
  const value = useRef(null)
  const clearFocus = useUI((s) => s.clearFocus)
  useEffect(() => {
    if (!wanted) return
    row.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    value.current?.focus()
    value.current?.select()
    clearFocus()
  }, [wanted, clearFocus])
  return (
    <div className="var-row" ref={row}>
      <div className="var-row-top">
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

      <div className="var-control">
        {variable.kind === 'number' && (
          <>
            <ValueField
              focusRef={value}
              variable={variable}
              label={`${variable.name} value`}
              onNumber={(v) => setVariableValue(variable.id, v)}
              onFormula={(text) => setVariableFormula(variable.id, text)}
            />
            {/* A sum shows what it comes to, since the box is showing the sum
                rather than the answer. */}
            {variable.formula && (
              <span className={`var-worked${variable.broken ? ' broken' : ''}`}>
                = {show(variable.value)}
              </span>
            )}
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

      <div className="var-used">
        {used ? `used by ${used} shape${used > 1 ? 's' : ''}` : 'not used yet'}
      </div>
    </div>
  )
}

/**
 * Every variable in the build, in one place: what they're called, what they're
 * worth and how many shapes are following each. Changing a value here reshapes
 * everything bound to it in one undoable step.
 *
 * It takes over the right-hand rail rather than opening over the scene. A
 * variable is only worth changing if you can watch the build answer, and a
 * centred sheet covers the very thing it is changing. Done hands the rail back
 * to the shape settings.
 */
export default function VariablesPanel({ onClose }) {
  const focusVariable = useUI((s) => s.focusVariable)
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
    <aside className="props vars-panel" aria-label="Variables">
      <div className="props-head">
        <div className="vars-mark" aria-hidden="true">
          <VariableIcon size={20} stroke="#C3CAD9" />
        </div>
        <div className="props-title">
          <div className="sel-name">Variables</div>
          <div className="sel-sub">
            {sorted.length
              ? `${sorted.length} shared across this build`
              : 'shared across this build'}
          </div>
        </div>
      </div>

      <div className="props-body">
        <div className="var-add">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
            placeholder="name a new number"
            aria-label="New variable name"
            maxLength={24}
          />
          <button
            className="var-add-btn"
            onClick={add}
            title="Add a number — or a sum — you can use anywhere"
          >
            <PlusIcon size={20} stroke="#fff" width={2.6} />
          </button>
        </div>

        {sorted.length === 0 ? (
          <div className="vars-empty">
            <VariableIcon size={28} stroke="#3A414F" />
            <p>No variables yet</p>
            <span>
              Name one above, or press <VariableIcon size={13} stroke="#8A93A5" /> beside any shape
              setting — press Done first, then pick a shape. Anything following a variable changes
              with it, and a variable can be a sum built from the others.
            </span>
          </div>
        ) : (
          <>
            <div className="vars-list">
              {sorted.map((v) => (
                <VariableRow
                  key={v.id}
                  variable={v}
                  used={used.get(v.id) ?? 0}
                  wanted={v.id === focusVariable}
                />
              ))}
            </div>
            <p className="props-note vars-note">
              Type a number, or a sum: <code>600/4</code>, <code>PI*10</code>, or the name of
              another variable — <code>wall*2</code> keeps up with <code>wall</code> whenever it
              changes. Yes/no and either-or variables come from the{' '}
              <VariableIcon size={12} stroke="#8A93A5" /> button on a shape setting — they carry the
              choices that setting offers. {KIND_LABEL.number} variables you can add here.
            </p>
          </>
        )}
      </div>

      <div className="props-foot">
        <button
          className="props-act wide"
          onClick={onClose}
          title="Go back to the shape settings"
        >
          <CheckIcon size={20} stroke="#C3CAD9" />
          Done
        </button>
      </div>
    </aside>
  )
}
