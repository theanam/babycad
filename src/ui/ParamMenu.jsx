import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { candidatesFor } from '../scene/variables'
import { LinkIcon, VariableIcon } from './icons'

const MENU_WIDTH = 236

const show = (value) => {
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  if (typeof value === 'number') {
    const rounded = Math.round(value * 1000) / 1000
    return String(Object.is(rounded, -0) ? 0 : rounded)
  }
  return String(value)
}

/**
 * The little button beside every parameter, and the menu it opens: turn this
 * value into a variable, or point it at one that already exists.
 *
 * The menu is portalled to the body rather than drawn in place. The properties
 * rail scrolls, and a pop-over drawn inside a scroll container is clipped by
 * it — which for the bottom-most parameter of a gear means the menu is simply
 * invisible. Fixed positioning off the button's rect avoids that entirely; the
 * trade is that it can't follow a scroll, so scrolling closes it.
 */
export default function ParamMenu({ spec, variable, variables, onPromote, onBind, onUnbind }) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [at, setAt] = useState(null)
  const button = useRef(null)
  const panel = useRef(null)

  const candidates = candidatesFor(spec, variables)

  useLayoutEffect(() => {
    if (!open) return
    const rect = button.current.getBoundingClientRect()
    setAt({
      top: rect.bottom + 6,
      left: Math.max(8, Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8)),
    })
  }, [open])

  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    const onDown = (e) => {
      if (!panel.current?.contains(e.target) && !button.current?.contains(e.target)) close()
    }
    const onKey = (e) => e.key === 'Escape' && close()
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    // A fixed menu can't follow the rail, so a scroll dismisses it instead.
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [open])

  const toggle = () => {
    setDraft(spec.label)
    setOpen((v) => !v)
  }

  const promote = () => {
    onPromote(draft.trim() || spec.label)
    setOpen(false)
  }

  return (
    <>
      <button
        ref={button}
        className={`param-menu-btn${variable ? ' linked' : ''}${open ? ' open' : ''}`}
        onClick={toggle}
        aria-expanded={open}
        aria-haspopup="menu"
        title={
          variable
            ? `${spec.label} follows the variable "${variable.name}"`
            : `Make ${spec.label.toLowerCase()} a variable, or use one`
        }
        aria-label={`${spec.label} variable options`}
      >
        {variable ? <LinkIcon size={14} stroke="#C8B6FF" /> : <VariableIcon size={14} stroke="#8A93A5" />}
      </button>

      {open &&
        at &&
        createPortal(
          <div
            ref={panel}
            className="pmenu"
            role="menu"
            style={{ top: at.top, left: at.left, width: MENU_WIDTH }}
          >
            {variable ? (
              <div className="pmenu-bound">
                <LinkIcon size={13} stroke="#C8B6FF" />
                <span>
                  follows <b>{variable.name}</b>
                </span>
              </div>
            ) : (
              <div className="pmenu-new">
                <div className="pmenu-label">TURN INTO A VARIABLE</div>
                <div className="pmenu-new-row">
                  <input
                    autoFocus
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') promote()
                    }}
                    placeholder="name it"
                    aria-label="New variable name"
                    maxLength={24}
                  />
                  <button className="pmenu-make" onClick={promote}>
                    Make
                  </button>
                </div>
              </div>
            )}

            {candidates.length > 0 && (
              <>
                <div className="pmenu-label">USE A VARIABLE</div>
                <div className="pmenu-list">
                  {candidates.map((v) => (
                    <button
                      key={v.id}
                      role="menuitem"
                      className={`pmenu-item${v.id === variable?.id ? ' on' : ''}`}
                      onClick={() => {
                        if (v.id !== variable?.id) onBind(v.id)
                        setOpen(false)
                      }}
                    >
                      <span className="pmenu-name">{v.name}</span>
                      <span className="pmenu-value">{show(v.value)}</span>
                    </button>
                  ))}
                </div>
              </>
            )}

            {variable && (
              <button
                role="menuitem"
                className="pmenu-act"
                onClick={() => {
                  onUnbind()
                  setOpen(false)
                }}
              >
                Unlink — keep {show(variable.value)}
              </button>
            )}

            {!variable && candidates.length === 0 && (
              <div className="pmenu-empty">
                No other {spec.kind === 'choice' ? 'matching ' : ''}variables yet.
              </div>
            )}
          </div>,
          document.body
        )}
    </>
  )
}
