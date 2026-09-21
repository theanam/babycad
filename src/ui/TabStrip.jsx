import { useEffect, useRef, useState } from 'react'
import { isDirty, useDocs } from '../state/documents'
import { CloseIcon, PlusIcon } from './icons'

/**
 * One tab per open build.
 *
 * A tab shows the file's name, a dot while there are changes not yet written
 * to it, and a close button. Double-click the name to rename — which renames
 * the *tab*, not the file; the file takes the name at the next Save, the way
 * a new document does. Middle-click closes, as it does in a browser.
 */
export default function TabStrip({ onNew, onCloseRequest }) {
  const docs = useDocs((s) => s.docs)
  const activeId = useDocs((s) => s.activeId)
  const activate = useDocs((s) => s.activate)
  const rename = useDocs((s) => s.rename)

  const [editing, setEditing] = useState(null)
  const input = useRef(null)

  useEffect(() => {
    if (editing) input.current?.select()
  }, [editing])

  const commit = (id) => {
    const value = input.current?.value
    setEditing(null)
    if (value != null) rename(id, value)
  }

  return (
    <div className="tabs" role="tablist" aria-label="Open builds">
      {docs.map((doc) => {
        const on = doc.id === activeId
        const dirty = isDirty(doc)
        return (
          <div
            key={doc.id}
            role="tab"
            aria-selected={on}
            tabIndex={on ? 0 : -1}
            className={`tab${on ? ' on' : ''}`}
            onPointerDown={(e) => {
              if (e.button === 1) {
                e.preventDefault()
                onCloseRequest(doc.id)
              } else if (e.button === 0 && editing !== doc.id) {
                activate(doc.id)
              }
            }}
            onDoubleClick={() => on && setEditing(doc.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') activate(doc.id)
            }}
            title={dirty ? `${doc.name} — not saved yet` : doc.name}
          >
            {editing === doc.id ? (
              <input
                ref={input}
                className="tab-rename"
                defaultValue={doc.name}
                maxLength={40}
                onBlur={() => commit(doc.id)}
                onKeyDown={(e) => {
                  e.stopPropagation()
                  if (e.key === 'Enter') commit(doc.id)
                  if (e.key === 'Escape') setEditing(null)
                }}
              />
            ) : (
              <>
                <span className="tab-name">{doc.name}</span>
                {dirty && <i className="tab-dot" aria-label="not saved yet" />}
              </>
            )}
            <button
              className="tab-close"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => onCloseRequest(doc.id)}
              aria-label={`Close ${doc.name}`}
              title={`Close ${doc.name}`}
            >
              <CloseIcon size={13} stroke="#8A93A5" width={2.8} />
            </button>
          </div>
        )
      })}

      <button className="tab-new" onClick={onNew} title="New build (a new tab)" aria-label="New build">
        <PlusIcon size={17} stroke="#8A93A5" />
      </button>
    </div>
  )
}
