/**
 * Drag a box over the yard with the left button; everything it touches is
 * selected.
 *
 * The camera gave the left button up (see `scene/orbit`), which leaves it free
 * for picking: click a block to select it, drag across empty space to take in
 * several at once. Holding Shift adds to the selection rather than replacing
 * it, exactly as Shift-clicking a block already does.
 *
 * Three things are worth knowing about how this is put together:
 *
 * **It only ever starts on empty space.** A press that lands on a block belongs
 * to that block — it selects it, and may go on to drag it along the floor — so
 * the press is raycast first and the box is only armed if nothing was hit.
 * R3F's own events can't answer this, because a native listener here has no
 * way to see that `SceneObject` called `stopPropagation` on a synthetic one.
 *
 * **The box is a plain div written to by hand**, positioned in viewport
 * coordinates on every pointer move. Putting it in React state would re-render
 * the tree on every mouse move of a drag; this is the same reason the gizmo
 * paints meshes directly rather than going through the store.
 *
 * **A block counts as touched if its screen box overlaps the drag box** — not
 * if it is swallowed whole. Requiring full containment means a kid who drags a
 * box across four blocks gets none of them because each pokes out slightly,
 * which reads as the feature being broken.
 */
import { useEffect } from 'react'
import * as THREE from 'three'
import { useThree } from '@react-three/fiber'
import { meshes } from './meshRegistry'
import { useScene } from './sceneStore'
import { CLICK_SLOP } from './orbit'

/** Screen-space bounds of a mesh's world box, in viewport pixels. */
const _v = new THREE.Vector3()
function screenBoundsOf(mesh, camera, rect) {
  const geometry = mesh.geometry
  if (!geometry.boundingBox) geometry.computeBoundingBox()
  const bb = geometry.boundingBox
  if (!bb) return null

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let seen = false

  for (const x of [bb.min.x, bb.max.x]) {
    for (const y of [bb.min.y, bb.max.y]) {
      for (const z of [bb.min.z, bb.max.z]) {
        _v.set(x, y, z).applyMatrix4(mesh.matrixWorld).project(camera)
        // A corner behind the eye projects to nonsense — the perspective divide
        // flips it through the origin. Corners in front are enough to place the
        // block on screen, and a block with none is not on screen at all.
        if (_v.z > 1) continue
        seen = true
        const sx = rect.left + ((_v.x + 1) / 2) * rect.width
        const sy = rect.top + ((1 - _v.y) / 2) * rect.height
        if (sx < minX) minX = sx
        if (sx > maxX) maxX = sx
        if (sy < minY) minY = sy
        if (sy > maxY) maxY = sy
      }
    }
  }
  return seen ? { minX, minY, maxX, maxY } : null
}

const overlaps = (a, b) =>
  a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY

export default function MarqueeSelect() {
  const { camera, gl } = useThree()

  useEffect(() => {
    const el = gl.domElement
    const box = document.createElement('div')
    box.className = 'marquee'
    document.body.appendChild(box)

    const raycaster = new THREE.Raycaster()
    const ndc = new THREE.Vector2()
    let start = null // {x, y} while the left button is down on empty space
    let live = false // past the slop, so the box is showing

    /** Did this press land on a block? Then it is the block's press, not ours. */
    const pressedBlock = (event) => {
      const rect = el.getBoundingClientRect()
      ndc.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1
      )
      raycaster.setFromCamera(ndc, camera)
      const targets = []
      for (const mesh of meshes.values()) if (mesh.visible) targets.push(mesh)
      return raycaster.intersectObjects(targets, false).length > 0
    }

    const draw = (event) => {
      const left = Math.min(start.x, event.clientX)
      const top = Math.min(start.y, event.clientY)
      box.style.left = `${left}px`
      box.style.top = `${top}px`
      box.style.width = `${Math.abs(event.clientX - start.x)}px`
      box.style.height = `${Math.abs(event.clientY - start.y)}px`
    }

    const finish = (event) => {
      const rect = el.getBoundingClientRect()
      const drag = {
        minX: Math.min(start.x, event.clientX),
        maxX: Math.max(start.x, event.clientX),
        minY: Math.min(start.y, event.clientY),
        maxY: Math.max(start.y, event.clientY),
      }

      const caught = []
      for (const [id, mesh] of meshes) {
        // Invisible means a hole that has finished cutting. It is still a real
        // object and still reachable through its group, but a box drag that
        // quietly picked up things nobody can see would be a mystery.
        if (!mesh.visible) continue
        const bounds = screenBoundsOf(mesh, camera, rect)
        if (bounds && overlaps(bounds, drag)) caught.push(id)
      }

      const { selectedIds, setSelection } = useScene.getState()
      // Shift adds, the same as Shift-clicking. Without it the drag is the whole
      // answer, including an empty drag over bare plate, which clears.
      setSelection(event.shiftKey ? [...new Set([...selectedIds, ...caught])] : caught)
    }

    const onDown = (event) => {
      if (event.pointerType !== 'mouse' || event.button !== 0) return
      if (pressedBlock(event)) return
      start = { x: event.clientX, y: event.clientY }
      live = false
    }

    const onMove = (event) => {
      if (!start) return
      if (!live) {
        // Below the slop this is still a click, and a click on empty space
        // already means "clear the selection" by way of R3F's miss handler.
        if (Math.hypot(event.clientX - start.x, event.clientY - start.y) <= CLICK_SLOP) return
        live = true
        box.style.display = 'block'
      }
      draw(event)
    }

    const onUp = (event) => {
      if (!start) return
      if (live) finish(event)
      start = null
      live = false
      box.style.display = 'none'
    }

    el.addEventListener('pointerdown', onDown)
    // On window, not the canvas: a drag that runs off the edge of the viewport
    // still has to finish, rather than leaving a box stuck on screen.
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)

    return () => {
      el.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      box.remove()
    }
  }, [camera, gl])

  return null
}
