import { memo, useCallback, useEffect, useMemo } from 'react'
import { Outlines } from '@react-three/drei'
import { keyOfParams } from '../shapes'
import { acquireShape, releaseShape } from '../shapes/csg'
import { registerMesh } from './meshRegistry'
import { dragBus } from './dragBus'

// The outline shader offsets by this many *drawing-buffer* pixels, so scale it
// by the device pixel ratio to land on the design's 4 CSS pixels.
const OUTLINE_PX =
  4 * Math.min(typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1, 2)

/** What a hole looks like: see-through, and the same grey whatever it was. */
const HOLE_COLOR = '#9AA3B4'
/** A picked hole tints accent instead of wearing an outline — see below. */
const HOLE_SELECTED = '#9E7CFF'

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
  const bind = useCallback((mesh) => registerMesh(object.id, mesh), [object.id])

  // Holes go in by shape *and* by where they sit relative to this block, so
  // sliding the pair across the plate together doesn't rebuild the cut.
  const shapeKey =
    keyOfParams(object.type, object.params) +
    (holes?.length
      ? `|${object.position}|${object.rotation}|${object.scale}` +
        holes.map((h) => `#${keyOfParams(h.type, h.params)}@${h.position}|${h.rotation}|${h.scale}`).join('')
      : '')
  const geometry = useMemo(() => acquireShape(object, holes), [shapeKey]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => releaseShape(geometry), [geometry])

  return (
    <mesh
      ref={bind}
      geometry={geometry}
      position={object.position}
      rotation={object.rotation}
      scale={object.scale}
      castShadow={castShadow && !object.hole}
      receiveShadow={!object.hole}
      onPointerDown={(e) => {
        e.stopPropagation()
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
          color={selected ? HOLE_SELECTED : HOLE_COLOR}
          roughness={0.35}
          metalness={0}
          transparent
          opacity={selected ? 0.42 : 0.3}
          depthWrite={false}
        />
      ) : (
        <meshStandardMaterial key="solid" color={object.color} roughness={0.55} metalness={0} />
      )}
      {/* 4px accent outline, no pulse — per the design's selection note.
          Note: drei's `screenspace` flag means *object-space* offset, which
          blows the shell apart; the default (pixel-space) is what we want.

          A hole gets none. The outline is a back-face shell sitting just
          outside the mesh, which an opaque block hides all but the rim of — a
          see-through one doesn't, so the shell fills the hole in solid purple
          and it stops reading as a hole at all. Tinting the ghost says the
          same thing without anything to see through. */}
      {selected && !object.hole && (
        <Outlines thickness={OUTLINE_PX} color="#7C4DFF" transparent opacity={1} toneMapped={false} />
      )}
    </mesh>
  )
}

export default memo(SceneObject)
