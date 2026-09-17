import * as THREE from 'three'

const _box = new THREE.Box3()
const _v = new THREE.Vector3()

/**
 * A mesh's own bounding box in world space.
 *
 * Deliberately not Box3.setFromObject — that would swallow the selection
 * outline child and report a box a few pixels too big.
 */
export function boxOfMesh(mesh, target = new THREE.Box3()) {
  mesh.updateMatrixWorld()
  target.copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld)
  return target
}

/**
 * The frame the bounding box is drawn in.
 *
 * One block: the box turns with the block, so resizing works along the block's
 * own axes. Several blocks: a world-aligned box around the lot, because a
 * shared frame would shear differently-rotated members.
 *
 * Read from the live meshes rather than the store so the box tracks a drag in
 * progress, where the store is deliberately stale.
 */
export function frameFromMeshes(ids, meshes, out) {
  const live = ids.map((id) => meshes.get(id)).filter(Boolean)
  if (!live.length) return null

  if (live.length === 1) {
    const mesh = live[0]
    mesh.updateMatrixWorld()
    const gb = mesh.geometry.boundingBox
    gb.getSize(_v)
    out.half.set(
      (_v.x * Math.abs(mesh.scale.x)) / 2,
      (_v.y * Math.abs(mesh.scale.y)) / 2,
      (_v.z * Math.abs(mesh.scale.z)) / 2
    )
    out.quat.copy(mesh.quaternion)
    gb.getCenter(_v).multiply(mesh.scale).applyQuaternion(mesh.quaternion)
    out.center.copy(mesh.position).add(_v)
    out.single = true
    return out
  }

  _box.makeEmpty()
  const each = new THREE.Box3()
  for (const mesh of live) _box.union(boxOfMesh(mesh, each))
  _box.getCenter(out.center)
  _box.getSize(_v)
  out.half.copy(_v).multiplyScalar(0.5)
  out.quat.identity()
  out.single = false
  return out
}

export const emptyFrame = () => ({
  center: new THREE.Vector3(),
  quat: new THREE.Quaternion(),
  half: new THREE.Vector3(1, 1, 1),
  single: true,
})

/**
 * Where along a line the pointer is aiming: the point on the line closest to
 * the pointer ray. This is what makes an axis handle track the cursor no
 * matter which way the camera is facing — far more stable than intersecting a
 * camera-facing plane, which degenerates when you sight down the axis.
 *
 * Returns the signed distance from `origin` along `dir` (dir must be unit).
 */
export function distanceAlongLine(ray, origin, dir) {
  const w0 = _v.copy(ray.origin).sub(origin)
  const b = ray.direction.dot(dir)
  const d = ray.direction.dot(w0)
  const e = dir.dot(w0)
  const denom = 1 - b * b
  // Ray and line are parallel — no stable answer, so don't move.
  if (Math.abs(denom) < 1e-6) return null
  return (e - b * d) / denom
}

/** Angle of a point around `center`, measured in the plane spanned by u, v. */
export function angleInPlane(point, center, u, v) {
  const p = _v.copy(point).sub(center)
  return Math.atan2(p.dot(v), p.dot(u))
}

/** Any unit vector perpendicular to `axis`. */
export function perpendicularTo(axis, target = new THREE.Vector3()) {
  const seed = Math.abs(axis.y) > 0.9 ? UNIT_X : UNIT_Y
  return target.crossVectors(axis, seed).normalize()
}

export const UNIT_X = new THREE.Vector3(1, 0, 0)
export const UNIT_Y = new THREE.Vector3(0, 1, 0)
export const UNIT_Z = new THREE.Vector3(0, 0, 1)

export const snapTo = (value, step) => (step ? Math.round(value / step) * step : value)
