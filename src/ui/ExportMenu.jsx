import { useEffect } from 'react'
import { useDevice } from '../state/device'
import { useScene } from '../scene/sceneStore'
import { useDocs } from '../state/documents'
import { exportGLB, exportSTL } from '../io/exporters'
import { CloseIcon, ExportIcon } from './icons'
import { toast } from './Toast'

const OPTIONS = [
  {
    id: 'glb',
    title: 'Model file (.glb)',
    body: 'Keeps your colors. Opens in most 3D viewers and game tools.',
  },
  {
    id: 'stl',
    title: 'Printing file (.stl)',
    body: 'Shape only, no color. This is the one for a 3D printer.',
  },
]

export default function ExportMenu({ onClose }) {
  const objects = useScene((s) => s.objects)
  const groups = useScene((s) => s.groups)
  const name = useDocs((s) => s.active()?.name)
  // On a touch device the file goes to the share sheet, which is the only
  // place a phone has to put one. See io/share.
  const { touch } = useDevice()

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const run = async (id) => {
    try {
      const file = name || 'babycad-build'
      const result =
        id === 'glb'
          ? await exportGLB(objects, groups, file, { share: touch })
          : await exportSTL(objects, groups, file, { share: touch })
      // Dismissed the save dialog: nothing to say, and the menu stays up.
      if (!result) return

      const verb = { saved: 'Saved', shared: 'Sent', downloaded: 'Downloaded' }[result.how]
      // A part with a hole in it is rebuilt as a proper solid on the way out.
      // If that could not be done the file is still worth having, but a
      // printer may refuse it, and it is better to say so than to let it be
      // discovered at the printer.
      if (result.rough)
        toast(
          `${verb} your ${id.toUpperCase()} — but ${result.rough} cut ${result.rough === 1 ? 'piece' : 'pieces'} may not print cleanly`,
          'warn'
        )
      else toast(`${verb} your ${id.toUpperCase()}`)
      onClose()
    } catch {
      toast("That export didn't work — try again", 'warn')
    }
  }

  return (
    <div className="scrim" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal sm" role="dialog" aria-label="Export">
        <div className="modal-head" style={{ marginBottom: 18 }}>
          <div className="modal-title">Take it with you</div>
          <button className="modal-close" onClick={onClose} title="Close" aria-label="Close">
            <CloseIcon stroke="#8A93A5" />
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {OPTIONS.map((o) => (
            <button
              key={o.id}
              className="export-option"
              onClick={() => run(o.id)}
              disabled={!objects.length}
              title={objects.length ? o.body : 'Add a block first'}
            >
              <ExportIcon size={22} stroke="#C8B6FF" />
              <span>
                <b>{o.title}</b>
                <em>{o.body}</em>
              </span>
            </button>
          ))}
        </div>

        {!objects.length && (
          <p className="modal-copy" style={{ marginTop: 16, fontSize: 15 }}>
            Add a block first — there's nothing to export yet.
          </p>
        )}
      </div>
    </div>
  )
}
