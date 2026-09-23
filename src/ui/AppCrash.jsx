/**
 * The screen of last resort.
 *
 * Shown only when a crash got past every smaller boundary. The one thing that
 * actually matters here is that nobody loses what they were building, so this
 * offers to write it to a file before anything else. The blocks are still in
 * the store — React has stopped drawing them, which is not the same as them
 * being gone — so they can usually be handed over intact.
 *
 * "Try again" simply draws the app once more. That is worth offering because
 * most of what can throw is about one block: delete it, or undo, and the app
 * is fine. Reloading is the bigger hammer, and the open tabs come back after
 * one because they are cached as you work — see `io/persistence`.
 */
import { useState } from 'react'
import { useScene } from '../scene/sceneStore'
import { useDocs } from '../state/documents'

function rescue() {
  // Everything in here is reaching into state that has just misbehaved, so
  // none of it is trusted. Failing to save is disappointing; throwing inside
  // the screen that exists to catch a throw would be a farce.
  const name = (() => {
    try {
      return useDocs.getState().active()?.name || 'rescued-build'
    } catch {
      return 'rescued-build'
    }
  })()
  const text = JSON.stringify(useScene.getState().serialize(), null, 2)
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `${String(name).replace(/[^a-z0-9_-]+/gi, '-') || 'rescued-build'}.babycad`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export default function AppCrash({ onRetry }) {
  const [saved, setSaved] = useState(null)

  const onSave = () => {
    try {
      rescue()
      setSaved('done')
    } catch {
      setSaved('failed')
    }
  }

  return (
    <div className="fallback">
      <h1>BabyCAD tripped over something</h1>
      <p>
        Your blocks aren&apos;t lost. Save them to a file first, then try again — and if it keeps
        happening, reloading the page brings your tabs back.
      </p>
      <div className="crash-actions">
        <button className="crash-btn primary" onClick={onSave}>
          {saved === 'done' ? 'Saved — save again' : 'Save my build to a file'}
        </button>
        <button className="crash-btn" onClick={onRetry}>
          Try again
        </button>
        <button className="crash-btn" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
      {saved === 'failed' && (
        <p className="crash-note">
          That build couldn&apos;t be written out. Reloading should still bring back the tabs you
          had open.
        </p>
      )}
    </div>
  )
}
