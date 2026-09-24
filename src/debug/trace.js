/**
 * A trace you can switch on from the console, for the freeze nobody can
 * reproduce but you.
 *
 * Off, this costs one boolean check per call. On, every step along the paths
 * that could plausibly stall the tab writes a line with how long it took, so
 * the console reads as a timeline: what ran, in what order, and which one was
 * the fifty-second one. It is deliberately chatty when on — it exists for the
 * moment when somebody with the failing file has the console open and is
 * about to press the button, and for nothing else.
 *
 * On:   localStorage.setItem('babycad:trace', '1')   then reload
 * Off:  localStorage.removeItem('babycad:trace')     then reload
 * Or open the app with ?trace on the URL.
 */
let enabled = false
try {
  enabled =
    (typeof localStorage !== 'undefined' && localStorage.getItem('babycad:trace') === '1') ||
    (typeof location !== 'undefined' && /[?&]trace\b/.test(location.search))
} catch {
  enabled = false
}

export const tracing = () => enabled

const stamp = () => (performance.now() / 1000).toFixed(3).padStart(8)
const span = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms.toFixed(1)}ms`)

/** A point in time: "at 12.345s: label". */
export function mark(label, extra) {
  if (!enabled) return
  if (extra === undefined) console.log(`[trace ${stamp()}s] ${label}`)
  else console.log(`[trace ${stamp()}s] ${label}`, extra)
}

/**
 * Time a synchronous function. The closing line is written *after* it
 * returns, with the duration — so a step that never returns is the one with
 * an opening line and no closing one, which is its own kind of answer.
 */
export function trace(label, fn) {
  if (!enabled) return fn()
  const t0 = performance.now()
  console.log(`[trace ${stamp()}s] ▶ ${label}`)
  try {
    return fn()
  } finally {
    console.log(`[trace ${stamp()}s] ◀ ${label}  ${span(performance.now() - t0)}`)
  }
}
