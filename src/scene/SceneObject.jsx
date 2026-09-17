import { memo, useCallback } from 'react'
import { Outlines } from '@react-three/drei'
import { getGeometry } from './geometry'
import { registerMesh } from './meshRegistry'
import { dragBus } from './dragBus'

// The outline shader offsets by this many *drawing-buffer* pixels, so scale it
// by the device pixel ratio to land on the design's 4 CSS pixels.
const OUTLINE_PX =
  4 * Math.min(typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1, 2)

/**
 * One primitive. Geometry is shared per type; only the material is per-block,
 * which keeps a hundred-block scene cheap to render.
 */
function SceneObject({ object, selected, onSelect, castShadow = true }) {
  const bind = useCallback((mesh) => registerMesh(object.id, mesh), [object.id])

  return (
    <mesh
      ref={bind}
      geometry={getGeometry(object.type)}
      position={object.position}
      rotation={object.rotation}
      scale={object.scale}
      castShadow={castShadow}
      receiveShadow
      onPointerDown={(e) => {
        e.stopPropagation()
        onSelect(object.id, e.shiftKey || e.nativeEvent?.shiftKey)
        // Dragging a block's body slides it along the floor. A press that
        // never moves is just a selection click, which costs nothing.
        dragBus.startBodyMove?.(e.nativeEvent)
      }}
    >
      <meshStandardMaterial color={object.color} roughness={0.55} metalness={0} />
      {/* 4px accent outline, no pulse — per the design's selection note.
          Note: drei's `screenspace` flag means *object-space* offset, which
          blows the shell apart; the default (pixel-space) is what we want. */}
      {selected && (
        <Outlines thickness={OUTLINE_PX} color="#7C4DFF" transparent opacity={1} toneMapped={false} />
      )}
    </mesh>
  )
}

export default memo(SceneObject)
