/**
 * Overlapping outlines, folded into one.
 *
 * Two rectangles crossing each other are one bracket, not two plates standing
 * in the same place — and extruded separately that is exactly what they look
 * like: you can see the seam where one shell passes through the other, and
 * with an edge taken off you get a bevel running through the middle of what
 * is supposed to be a continuous part. So the outlines are unioned **in two
 * dimensions, before anything is extruded**, and the extruder is handed one
 * boundary.
 *
 * Doing it afterwards in three dimensions would give a correct solid and the
 * wrong edges: each piece would be bevelled along its own outline first, and
 * the union would leave those bevels meeting in a notch where the join is.
 * It would also be slow — a CSG union on every nudge of a slider is the cost
 * the whole `cutWorker` exists to keep off the main thread.
 *
 * **Nesting and overlap are different questions and one fill rule cannot
 * answer both.** A ring inside another is a hole; two rings crossing are one
 * shape. Even-odd gets the first right and turns the overlap into a hole;
 * non-zero gets the second right and loses the hole. So the depths are worked
 * out by containment first (`flatten` does that), and this walks them from
 * the inside out:
 *
 *     region(d) = union(rings at depth d) − region(d + 1)
 *
 * which makes a hole out of the odd depths and material out of the even ones,
 * and unions whatever shares a depth on the way. It also picks up something
 * containment alone never saw: two L-shapes crossing can enclose a void that
 * neither of them contains, and the union finds it.
 *
 * Manifold's `CrossSection` does the boolean. It is already a dependency —
 * the exporter rebuilds solids with the other half of the same module — and
 * it is WebAssembly, so it has to be started before it can be used. Until it
 * is, `unionIslands` says so and `flatten` falls back to plain containment
 * nesting, which is what this did before and is right for every drawing whose
 * outlines do not overlap.
 */
import { create } from 'zustand'
import { manifoldNow, manifoldWasm } from '../manifoldWasm'

/**
 * Bumped when the module lands, so anything that built a drawing without it
 * builds again with it. Folded into the geometry cache key by `SceneObject`,
 * the same way a typeface arriving late is — see `shapes/fontStore`.
 */
export const useUnion = create(() => ({ generation: 0, ready: false }))

let starting = null

/** Start Manifold, if it is not started. Safe to call as often as you like. */
export function warmUnion() {
  if (starting || manifoldNow()) return starting ?? Promise.resolve()
  starting = manifoldWasm()
    .then(() => useUnion.setState((s) => ({ generation: s.generation + 1, ready: true })))
    .catch(() => {
      // A drawing still builds without it, one outline per piece. Let the next
      // ask try again rather than giving up for the session.
      starting = null
    })
  return starting
}

export const unionReady = () => Boolean(manifoldNow()?.CrossSection)

/**
 * Fold a sieved set of rings into islands, or `null` if Manifold is not up
 * yet and the caller should fall back.
 *
 * In: `[{ pts: [{x, y}], depth }]`, depth by containment.
 * Out: `[[{x, y}]]` — polygons, outer boundaries wound counter-clockwise and
 * holes clockwise, which is what `CrossSection` hands back and happens to be
 * what the extruder wants. Nesting them into islands is the caller's job,
 * and it is exact afterwards because nothing overlaps any more.
 */
/**
 * A ring as Manifold wants it: counter-clockwise, which is what its default
 * fill rule counts as material.
 *
 * Rings arrive here in the extruder's plane, where the drawing's y has been
 * turned upside down, so a shape drawn the usual way round comes in wound the
 * other way — and a clockwise polygon under that rule is not a hole, it is
 * nothing at all, which is how the first version of this came back with an
 * empty drawing. Which way round a ring happens to be is not information
 * anybody put there; the nesting depth is what says material from hole, and
 * it was worked out before this.
 */
function counterClockwise(pts) {
  let twice = 0
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    twice += pts[j].x * pts[i].y - pts[i].x * pts[j].y
  }
  const out = pts.map((p) => [p.x, p.y])
  return twice < 0 ? out.reverse() : out
}

export function unionIslands(rings) {
  const wasm = manifoldNow()
  if (!wasm?.CrossSection || !rings.length) return null
  const { CrossSection } = wasm

  const byDepth = new Map()
  for (const ring of rings) {
    const at = byDepth.get(ring.depth) ?? []
    at.push(counterClockwise(ring.pts))
    byDepth.set(ring.depth, at)
  }
  const depths = [...byDepth.keys()].sort((a, b) => b - a)

  let region = null
  const spent = []
  try {
    for (const depth of depths) {
      const level = CrossSection.union(byDepth.get(depth).map((poly) => [poly]))
      spent.push(level)
      const next = region ? level.subtract(region) : level
      if (next !== level) spent.push(next)
      region = next
    }
    return region.toPolygons().map((poly) => poly.map(([x, y]) => ({ x, y })))
  } catch {
    // A drawing Manifold will not take is a drawing the old path can still
    // make something of, and a shape on screen beats an exception.
    return null
  } finally {
    // Manifold objects hold memory on the WASM heap, which nothing here
    // collects for us.
    for (const one of spent) one?.delete?.()
  }
}
