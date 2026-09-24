import Sheet from './Sheet'
import { isDirty, useDocs } from '../../state/documents'
import { BuildIcon, CloseIcon, OpenIcon, PlusIcon } from '../icons'

/**
 * The tab strip, as a list.
 *
 * A row of tabs works on a desktop because a pointer can hit a 20px close
 * button inside a 96px tab. Here each build is a full row with its own close
 * target, and the two ways to get another one — a blank plate, a file — sit
 * under them, which is also where the welcome screen puts them.
 *
 * Renaming is the one thing that does not come across. Double-clicking a tab
 * name is not a gesture a finger has; the name is changed by tapping the row's
 * name once it is the open build, which opens the field in place.
 */
export default function DocsSheet({ onClose, onNew, onOpen, onCloseDoc }) {
  const docs = useDocs((s) => s.docs)
  const activeId = useDocs((s) => s.activeId)
  const activate = useDocs((s) => s.activate)
  const rename = useDocs((s) => s.rename)

  return (
    <Sheet scrim title="Builds" onClose={onClose}>
      <div className="sheet-list">
        {docs.map((doc) => {
          const on = doc.id === activeId
          return (
            <div key={doc.id} className={`doc-row${on ? ' on' : ''}`}>
              <button
                className="doc-pick"
                onClick={() => {
                  if (!on) activate(doc.id)
                }}
                aria-current={on}
              >
                <BuildIcon size={20} stroke={on ? '#C9B6FF' : '#8A93A5'} />
                {on ? (
                  // The open build's name is editable where it stands, which is
                  // the only rename gesture a finger has.
                  <input
                    className="doc-name-field"
                    defaultValue={doc.name}
                    maxLength={40}
                    onPointerDown={(e) => e.stopPropagation()}
                    onBlur={(e) => rename(doc.id, e.target.value)}
                    onKeyDown={(e) => {
                      e.stopPropagation()
                      if (e.key === 'Enter') e.currentTarget.blur()
                    }}
                    aria-label="Name of this build"
                  />
                ) : (
                  <span className="doc-name">{doc.name}</span>
                )}
                {isDirty(doc) && <i className="tab-dot" aria-label="not saved yet" />}
              </button>
              <button
                className="doc-close"
                onClick={() => onCloseDoc(doc.id)}
                aria-label={`Close ${doc.name}`}
              >
                <CloseIcon size={16} stroke="#8A93A5" />
              </button>
            </div>
          )
        })}
      </div>

      <div className="sheet-list" style={{ marginTop: 14 }}>
        <button className="sheet-row" onClick={() => { onClose(); onNew() }}>
          <PlusIcon size={20} stroke="#C8B6FF" />
          <span className="sheet-row-name">New build</span>
        </button>
        <button className="sheet-row" onClick={() => { onClose(); onOpen() }}>
          <OpenIcon size={20} stroke="#8A93A5" />
          <span className="sheet-row-name">Open a file</span>
        </button>
      </div>
    </Sheet>
  )
}
