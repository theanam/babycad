/**
 * Thread generator — a screw thread as a surface of revolution whose radius is
 * modulated by the axial phase.
 *
 * Sweeping a triangular profile along a helix and stitching the result is the
 * obvious way to do this and it is fiddly: the ends never close cleanly and a
 * multi-start thread needs the sweeps interleaved by hand. Instead this treats
 * the thread as a plain cylindrical grid where
 *
 *   r(θ, y) = profile( frac( (y − lead·θ/2π) / pitch ) )
 *
 * Following the helix keeps the phase constant, so the ridge comes out exactly
 * where it should; climbing one pitch at a fixed angle returns the same radius,
 * so the surface is seamless top to bottom. It is watertight by construction,
 * caps trivially, and multi-start is one term in the phase.
 *
 * The profile is the ISO metric one, driven by the thread angle:
 *
 *   H = (pitch/2) / tan(angle/2)    the sharp-V triangle height
 *   crest truncated by H/8, root by H/4, leaving a depth of 5H/8
 *
 * which at the standard 60° gives the familiar 0.5413·pitch.
 */
import * as THREE from 'three'

const TAU = Math.PI * 2
const SEGMENTS_PER_PITCH = 18
const CREST_FLAT = 1 / 16 // half the flat at the crest, as a fraction of pitch
const ROOT_FLAT = 3 / 8 // where the root flat starts, from the crest centre

export function buildThread({ diameter, pitch, length, angle, starts, hand, sides }) {
  const rMajor = diameter / 2
  const triangle = pitch / 2 / Math.tan(THREE.MathUtils.degToRad(angle) / 2)
  const depth = Math.min((5 / 8) * triangle, rMajor * 0.9)
  const rMinor = rMajor - depth
  const lead = pitch * starts
  const turn = hand === 'left' ? -1 : 1

  const flank = depth / (ROOT_FLAT - CREST_FLAT)

  // Radius, and its slope in phase. The slope is what gives the crests their
  // edge: a vertex sitting on a flat gets a plainly radial normal and one on a
  // flank gets the flank's, so the crease falls inside a single quad. Letting
  // `computeVertexNormals` average them instead rounds every thread over until
  // the rod reads as a stack of washers.
  const profile = (phase) => {
    const signed = phase - Math.floor(phase + 0.5) // signed distance from a crest
    const u = Math.abs(signed)
    if (u <= CREST_FLAT) return [rMajor, 0]
    if (u >= ROOT_FLAT) return [rMinor, 0]
    return [rMajor - flank * (u - CREST_FLAT), -flank * Math.sign(signed)]
  }

  const cols = Math.max(8, Math.round(sides))
  const rows = clampInt(Math.round((length / pitch) * SEGMENTS_PER_PITCH), 8, 1200)
  const y0 = -length / 2

  const position = []
  const normal = []
  const index = []
  const at = (col, row) => row * cols + col

  for (let row = 0; row <= rows; row++) {
    const y = y0 + (length * row) / rows
    for (let col = 0; col < cols; col++) {
      const theta = (TAU * col) / cols
      const cos = Math.cos(theta)
      const sin = Math.sin(theta)
      const [r, slope] = profile((y - (turn * lead * theta) / TAU) / pitch)
      position.push(r * cos, y, r * sin)

      // Surface P(θ, y) = (r cosθ, y, r sinθ) with r = profile((y − cθ)/pitch);
      // the outward normal is ∂P/∂y × ∂P/∂θ.
      const rY = slope / pitch
      const rT = (-slope * turn * lead) / TAU / pitch
      const tx = rT * cos - r * sin
      const tz = rT * sin + r * cos
      const yx = rY * cos
      const yz = rY * sin
      // (yx, 1, yz) × (tx, 0, tz)
      const nx = 1 * tz - yz * 0
      const ny = yz * tx - yx * tz
      const nz = yx * 0 - 1 * tx
      const len = Math.hypot(nx, ny, nz) || 1
      normal.push(nx / len, ny / len, nz / len)
    }
  }
  // The ring wraps on itself — column 0 is shared, so there is no shading seam.
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const next = (col + 1) % cols
      const a = at(col, row)
      const b = at(next, row)
      index.push(a, at(next, row + 1), b, a, at(col, row + 1), at(next, row + 1))
    }
  }

  // Flat ends, fanned from the axis. They get their own vertices so the caps
  // stay sharp against the thread rather than smoothing into it.
  for (const top of [false, true]) {
    const row = top ? rows : 0
    const y = top ? y0 + length : y0
    const ny = top ? 1 : -1
    const centre = position.length / 3
    position.push(0, y, 0)
    normal.push(0, ny, 0)
    const ring = position.length / 3
    for (let col = 0; col < cols; col++) {
      const src = at(col, row) * 3
      position.push(position[src], y, position[src + 2])
      normal.push(0, ny, 0)
    }
    for (let col = 0; col < cols; col++) {
      const a = ring + col
      const b = ring + ((col + 1) % cols)
      if (top) index.push(centre, b, a)
      else index.push(centre, a, b)
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3))
  geometry.setIndex(index)
  return geometry
}

const clampInt = (n, lo, hi) => Math.max(lo, Math.min(hi, n))
