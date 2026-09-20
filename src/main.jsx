import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles/global.css'

/** WebGL2 is the one hard requirement; say so plainly if it's missing. */
function hasWebGL() {
  try {
    const canvas = document.createElement('canvas')
    return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'))
  } catch {
    return false
  }
}

const root = createRoot(document.getElementById('root'))

root.render(
  <React.StrictMode>
    {hasWebGL() ? (
      <App />
    ) : (
      <div className="fallback">
        <h1>BabyCAD needs 3D graphics</h1>
        <p>
          This browser can&apos;t draw 3D scenes. Try the latest Chrome, Safari, Edge or Firefox —
          and if you&apos;re on a school device, 3D may be switched off in its settings.
        </p>
      </div>
    )}
  </React.StrictMode>
)
