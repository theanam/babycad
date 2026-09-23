/**
 * Taking the edge off a corner.
 *
 * Every round shape here — the tube, the cone, the pipe — is a flat profile
 * turned about the up axis, so softening its edges is a two-dimensional job:
 * find the corner of the profile, come back along both walls, and join the two
 * points up. A bevel joins them with a straight line, a round with a curve.
 *
 * The curve is a quadratic Bézier with the corner itself as the control point.
 * For a right angle with equal legs that is within a percent of a true quarter
 * circle, and unlike an arc it needs no centre, no radius and no trigonometry
 * — which means it cannot fail on a corner that is nearly flat or nearly
 * folded back on itself. Those turn up as soon as a tube tapers.
 */

/**
 * Points replacing a square corner with a softened one.
 *
 * `corner` is where the two walls meet. `a` and `b` are unit directions
 * pointing away from it along each wall, given in the order the profile is
 * travelled. The result starts on the `a` wall and ends on the `b` wall.
 */
export function softCorner(corner, a, b, size, style, segments = 4) {
  const [cx, cy] = corner
  const p0 = [cx + a[0] * size, cy + a[1] * size]
  const p1 = [cx + b[0] * size, cy + b[1] * size]
  if (!(size > 0)) return [[cx, cy]]
  if (style === 'bevel') return [p0, p1]

  const out = []
  for (let i = 0; i <= segments; i++) {
    const t = i / segments
    const u = 1 - t
    out.push([
      u * u * p0[0] + 2 * u * t * cx + t * t * p1[0],
      u * u * p0[1] + 2 * u * t * cy + t * t * p1[1],
    ])
  }
  return out
}

/** Unit direction from one point to another, for the wall between them. */
export function dirTo(from, to) {
  const dx = to[0] - from[0]
  const dy = to[1] - from[1]
  const len = Math.hypot(dx, dy) || 1
  return [dx / len, dy / len]
}

/**
 * How much edge a shape can actually lose.
 *
 * The slider offers millimetres that suit a big block; a small one has to say
 * no. Anything at or below zero means leave the corner alone. The 0.49 keeps
 * two facing edges from eating the whole wall between them and meeting in the
 * middle, which is where a profile turns inside out.
 */
export function edgeFor(size, ...limits) {
  const room = Math.min(...limits) * 0.49
  const e = Math.min(size ?? 0, room)
  return e > 1e-4 ? e : 0
}
