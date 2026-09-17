import * as THREE from 'three'

/**
 * One cached geometry per primitive type. With 100+ blocks in a scene the
 * sharing matters, and it keeps the viewport and the exporter building the
 * exact same shapes.
 *
 * Every primitive is authored to roughly one world unit so a fresh block is
 * always a sensible size.
 */
const builders = {
  cube: () => new THREE.BoxGeometry(1, 1, 1),
  sphere: () => new THREE.SphereGeometry(0.5, 32, 24),
  cone: () => new THREE.ConeGeometry(0.5, 1, 32),
  cylinder: () => new THREE.CylinderGeometry(0.5, 0.5, 1, 32),
  pyramid: () => {
    // A 4-sided cone is a square pyramid; turn it so a face points at camera.
    const g = new THREE.ConeGeometry(0.72, 1, 4)
    g.rotateY(Math.PI / 4)
    return g
  },
  torus: () => {
    // Lay the donut flat on the floor, the way the design draws it.
    const g = new THREE.TorusGeometry(0.34, 0.16, 18, 40)
    g.rotateX(-Math.PI / 2)
    return g
  },
}

const cache = new Map()

export function getGeometry(type) {
  if (!cache.has(type)) {
    const build = builders[type] ?? builders.cube
    const g = build()
    g.computeBoundingBox()
    g.computeBoundingSphere()
    cache.set(type, g)
  }
  return cache.get(type)
}

export const PRIMITIVE_TYPES = Object.keys(builders)

/** Half-height of the primitive, so a new block lands flat on the floor. */
export function restingHeight(type) {
  const box = getGeometry(type).boundingBox
  return (box.max.y - box.min.y) / 2
}
