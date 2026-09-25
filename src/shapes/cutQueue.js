/**
 * The main-thread side of the cut worker: one worker, one job at a time, and
 * the rules for which jobs are worth running.
 *
 * **One at a time**, because the point of the worker is to keep the main
 * thread free, not to cut faster; and because a hole being lined up asks for a
 * new cut on every nudge, so most requests are stale before they start. A job
 * that has not started yet is dropped the moment a newer one arrives for the
 * same block. The one already running is left to finish — there is no way to
 * stop a subtraction halfway short of killing the worker, and a cut that keeps
 * getting killed never lands.
 *
 * **Geometry crosses once.** Every geometry has a key (see `keyOfParams`), the
 * worker keeps what it has been sent, and a job names its shapes by key. What
 * the worker does not have it asks for — `missing` — and the job is sent
 * again with those included. That is the whole of the protocol's memory: this
 * side never has to know what the worker remembers, which is what makes
 * restarting it safe.
 *
 * **A job that outlasts the timeout kills the worker**, and the next job gets
 * a fresh one. Two minutes is long enough that nothing anybody will actually
 * see is cut off, and short enough that a model with no hope of being cut
 * stops burning a core.
 */

const TIMEOUT_MS = 120_000

let worker = null
let seq = 0
/** The job the worker is on, if any. */
let running = null
/** Jobs waiting, oldest first. */
const queued = []
/** Geometry keys the worker is believed to hold. */
const sent = new Set()

function spawn() {
  if (worker) return worker
  worker = new Worker(new URL('./cutWorker.js', import.meta.url), { type: 'module' })
  worker.onmessage = ({ data }) => onMessage(data)
  worker.onerror = (event) => {
    // The worker itself fell over — most likely out of memory on a huge
    // model. The running job is lost; the next one gets a fresh worker.
    event.preventDefault?.()
    fail(running, new Error(`the cut worker stopped: ${event.message ?? 'unknown error'}`))
    restart()
  }
  return worker
}

function restart() {
  worker?.terminate()
  worker = null
  sent.clear()
  pump()
}

function fail(job, error) {
  if (!job) return
  clearTimeout(job.timer)
  if (running === job) running = null
  job.reject(error)
}

/** Post the running job, with whatever geometry the worker still needs. */
function post(job, needed) {
  const geometries = {}
  const transfer = []
  for (const key of needed) {
    if (sent.has(key)) continue
    const arrays = job.arraysFor(key)
    geometries[key] = arrays
    // Copies of ours, so they can be handed over rather than cloned.
    transfer.push(arrays.positions.buffer)
    if (arrays.normals) transfer.push(arrays.normals.buffer)
    sent.add(key)
  }
  spawn().postMessage(
    { type: 'cut', id: job.id, solidKey: job.solidKey, holes: job.holes, geometries },
    transfer
  )
}

function pump() {
  if (running || !queued.length) return
  const job = queued.shift()
  running = job
  job.timer = setTimeout(() => {
    fail(job, Object.assign(new Error('the cut took too long'), { timeout: true }))
    restart()
  }, TIMEOUT_MS)
  post(job, [job.solidKey, ...job.holes.map((h) => h.key)])
}

function onMessage(data) {
  const job = running
  if (!job || data.id !== job.id) return // a straggler from a worker we replaced
  if (data.type === 'missing') {
    for (const key of data.keys) sent.delete(key)
    post(job, data.keys)
    return
  }
  clearTimeout(job.timer)
  running = null
  if (data.type === 'done') job.resolve({ positions: data.positions, normals: data.normals })
  else job.reject(new Error(data.message ?? 'the cut failed'))
  pump()
}

/**
 * Ask for a cut. Resolves with `{ positions, normals }`, or rejects — with
 * `error.timeout` set when it was the clock rather than the geometry.
 *
 * @param key        what the result will be cached under; a repeat while the
 *                   same key is queued or running shares that job
 * @param objectId   the block being cut, so a newer request for it can drop
 *                   an older one that has not started
 * @param solidKey   geometry key of the solid
 * @param holes      `[{ key, matrix }]` — geometry key and relative matrix
 * @param arraysFor  `(key) => { positions, normals }`, fresh copies, called
 *                   only for geometry the worker does not have
 */
export function submitCut({ key, objectId, solidKey, holes, arraysFor }) {
  const same = running?.key === key ? running : queued.find((j) => j.key === key)
  if (same) return same.promise

  // Anything still waiting for this block is about to be wrong.
  for (let i = queued.length - 1; i >= 0; i--) {
    if (queued[i].objectId === objectId) {
      queued[i].reject(Object.assign(new Error('superseded'), { superseded: true }))
      queued.splice(i, 1)
    }
  }

  const job = { id: ++seq, key, objectId, solidKey, holes, arraysFor }
  job.promise = new Promise((resolve, reject) => {
    job.resolve = resolve
    job.reject = reject
  })
  queued.push(job)
  pump()
  return job.promise
}

/** Whether anything is queued or running — for tests and for tidying up. */
export const cutQueueBusy = () => Boolean(running) || queued.length > 0
