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
 * **What counts as caught** is worked out in `scene/marqueeHit`, which is the
 * arithmetic on its own so it can be checked without a browser.
 */
import { useEffect } from 'react'
import * as THREE from 'three'
import { useThree } from '@react-three/fiber'
import { hullHitsRect, hullOf, screenCornersOf } from './marqueeHit'
import { meshes } from './meshRegistry'
import { useScene } from './sceneStore'
import { CLICK_SLOP } from './orbit'
import { viewport } from './viewportApi'

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
        const corners = screenCornersOf(mesh, camera, rect)
        if (corners && hullHitsRect(hullOf(corners), drag)) caught.push(id)
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

        // Somebody else already owns this drag. A gizmo handle is not a block,
        // so the raycast on the way down let a press on one through and a
        // resize or a turn drew a selection box across the yard behind it —
        // which then threw the selection away on release. `begin` switches the
        // camera controls off the moment it takes a drag, and that flag is the
        // one thing every claim on the pointer has in common: the box handles,
        // the turn levers, the lift, and dragging a block by its body.
        //
        // It is asked here rather than on the way down because that is a
        // native listener racing R3F's synthetic one; by the time the pointer
        // has moved far enough to mean a drag, the claim is in.
        if (viewport.controls && !viewport.controls.enabled) {
          start = null
          return
        }
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
