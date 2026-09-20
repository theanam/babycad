/**
 * Coil generators: a round-wire spring, and a torus knot for the fun of it.
 *
 * Both are a tube swept along a curve, so the only real work is the curve.
 */
import * as THREE from 'three'

const TAU = Math.PI * 2
const SEGMENTS_PER_TURN = 28

class HelixCurve extends THREE.Curve {
  constructor(radius, height, turns, hand) {
    super()
    this.radius = radius
    this.height = height
    this.turns = turns
    this.hand = hand
  }
  getPoint(t, target = new THREE.Vector3()) {
    const a = TAU * this.turns * t * (this.hand === 'left' ? -1 : 1)
    return target.set(
      this.radius * Math.cos(a),
      -this.height / 2 + this.height * t,
      this.radius * Math.sin(a)
    )
  }
}

export function buildSpring({ radius, wire, turns, height, sides, hand }) {
  const curve = new HelixCurve(radius, height, turns, hand)
  const steps = Math.max(8, Math.min(2000, Math.round(turns * SEGMENTS_PER_TURN)))
  return new THREE.TubeGeometry(curve, steps, wire / 2, Math.max(3, Math.round(sides)), false)
}

export function buildKnot({ radius, tube, p, q, sides }) {
  const tubular = Math.max(32, Math.round(24 * Math.max(p, q) * 2))
  return new THREE.TorusKnotGeometry(radius, tube, tubular, Math.max(3, Math.round(sides)), p, q)
}
