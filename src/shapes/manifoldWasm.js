/**
 * Starting Manifold, once, for everything that needs it.
 *
 * Two quite different callers: `io/solidCut` rebuilds an exported solid with
 * it, and `shapes/sketch/union` uses its 2D half to fold overlapping outlines
 * into one before they are extruded. They want the same module and the same
 * WASM file, and starting it twice would fetch and compile it twice.
 *
 * `ready` is the loaded module or null, and is what lets a *synchronous*
 * caller ask whether it can use it this frame. A geometry builder runs inside
 * a render and cannot wait for a download; it takes the honest answer for now
 * and is rebuilt when the module lands — the same bargain `shapes/fontStore`
 * strikes with a typeface that has not arrived.
 */
let loading = null
let ready = null

/**
 * Where the WASM file is.
 *
 * Left to itself the module looks for `manifold.wasm` beside its own script,
 * which is right under node and wrong in the browser: the bundler moves the
 * script and gives the wasm a fingerprinted name, so the lookup lands on a URL
 * that is not there. A dev server answers a miss with the app's own index.html,
 * so what came back was a page of HTML being fed to the WebAssembly compiler —
 * it failed, the export quietly fell back to the viewport's cut, and the file
 * was as broken as before while still saying it had downloaded. Asking the
 * bundler where it actually put the file is the whole fix.
 */
async function wasmPath() {
  // `import.meta.env` is the bundler's; under node there is none, and the
  // module's own guess is correct there.
  if (typeof import.meta.env === 'undefined') return null
  const asset = await import('manifold-3d/manifold.wasm?url')
  return asset.default
}

/** The WASM module, started on first use and then kept. */
function manifold() {
  if (!loading) {
    loading = Promise.all([import('manifold-3d'), wasmPath()])
      .then(([m, url]) => (m.default ?? m)(url ? { locateFile: () => url } : {}))
      .then((wasm) => {
        wasm.setup()
        ready = wasm
        return wasm
      })
      .catch((error) => {
        // Let the next export try again rather than failing for the session.
        loading = null
        throw error
      })
  }
  return loading
}

/** The module if it has already started and finished, or null. */
export const manifoldNow = () => ready

/** Start it, and hand back the promise. */
export const manifoldWasm = () => manifold()
