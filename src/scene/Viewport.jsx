import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { ContactShadows, Grid } from '@react-three/drei'
import SceneObject from './SceneObject'
import ErrorBoundary from '../ui/ErrorBoundary'
import BoxGizmo from './BoxGizmo'
import AlignGizmo from './AlignGizmo'
import MirrorGizmo from './MirrorGizmo'
import MeasureTool from './MeasureTool'
import { OrbitCamera } from './orbit'
import { useScene } from './sceneStore'
import { HOME_CAMERA, viewport } from './viewportApi'
import { HEAVY_SCENE, PLATE, PLATE_HALF, SNAP } from '../constants'
import { cuttersByObject, tooHeavyToCut } from '../shapes/csg'
import { gesture } from './gesture'
import MarqueeSelect from './MarqueeSelect'
import { toast } from '../ui/Toast'

/**
 * Owns the camera: builds the OrbitCamera over the canvas, publishes it (and
 * the renderer) so the DOM chrome can drive the scene, and advances any glide
 * it has in flight each frame. It is also handed to R3F as `controls`, which
 * is how the gizmo finds it to switch orbiting off during a drag.
 */
function Rig() {
  const { camera, gl, scene, set } = useThree()
  useEffect(() => {
    const orbit = new OrbitCamera(camera, gl.domElement)
    orbit.flyTo(
      new THREE.Vector3(...HOME_CAMERA.position),
      new THREE.Vector3(...HOME_CAMERA.target),
      false
    )
    set({ controls: orbit })
    viewport.camera = camera
    viewport.gl = gl
    viewport.controls = orbit
    gl.__babycadScene = scene
    return () => {
      orbit.dispose()
      set({ controls: null })
      viewport.controls = null
    }
  }, [camera, gl, scene, set])
  useFrame(() => viewport.controls?.tick())
  return null
}

