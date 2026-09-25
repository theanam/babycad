/**
 * The subtraction itself, over plain arrays, with nothing around it.
 *
 * This is the one function that turns a solid and some holes into a cut solid,
 * and it is kept free of everything else on purpose: no caches, no store, no
 * three.js scene, no DOM. That is what lets the same code run in three places
 * that could not otherwise share it — the worker that does the cutting while
 * you watch (`cutWorker`), the synchronous path the exporter and the checks
 * still use (`csg.buildCut`), and a Node check that can compare the two.
 *
 * Positions and normals are the flat, non-indexed arrays three keeps them in;
 * a hole's `matrix` is the sixteen numbers that put it where it sits relative
 * to the solid, whose own geometry is at the origin. `io/solidCut` cuts the
 * same holes for the exported file and has to place them exactly as these do.
 */
import * as THREE from 'three'
import { Brush, Evaluator, SUBTRACTION } from 'three-bvh-csg'

const evaluator = new Evaluator()
// Our geometries carry position and normal; a brush pair whose attribute sets
// disagree throws, so pin the evaluator to the two both are guaranteed to have.
evaluator.attributes = ['position', 'normal']
evaluator.useGroups = false

const _identity = new THREE.Matrix4()

/** A geometry from flat arrays, the way three would have built it. */
function geometryFrom({ positions, normals }) {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  if (normals?.length === positions.length) {
    g.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
  } else {
    g.computeVertexNormals()
  }
  return g
}

/** The flat arrays back out of a geometry, as its own copies. */
export function arraysOf(geometry) {
  const flat = geometry.getIndex() ? geometry.toNonIndexed() : geometry
  const pos = flat.getAttribute('position')
  const nor = flat.getAttribute('normal')
  const out = {
    positions: pos ? Float32Array.from(pos.array) : new Float32Array(0),
    normals: nor && pos && nor.count === pos.count ? Float32Array.from(nor.array) : null,
  }
  if (flat !== geometry) flat.dispose()
  return out
}

function brushAt(geometry, matrix) {
  const brush = new Brush(geometry)
  brush.matrixAutoUpdate = false
  brush.matrix.copy(matrix)
  brush.matrix.decompose(brush.position, brush.quaternion, brush.scale)
  brush.updateMatrixWorld(true)
  return brush
}

/**
 * Cut every hole out of the solid, in order, and hand back the result as
 * arrays. `solid` is `{ positions, normals }`; each hole is the same plus a
 * `matrix` (sixteen numbers, column-major, as `Matrix4.elements`).
 *
 * The chain is (((solid − h1) − h2) − h3): each cut is taken from the result
 * of the last, and the intermediate geometries are disposed as it goes.
 */
export function cutArrays(solid, holes) {
  let result = geometryFrom(solid)
  const m = new THREE.Matrix4()
  for (const hole of holes) {
    const cutter = geometryFrom(hole)
    m.fromArray(hole.matrix)
    const cut = evaluator.evaluate(brushAt(result, _identity), brushAt(cutter, m), SUBTRACTION)
    cutter.dispose()
    result.dispose()
    result = cut.geometry
  }
  const out = arraysOf(result)
  result.dispose()
  return out
}
