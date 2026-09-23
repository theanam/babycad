import { useEffect } from 'react'

/**
 * A question with two answers, where one of them cannot be taken back.
 *
 * The two buttons are deliberately not alike. Going ahead is the destructive
 * one — this is only ever asked about something that is about to be lost — so
 * it wears the same red the Delete button in the properties rail does, and
 * staying put wears the ordinary control grey. They read as what they are at a
 * glance, which is the whole job of a dialog nobody wanted to see.
 */
export default function ConfirmDialog({
  title,
  body,
  confirmLabel = 'Yes',
  confirmHint,
  onConfirm,
  onCancel,
}) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onCancel()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div className="scrim" onPointerDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal sm" role="alertdialog" aria-label={title}>
        <div className="modal-title" style={{ marginBottom: 12 }}>
          {title}
        </div>
        <p className="modal-copy" style={{ margin: 0 }}>
          {body}
        </p>
        <div className="modal-btns">
          <button
            className="foot-btn"
            style={{ marginLeft: 0 }}
            onClick={onCancel}
            title="Go back without changing anything"
          >
            Keep building
          </button>
          <button className="confirm-btn" onClick={onConfirm} title={confirmHint ?? confirmLabel}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
