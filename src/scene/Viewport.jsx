import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { Canvas, useThree } from '@react-three/fiber'
import { ContactShadows, Grid, OrbitControls } from '@react-three/drei'
import SceneObject from './SceneObject'
import BoxGizmo from './BoxGizmo'
import CameraRig from './CameraRig'
import { useScene } from './sceneStore'
import { HOME_CAMERA, viewport } from './viewportApi'
import { HEAVY_SCENE, PLATE, PLATE_HALF, SNAP } from '../constants'
import { gesture } from './gesture'

/** Publishes camera/renderer/controls so the DOM chrome can drive the scene. */
function Rig() {
  const { camera, gl, scene, controls } = useThree()
  useEffect(() => {
    viewport.camera = camera
    viewport.gl = gl
    gl.__babycadScene = scene
  }, [camera, gl, scene])
  useEffect(() => {
    viewport.controls = controls ?? null
  }, [controls])
  return null
}

/**
 * The yard: a bounded 200x200 mm plate rather than an endless grid. A definite
 * edge gives the scene a sense of scale, and keeps new blocks somewhere the
 * camera is actually looking. The grid reads in millimetres: a cell is one
 * snap step, a heavier section line every 20 mm — one shape footprint.
 */
function BuildPlate() {
  const border = useMemo(() => {
    const g = new THREE.BufferGeometry()
    const h = PLATE_HALF
    // prettier-ignore
    g.setAttribute('position', new THREE.Float32BufferAttribute([
      -h, 0, -h,  h, 0, -h,
       h, 0, -h,  h, 0,  h,
       h, 0,  h, -h, 0,  h,
      -h, 0,  h, -h, 0, -h,
    ], 3))
    return g
  }, [])

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.08, 0]} receiveShadow>
        <planeGeometry args={[PLATE, PLATE]} />
        <meshStandardMaterial color="#12161e" roughness={1} metalness={0} />
      </mesh>

      <Grid
        args={[PLATE, PLATE]}
        cellSize={SNAP.move}
        cellThickness={1}
        cellColor="#2B3140"
        sectionSize={20}
        sectionThickness={1.4}
        sectionColor="#3A4254"
        fadeDistance={1800}
        fadeStrength={0.6}
        followCamera={false}
      />

      <lineSegments geometry={border} raycast={() => null}>
        <lineBasicMaterial color="#3A4254" />
      </lineSegments>
    </group>
  )
}

/** Dashed landing pad shown while the scene is still empty. */
function StartPad() {
  const geometry = useMemo(() => new THREE.RingGeometry(38, 40, 4, 1), [])
  return (
    <mesh geometry={geometry} rotation={[-Math.PI / 2, 0, Math.PI / 4]} position={[0, 0.2, 0]}>
      <meshBasicMaterial color="#3A4254" side={THREE.DoubleSide} transparent opacity={0.8} />
    </mesh>
  )
}

function Blocks() {
  const objects = useScene((s) => s.objects)
  const selectedIds = useScene((s) => s.selectedIds)
  const select = useScene((s) => s.select)

  const selected = useMemo(() => new Set(selectedIds), [selectedIds])
  // Past a heavy scene, stop every block casting a shadow rather than let the
  // frame rate collapse.
  const shadows = objects.length <= HEAVY_SCENE

  return (
    <>
      {objects.map((o) => (
        <SceneObject
          key={o.id}
          object={o}
          selected={selected.has(o.id)}
          onSelect={select}
          castShadow={shadows}
        />
      ))}
      {!objects.length && <StartPad />}
    </>
  )
}

/** Soft blob shadow under the blocks; skipped once the scene gets heavy. */
function GroundShadow() {
  const count = useScene((s) => s.objects.length)
  if (count > HEAVY_SCENE) return null
  return (
    <ContactShadows
      position={[0, 0.04, 0]}
      opacity={0.5}
      scale={480}
      blur={2.4}
      far={280}
      resolution={512}
    />
  )
}

function Lighting() {
  const count = useScene((s) => s.objects.length)
  const heavy = count > HEAVY_SCENE
  return (
    <>
      <ambientLight intensity={0.85} />
      <hemisphereLight args={['#dfe6ff', '#1b2030', 0.55]} />
      <directionalLight
        position={[120, 240, 160]}
        intensity={1.5}
        castShadow={!heavy}
        shadow-mapSize={heavy ? [512, 512] : [2048, 2048]}
        shadow-bias={-0.0005}
      >
        <orthographicCamera attach="shadow-camera" args={[-320, 320, 320, -320, 2, 800]} />
      </directionalLight>
      {/* Cool rim light so the dark side of a block never goes fully flat. */}
      <directionalLight position={[-160, 100, -120]} intensity={0.35} color="#9fb4ff" />
    </>
  )
}

export default function Viewport() {
  const clearSelection = useScene((s) => s.clearSelection)

  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      // preserveDrawingBuffer lets us grab a thumbnail when a build is saved.
      gl={{ antialias: true, preserveDrawingBuffer: true }}
      camera={{ position: HOME_CAMERA.position, fov: 40, near: 2, far: 4000 }}
      // Only a real click clears the selection — not the end of a camera swing.
      onPointerMissed={() => {
        if (!gesture.moved) clearSelection()
      }}
      onCreated={({ scene }) => {
        scene.background = new THREE.Color('#0B0D11')
      }}
    >
      <Rig />
      <Lighting />

      <BuildPlate />
      <GroundShadow />

      <Blocks />
      <BoxGizmo />
      <CameraRig />

      <OrbitControls
        makeDefault
        target={HOME_CAMERA.target}
        enableDamping
        dampingFactor={0.12}
        minDistance={50}
        maxDistance={900}
        // Scrolling zooms towards whatever is under the pointer.
        zoomToCursor
        // Orbiting is CameraRig's job, so it can pivot on the cursor.
        enableRotate={false}
        // Keep the camera above the floor so kids can't get lost underneath.
        maxPolarAngle={Math.PI / 2 - 0.05}
        // One finger orbits (handled by CameraRig); two pinch-zoom and pan.
        touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }}
      />
    </Canvas>
  )
}
