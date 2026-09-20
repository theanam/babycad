import { useMemo, useRef, useState } from 'react'
import { useScene } from '../scene/sceneStore'
import { viewport } from '../scene/viewportApi'
import {
  deleteProject,
  listProjects,
  loadProject,
  migrate,
  saveProject,
} from '../io/persistence'
import { CloseIcon, OpenIcon, PlusIcon, SaveIcon, TrashIcon } from './icons'
import { toast } from './Toast'

const when = (iso) => {
  if (!iso) return 'saved'
  const then = new Date(iso)
  const days = Math.floor((Date.now() - then.getTime()) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days} days ago`
  return then.toLocaleDateString()
}

/**
 * Save and load, in one sheet. Everything here is localStorage — the banner
 * says so, because there is no account to fall back on.
 */
export default function ProjectsModal({ onClose, onRequestNew }) {
  const objects = useScene((s) => s.objects)
  const serialize = useScene((s) => s.serialize)
  const loadScene = useScene((s) => s.loadScene)
  const projectName = useScene((s) => s.projectName)
  const setProjectName = useScene((s) => s.setProjectName)

  const [builds, setBuilds] = useState(() => listProjects())
  const [name, setName] = useState(projectName)
  const fileInput = useRef(null)

  const trimmed = name.trim()
  const canSave = trimmed.length > 0 && objects.length > 0

  const counts = useMemo(
    () => Object.fromEntries(builds.map((b) => [b.name, b.scene?.objects?.length ?? 0])),
    [builds]
  )

  const doSave = () => {
    if (!canSave) return
    const result = saveProject(trimmed, serialize(), viewport.capture())
    if (!result.ok) {
      toast("This browser is out of room — try deleting an old build", 'warn')
      return
    }
    setProjectName(trimmed)
    setBuilds(listProjects())
    toast(result.droppedThumbnail ? `Saved "${trimmed}" (no preview)` : `Saved "${trimmed}"`)
  }

  const doLoad = (buildName) => {
    const scene = loadProject(buildName)
    if (!scene) return toast(`Couldn't open "${buildName}"`, 'warn')
    loadScene(scene)
    setProjectName(buildName)
    toast(`Opened "${buildName}"`)
    onClose()
  }

  const doDelete = (buildName) => {
    deleteProject(buildName)
    setBuilds(listProjects())
    toast(`Deleted "${buildName}"`)
  }

  const openFile = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      const scene = migrate(JSON.parse(await file.text()))
      if (!scene?.objects?.length) throw new Error('empty')
      loadScene(scene)
      setProjectName(file.name.replace(/\.(babycad\.|blockyard\.)?json$/i, ''))
      toast(`Opened ${file.name}`)
      onClose()
    } catch {
      toast("That file isn't a BabyCAD build", 'warn')
    }
  }

  return (
    <div className="scrim" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label="Your builds">
        <div className="modal-head">
          <div className="modal-title">Your builds</div>
          <div className="modal-tag">SAVED IN THIS BROWSER ONLY</div>
          <button className="modal-close" onClick={onClose} title="Close" aria-label="Close">
            <CloseIcon stroke="#8A93A5" />
          </button>
        </div>

        <div className="save-row">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && doSave()}
            placeholder="name this build"
            aria-label="Build name"
            maxLength={40}
          />
          <button
            className="save-btn"
            onClick={doSave}
            disabled={!canSave}
            title={canSave ? `Save this build as "${trimmed}"` : 'Name your build first — and add a block'}
          >
            <SaveIcon stroke="#fff" width={2.4} />
            Save
          </button>
        </div>

        <div className="builds">
          {builds.map((b) => (
            <div className="build-wrap" key={b.name}>
              <button
                className={`build${b.name === projectName ? ' on' : ''}`}
                onClick={() => doLoad(b.name)}
                title={`Open "${b.name}"`}
                style={{ width: '100%' }}
              >
                {b.thumbnail ? (
                  <img className="build-shot" src={b.thumbnail} alt="" />
                ) : (
                  <div className="build-shot" />
                )}
                <div className="build-meta">
                  <div className="build-name">{b.name}</div>
                  <div className="build-sub">
                    {counts[b.name]} blocks · {when(b.scene?.updatedAt)}
                  </div>
                </div>
              </button>
              <button
                className="build-del"
                onClick={() => doDelete(b.name)}
                title={`Delete "${b.name}"`}
                aria-label={`Delete ${b.name}`}
              >
                <TrashIcon size={18} stroke="#FF7A6B" />
              </button>
            </div>
          ))}

          <button
            className="build new"
            title="Start a fresh build"
            onClick={() => {
              onClose()
              onRequestNew()
            }}
          >
            <i>
              <PlusIcon size={26} stroke="#8A93A5" width={2.4} />
            </i>
            New build
          </button>

          {!builds.length && (
            <div className="empty-builds">No builds saved yet — name one above and hit Save.</div>
          )}
        </div>

        <div className="modal-foot">
          <div className="note">
            Builds live on this device. Use <strong>Export</strong> to take one with you as a .glb
            file, or save it as a BabyCAD file you can open again here.
          </div>
          <button
            className="foot-btn"
            onClick={() => fileInput.current?.click()}
            title="Open a BabyCAD .json file from your device"
          >
            <OpenIcon stroke="#8A93A5" />
            Open a file
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            onChange={openFile}
            hidden
          />
        </div>
      </div>
    </div>
  )
}
