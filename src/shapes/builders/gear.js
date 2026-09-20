/**
 * Spur / helical gear generator.
 *
 * The teeth are real involutes, not triangles: a tooth flank is the curve
 * traced by a point on a string unwound from the base circle, which is what
 * makes two gears of the same module mesh at a constant speed ratio. Getting
 * that right costs about twenty lines, and it's the difference between a gear
 * that prints and meshes and a cog-shaped decoration.
 *
 * Standard proportions, all driven by the module `m` (tooth size) and the
 * tooth count `z`:
 *
 *   pitch radius      rp = m·z / 2      the circle two meshing gears roll on
 *   base radius       rb = rp·cos α     the involute is unwound from here
 *   tip radius        ra = rp + m       addendum, one module above pitch
 *   root radius       rf = rp − 1.25m   dedendum, with clearance for the mate
 *
 * A helix angle twists the extrusion; the twist is the angle the tooth sweeps
 * across the face width, β measured at the pitch cylinder.
 */
import * as THREE from 'three'
import { extrudeProfile, windContours, arcPoints } from '../extrude'

const TAU = Math.PI * 2
const FLANK_STEPS = 7 // samples along one involute flank
const ROOT_STEPS = 4 // samples along the arc between two teeth
const TIP_STEPS = 3 // samples across a tooth tip

const involute = (a) => Math.tan(a) - a

/** The 2D tooth outline, counter-clockwise, centred on the origin. */
export function gearContour({ teeth, module, pressureAngle }) {
  const z = Math.max(4, Math.round(teeth))
  const alpha = THREE.MathUtils.degToRad(pressureAngle)
  const rp = (module * z) / 2
  const rb = rp * Math.cos(alpha)
  const ra = rp + module
  const rf = Math.max(module * 0.15, rp - 1.25 * module)
  const invAlpha = involute(alpha)

  // Half the angular tooth thickness at radius r. Shrinks as r grows, which is
  // why a tooth narrows towards its tip — and why too many teeth on too small
  // a module makes the tip vanish to a point.
  const half = (r) => Math.PI / (2 * z) + invAlpha - involute(Math.acos(Math.min(1, rb / r)))

  // Below the base circle there is no involute; the flank runs straight down.
  const rStart = Math.max(rb, rf) + 1e-9
  const rTip = half(ra) > 1e-3 ? ra : pointedTip(half, rStart, ra)

  const contour = []
  const at = (r, angle) => contour.push({ x: r * Math.cos(angle), y: r * Math.sin(angle) })

  for (let i = 0; i < z; i++) {
    const centre = (TAU * i) / z

    if (rf < rStart) at(rf, centre - half(rStart))
    for (let k = 0; k <= FLANK_STEPS; k++) {
      const r = rStart + ((rTip - rStart) * k) / FLANK_STEPS
      at(r, centre - half(r))
    }
    const tipHalf = half(rTip)
    for (let k = 1; k < TIP_STEPS; k++) {
      at(rTip, centre - tipHalf + (2 * tipHalf * k) / TIP_STEPS)
    }
    for (let k = FLANK_STEPS; k >= 0; k--) {
      const r = rStart + ((rTip - rStart) * k) / FLANK_STEPS
      at(r, centre + half(r))
    }
    if (rf < rStart) at(rf, centre + half(rStart))

    // Root arc across to the next tooth.
    const from = centre + (rf < rStart ? half(rStart) : half(rf))
    const to = centre + TAU / z - (rf < rStart ? half(rStart) : half(rf))
    for (let k = 1; k < ROOT_STEPS; k++) at(rf, from + ((to - from) * k) / ROOT_STEPS)
  }
  return { contour, rp, ra, rf }
}

/** Where a tooth that has run out of flank comes to a point. */
function pointedTip(half, lo, hi) {
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2
    if (half(mid) > 1e-3) lo = mid
    else hi = mid
  }
  return lo
}

export function buildGear(p) {
  const { thickness, bore, helix } = p
  const { contour, rp } = gearContour(p)

  const holes = []
  const boreRadius = bore / 2
  if (boreRadius > 0.005) {
    const sides = Math.max(12, Math.min(64, Math.round(boreRadius * 160)))
    holes.push(arcPoints(Math.min(boreRadius, rp * 0.85), sides).reverse())
  }

  // β at the pitch cylinder: tan β = (rp · twist) / face width.
  const twist = helix ? (thickness * Math.tan(THREE.MathUtils.degToRad(helix))) / rp : 0

  const [c, h] = windContours(contour, holes)
  return extrudeProfile(c, h, { height: thickness, twist, crease: 24 })
}
