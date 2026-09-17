import { useEffect } from 'react'

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
          <button className="save-btn" onClick={onConfirm} title={confirmHint ?? confirmLabel}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
