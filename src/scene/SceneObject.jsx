import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { Edges, Outlines } from '@react-three/drei'
import { keyOfParams } from '../shapes'
import { acquireShape, isFinished, releaseShape } from '../shapes/csg'
import { registerMesh } from './meshRegistry'
import { useFonts } from '../shapes/fontStore'
import { dragBus } from './dragBus'

// The outline shader offsets by this many *drawing-buffer* pixels, so scale it
// by the device pixel ratio to land on the design's 4 CSS pixels.
const OUTLINE_PX =
  4 * Math.min(typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1, 2)

/** What a hole looks like: see-through, and the same grey whatever it was. */
const HOLE_COLOR = '#9AA3B4'

/**
 * One shape. Geometry is shared by everything with the same type *and* the
 * same parameters, and reference counted — two default cubes still cost one
 * geometry, while a gear nobody is using any more gets its buffers freed.
 *
 * `holes` are the blocks combined with this one that cut into it. They join
 * the cache key because a block with a hole through it is a different
 * geometry, and the key has to change when the hole moves or is resized.
 */
function SceneObject({ object, selected, onSelect, holes, castShadow = true }) {
  const meshRef = useRef()
  /** When and where this block was last pressed, for spotting a double press. */
  const lastPress = useRef(null)
  const bind = useCallback(
    (mesh) => {
      meshRef.current = mesh
      registerMesh(object.id, mesh)
    },
    [object.id]
  )

  // The transform is written to the mesh directly, every time the object
  // changes, rather than left to R3F's prop diffing. The gizmo mutates the
  // mesh behind React's back while a drag is in flight, so by the time the
  // drag commits, what React last *set* and what the mesh actually *holds*
  // have come apart. A resize is the case that bites: the drag paints
  // scale 1.4 onto the mesh, the commit bakes that into the shape's
  // millimetres and puts the store's scale back to 1 — and React, comparing
  // the new [1,1,1] with the [1,1,1] it remembers setting, skips it. The mesh
  // is left wearing the drag's 1.4 on top of geometry that has already grown
  // by 1.4, and the block jumps a whole step the moment you let go.
  useLayoutEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return
    mesh.position.fromArray(object.position)
    mesh.rotation.fromArray(object.rotation)
    mesh.scale.fromArray(object.scale)
  }, [object.position, object.rotation, object.scale])

  // Holes go in by shape *and* by where they sit relative to this block, so
  // sliding the pair across the plate together doesn't rebuild the cut.
  // A typeface that arrives after the words were first drawn has to redraw
  // them. Nothing about the object changes when it lands, so the generation
  // counter is what makes the key differ — see shapes/fontStore.
  const fontGeneration = useFonts((s) => s.generation)
  const shapeKey =
    (object.type === 'text' ? `f${fontGeneration}` : '') +
    keyOfParams(object.type, object.params) +
    (holes?.length
      ? `|${object.position}|${object.rotation}|${object.scale}` +
        holes.map((h) => `#${keyOfParams(h.type, h.params)}@${h.position}|${h.rotation}|${h.scale}`).join('')
      : '')
  const geometry = useMemo(() => acquireShape(object, holes), [shapeKey]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => releaseShape(geometry), [geometry])

  // A combined hole has done its cutting and gets out of the way, leaving the
  // solid with the bite taken out of it and nothing else. It is still here —
  // still cutting, still selectable through its group, still there to come
  // back when the piece is split apart — just not drawn.
  const finished = isFinished(object)

  return (
    <mesh
      ref={bind}
      geometry={geometry}
      visible={!finished}
      castShadow={castShadow && !object.hole}
      receiveShadow={!object.hole}
      onPointerDown={(e) => {
        // The left button only. The right one turns the view and the middle
        // one slides it (see scene/orbit), and a block happening to be under
        // the pointer is no reason for either to pick it up and carry it —
        // which is what this did, so turning the view while looking at
        // something dragged it across the plate instead.
        const button = e.button ?? e.nativeEvent?.button ?? 0
        if (button !== 0) return
        e.stopPropagation()

        // Two quick presses on the same spot open a text block for editing.
        // Counted here rather than through R3F's own `onDoubleClick`, which
        // never arrives: the native `dblclick` reaches the canvas, but the
        // camera takes a pointer capture on the way past and the synthetic
        // event does not survive it. Presses do arrive, so presses are what
        // this counts.
        const now = performance.now()
        const px = e.nativeEvent?.clientX ?? e.clientX ?? 0
        const py = e.nativeEvent?.clientY ?? e.clientY ?? 0
        const last = lastPress.current
        const near = last && now - last.at < 400 && Math.hypot(px - last.x, py - last.y) < 6
        lastPress.current = { at: now, x: px, y: py }
        if (near && object.type === 'text') {
          lastPress.current = null
          dragBus.editWords?.(object.id)
          return
        }

        onSelect(object.id, e.shiftKey || e.nativeEvent?.shiftKey)
        // Dragging a block's body slides it along the floor. A press that
        // never moves is just a selection click, which costs nothing.
        dragBus.startBodyMove?.(e.nativeEvent)
      }}
    >
      {/* The `key` is load-bearing. Both branches are a meshStandardMaterial,
          so without it React reconciles them as one element and merely assigns
          `transparent` onto the material three has already compiled a program
          for — which leaves a hole rendering stone opaque. Keying them apart
          builds a fresh material each way round. */}
      {object.hole ? (
        // Deliberately one grey for every hole, whatever colour the block was:
        // "this one is a hole" is the only thing it now has to say. depthWrite
        // off so two overlapping holes don't punch each other out on screen.
        <meshStandardMaterial
          key="hole"
          color={HOLE_COLOR}
          roughness={0.35}
          metalness={0}
          transparent
          opacity={selected ? 0.4 : 0.26}
          depthWrite={false}
        />
      ) : (
        <meshStandardMaterial key="solid" color={object.color} roughness={0.62} metalness={0.04} />
      )}
      {/* 4px accent outline, no pulse — per the design's selection note.
          Note: drei's `screenspace` flag means *object-space* offset, which
          blows the shell apart; the default (pixel-space) is what we want.

          A hole gets edges instead. The outline is a back-face shell sitting
          just outside the mesh, which an opaque block hides all but the rim of
          — a see-through one doesn't, so the shell fills the ghost in solid
          purple and it stops reading as a hole at all. Lines along the shape's
          own edges say "picked" with nothing to see through. */}
      {selected &&
        (object.hole ? (
          <Edges threshold={20} color="#7C4DFF" />
        ) : (
          <Outlines
            thickness={OUTLINE_PX}
            color="#7C4DFF"
            transparent
            opacity={1}
            toneMapped={false}
            // `angle={0}` is load-bearing, and drei defaults it to Math.PI.
            //
            // Given an angle, Outlines builds its shell with
            // `toCreasedNormals(parent.geometry, angle)` — and three's
            // `toCreasedNormals` returns *the original geometry* when it is
            // not indexed, writing the creased normals straight into it. Our
            // carved geometry comes out of three-bvh-csg non-indexed, so
            // picking up a block with a hole in it rewrote that block's
            // normals: a tray's crisp edges went soft, and a die with
            // twenty-one pips shattered into shards. Letting go then ran
            // `mesh.geometry.dispose()` on the shared, reference-counted
            // geometry the block was still drawn from.
            //
            // At zero it shares the parent's geometry untouched and disposes
            // nothing, which is what a back-face shell wanted in the first
            // place. Plain shapes never showed this: three's own geometries
            // are indexed, so `toNonIndexed()` hands back a copy and the
            // original is left alone.
            angle={0}
          />
        ))}
    </mesh>
  )
}

export default memo(SceneObject)
