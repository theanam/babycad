import { useEffect } from 'react'
import { useScene } from '../scene/sceneStore'
import { exportGLB, exportJSON, exportSTL } from '../io/exporters'
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
  {
    id: 'json',
    title: 'BabyCAD file (.babycad)',
    body: 'Save it anywhere, then open it again here — even on another device.',
  },
]

export default function ExportMenu({ onClose }) {
  const objects = useScene((s) => s.objects)
  const groups = useScene((s) => s.groups)
  const serialize = useScene((s) => s.serialize)
  const projectName = useScene((s) => s.projectName)

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const run = async (id) => {
    const name = projectName || 'babycad-build'
    try {
      if (id === 'glb') await exportGLB(objects, groups, name)
      else if (id === 'stl') exportSTL(objects, groups, name)
      else exportJSON(serialize(), name)
      toast(`Downloaded your ${id.toUpperCase()}`)
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