/**
 * The yard: a bounded plate rather than an endless grid. A definite
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
      {/* Translucent, and lit on both faces. Opaque, it swallowed anything
          that went below it — a block dragged under the floor simply stopped
          being there, with nothing to say where it had gone. Now it shows
          through, tinted by the plate, which is exactly the "this is under
          the floor" the solid version couldn't say. Still single-sided, so
          looking up from underneath the model is not seen through a sheet of
          grey — the plate is simply not there from below, as before. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.08, 0]} receiveShadow>
        <planeGeometry args={[PLATE, PLATE]} />
        <meshStandardMaterial
          color="#12161e"
          roughness={1}
          metalness={0}
          transparent
          opacity={0.62}
        />
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
  // Which holes cut what, worked out once for the scene rather than once per
  // block testing itself against every hole in the yard.
  const cutters = useMemo(() => cuttersByObject(objects), [objects])

  /*
   * Holes that are overlapping something and getting nowhere.
   *
   * A solid too detailed to cut while you watch is drawn whole instead (see
   * shapes/csg), and a hole whose every target is like that has to stay on
   * screen even once it is combined — otherwise combining it hides the one
   * thing that said a hole was there and leaves a block that looks solid. A
   * hole that reaches into two blocks and gets through to one of them has done
   * its job and steps back as it always did, and so does one that overlaps
   * nothing at all: that is a hole in the wrong place, not a hole that failed.
   */
  const stalled = useMemo(() => {
    const byId = new Map(objects.map((o) => [o.id, o]))
    const reached = new Set()
    const blocked = new Set()
    for (const [id, holes] of cutters) {
      const heavy = tooHeavyToCut(byId.get(id))
      for (const hole of holes) (heavy ? blocked : reached).add(hole.id)
    }
    for (const id of reached) blocked.delete(id)
    return blocked
  }, [cutters, objects])

  // Said once per block, because a hole that is not cutting looks exactly like
  // one that has not been pushed in far enough yet, and the difference matters.
  const told = useRef(new Set())
  useEffect(() => {
    const byId = new Map(objects.map((o) => [o.id, o]))
    for (const id of cutters.keys()) {
      if (told.current.has(id) || !tooHeavyToCut(byId.get(id))) continue
      told.current.add(id)
      toast(
        `That model has too many triangles to cut through while you watch — the hole still cuts it in the file you export`,
        'warn'
      )
    }
  }, [cutters, objects])

  // Past a heavy scene, stop every block casting a shadow rather than let the
  // frame rate collapse.
  const shadows = objects.length <= HEAVY_SCENE

  return (
    <>
      {objects.map((o) => (
        // One block that cannot be drawn is one block missing from the plate,
        // not an empty screen. It keeps its row in the panel, so it can still
        // be selected, changed back or deleted — which is usually the fix.
        <ErrorBoundary key={o.id} what={`a ${o.type}`} fallback={() => null}>
          <SceneObject
            object={o}
            selected={selected.has(o.id)}
            onSelect={select}
            holes={cutters.get(o.id) ?? null}
            cutting={!stalled.has(o.id)}
            castShadow={shadows}
          />
        </ErrorBoundary>
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
      {/* Lifted from betterScad's viewport, whose reasoning applies here word
          for word: enough ambient and every face receives the same light,
          which is exactly the information a CAD preview exists to show — the
          model turns into a flat silhouette of its own colour and a chamfer
          becomes indistinguishable from a painted line.

          Three keys, deliberately not attached to the camera: fixed lighting
          makes it far easier to judge a shape's form while orbiting round it.
          All three are white, so a block comes back the colour its swatch
          says. Directions are betterScad's unit vectors scaled to this scene's
          millimetres — only the direction matters to the shading, the distance
          is there to put the key outside the build for its shadow camera. */}
      <ambientLight intensity={0.55} />
      <directionalLight
        position={[200, 120, 280]}
        intensity={2}
        castShadow={!heavy}
        shadow-mapSize={heavy ? [512, 512] : [2048, 2048]}
        shadow-bias={-0.0005}
      >
        <orthographicCamera attach="shadow-camera" args={[-320, 320, 320, -320, 2, 900]} />
      </directionalLight>
      {/* Slightly below the plate, which is also what keeps a build seen from
          underneath a build rather than a silhouette. */}
      <directionalLight position={[-240, -80, 120]} intensity={0.55} />
      <directionalLight position={[0, 200, -200]} intensity={0.45} />
    </>
  )
}

/**
 * The box handles, or the align targets — never both. See scene/AlignGizmo for
 * why they take turns rather than share the box.
 */
function Handles() {
  const aligning = useScene((s) => s.aligning)
  const mirroring = useScene((s) => s.mirroring)
  const measuring = useScene((s) => s.measuring)
  const any = useScene((s) => s.selectedIds.length > 0)
  const multi = useScene((s) => s.selectedIds.length > 1)
  // The tape measure takes the whole scene's presses, so the handles stand
  // aside for it — a corner handle in the way is a place you cannot measure.
  if (measuring) return <MeasureTool />
  if (mirroring && any) return <MirrorGizmo />
  return aligning && multi ? <AlignGizmo /> : <BoxGizmo />
}

export default function Viewport() {
  const clearSelection = useScene((s) => s.clearSelection)

  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      // preserveDrawingBuffer lets us grab a thumbnail when a build is saved.
      // `flat` is NoToneMapping. The ACES filmic curve R3F defaults to is built
      // for photographic footage: it rolls highlights off into a shoulder, and
      // with a palette of flat bright colours under a bright rig every face sat
      // up on that shoulder, where the curve is nearly horizontal. Differences
      // between faces were squashed and the swatches came back desaturated —
      // a #FFC93D cube rendering as rgb(214,184,73). Linear keeps the colours
      // the palette actually names and lets the key light separate the faces.
      flat
      gl={{ antialias: true, preserveDrawingBuffer: true }}
      camera={{ position: HOME_CAMERA.position, fov: 40, near: 2, far: 4000 }}
      /**
       * Clicking empty plate clears the selection. Two things are not that.
       *
       * The right and middle buttons belong to the camera — turning the view
       * and sliding it — and moving the camera is not a decision about what is
       * selected. Distance alone could not tell them apart: a swing that
       * happens to travel only a few pixels reads as a click, so right-clicking
       * or nudging the view round dropped whatever was picked. The button says
       * so outright and does not depend on how far anybody dragged.
       *
       * With the left button the distance test still matters, because that is
       * what separates a click on the plate from the end of a selection box
       * drawn across it. Touch reports button 0, so a tap still clears.
       */
      onPointerMissed={(e) => {
        if (e.button !== 0) return
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
      <Handles />
      <MarqueeSelect />
    </Canvas>
  )
}
