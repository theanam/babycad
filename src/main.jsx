import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import AppCrash from './ui/AppCrash'
import ErrorBoundary from './ui/ErrorBoundary'
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

/**
 * Say when the main thread has been away for a long time, and for how long.
 *
 * A tab that stops answering for a minute and then comes back looks, from the
 * outside, like a crash that changed its mind, and the report that reaches
 * this project is "it froze". A long task carries no stack, so this cannot say
 * *what* ran — the slow-cut warning in `shapes/csg` does that for the one
 * thing known to — but it can say that something did, when, and for how long,
 * which is the difference between a bug report and a mystery. Only for stalls
 * past two seconds: a frame dropped here and there is not news.
 */
try {
  if (typeof PerformanceObserver !== 'undefined') {
    const watchdog = new PerformanceObserver((list) => {
      for (const task of list.getEntries()) {
        if (task.duration < 2000) continue
        console.warn(`[babycad] the main thread was busy for ${(task.duration / 1000).toFixed(1)}s`)
      }
    })
    watchdog.observe({ entryTypes: ['longtask'] })
  }
} catch {
  // A browser without long-task timing has nothing to report, which is fine.
}

const root = createRoot(document.getElementById('root'))

root.render(
  <React.StrictMode>
    {hasWebGL() ? (
      <ErrorBoundary what="the app" fallback={(error, retry) => <AppCrash onRetry={retry} />}>
        <App />
      </ErrorBoundary>
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
