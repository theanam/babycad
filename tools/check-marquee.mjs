/**
 * Marquee check:  `node tools/check-marquee.mjs`
 *
 * Dragging a box over the plate selects what the box touches. What counts as
 * touching used to be the upright rectangle drawn around a block's projected
 * corners, which is the same as the block only when the block happens to sit
 * square to the screen.
 *
 * For a long bar lying at an angle it is nothing like it: the bar runs corner
 * to corner across the view, so the rectangle around it covers most of the
 * screen, and a box drawn around two small parts in the middle of that span —
 * nowhere near the bar — took the bar too. That is the case below, built to
 * the shape of the report it came from.
 *
 * The fix is to test the outline of those corners rather than a rectangle
 * around them. A box is convex and so is its shadow, so the outline is the
 * silhouette exactly; nothing here is an approximation.
 */
import { register } from 'node:module'

register('./resolve-extensionless.mjs', import.meta.url)

const THREE = await import('three')
const { screenCornersOf, hullOf, hullHitsRect } = await import('../src/scene/marqueeHit.js')

let problems = 0
const fail = (message) => {
  console.log(`  BAD ${message}`)
  problems++
}
const ok = (message) => console.log(`  ok  ${message}`)

const VIEW = { left: 0, top: 0, width: 1400, height: 900 }
const camera = new THREE.PerspectiveCamera(40, VIEW.width / VIEW.height, 2, 4000)
camera.position.set(220, 200, 260)
camera.lookAt(0, 10, 0)
camera.updateMatrixWorld()
camera.updateProjectionMatrix()

const block = (size, position, rotationY = 0) => {
  const geometry = new THREE.BoxGeometry(...size)
  geometry.computeBoundingBox()
  const mesh = new THREE.Mesh(geometry)
  mesh.position.set(...position)
  mesh.rotation.y = rotationY
  mesh.updateMatrixWorld()
  return mesh
}

const caught = (mesh, rect) => hullHitsRect(hullOf(screenCornersOf(mesh, camera, VIEW)), rect)

/** What the old test did: the upright rectangle around the corners. */
const looseRect = (mesh) => {
  const pts = screenCornersOf(mesh, camera, VIEW)
  return {
    minX: Math.min(...pts.map((p) => p[0])),
    maxX: Math.max(...pts.map((p) => p[0])),
    minY: Math.min(...pts.map((p) => p[1])),
    maxY: Math.max(...pts.map((p) => p[1])),
  }
}
const rectsOverlap = (a, b) =>
  a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY

/** A box drawn snugly round some blocks, as somebody dragging would. */
const around = (meshes, pad = 8) => {
  const pts = meshes.flatMap((m) => screenCornersOf(m, camera, VIEW))
  return {
    minX: Math.min(...pts.map((p) => p[0])) - pad,
    maxX: Math.max(...pts.map((p) => p[0])) + pad,
    minY: Math.min(...pts.map((p) => p[1])) - pad,
    maxY: Math.max(...pts.map((p) => p[1])) + pad,
  }
}

/* ------------------------------------------------ the reported scenario -- */

console.log('\na box round two small parts leaves the long bar alone…')
{
  // A 200 mm bar lying across the plate at an angle, and two small parts well
  // off to one side of it.
  //
  // Where they stand matters, and not only that they are "away from" the bar.
  // Turned a quarter of a half-turn the bar runs along x = −z, so at x = 60 it
  // passes through z = −60: parts either side of that are parts the bar runs
  // between, and a box round both really does cross it. Move them far enough
  // off and the old test does not catch the bar either, and the case stops
  // being about anything. These two sit where both things are true — inside
  // the upright rectangle around the bar, nowhere near the bar itself — which
  // is the arrangement the report came in with.
  const bar = block([198, 6, 6], [0, 3, 0], Math.PI / 4)
  const one = block([12, 10, 12], [60, 5, 0])
  const two = block([12, 10, 12], [60, 5, 30])

  const drag = around([one, two])
  if (!caught(one, drag) || !caught(two, drag)) fail('the two parts the box was drawn round were missed')
  else ok('both parts inside the box are caught')

  if (caught(bar, drag)) fail('the long bar was caught by a box nowhere near it')
  else ok('the long bar, which the box never crosses, is left alone')

  // And the old way really did get this wrong, so the test above means
  // something rather than passing for its own reasons.
  if (!rectsOverlap(looseRect(bar), drag)) {
    fail('the upright rectangle around the bar does not reach the box — this case no longer reproduces the report')
  } else ok('the rectangle the old test used does reach that box, which is what went wrong')
}

/* ---------------------------------------------------- and the ordinary -- */

console.log('\nand the everyday cases still behave…')
{
  const here = block([20, 20, 20], [0, 10, 0])
  const far = block([20, 20, 20], [150, 10, 150])

  const round = around([here])
  if (!caught(here, round)) fail('a block with the box drawn round it was missed')
  else ok('a block inside the box is caught')
  if (caught(far, round)) fail('a block on the other side of the plate was caught')
  else ok('a block outside the box is not')

  // Touching is enough — a block need not be swallowed whole.
  const corners = screenCornersOf(here, camera, VIEW)
  const xs = corners.map((p) => p[0])
  const ys = corners.map((p) => p[1])
  const clipped = {
    minX: (Math.min(...xs) + Math.max(...xs)) / 2,
    maxX: Math.max(...xs) + 200,
    minY: (Math.min(...ys) + Math.max(...ys)) / 2,
    maxY: Math.max(...ys) + 200,
  }
  if (!caught(here, clipped)) fail('a box over only part of a block missed it')
  else ok('a box over part of a block still catches it')

  // A bar the box genuinely crosses must still be caught.
  const bar = block([198, 6, 6], [0, 3, 0], Math.PI / 4)
  const middle = around([block([10, 10, 10], [0, 3, 0])], 20)
  if (!caught(bar, middle)) fail('a box drawn across the middle of the bar missed it')
  else ok('a box drawn across the bar does catch it')
}

console.log(problems ? `\n${problems} problem${problems === 1 ? '' : 's'}` : '\nall clear')
process.exit(problems ? 1 : 0)
