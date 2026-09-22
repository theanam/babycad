import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import { bottomOf, useScene } from './sceneStore'
import { AXES, axisColor } from './axes'
import { meshes } from './meshRegistry'
import { dragBus } from './dragBus'
import { beginDrag, endDrag, setLive, useLive } from './liveStore'
import { angleStepFor, SNAP, SNAP_DEFAULT } from '../constants'
import { SHAPE_LABEL } from '../shapes'
import { useUI } from '../state/ui'
import { AXIS_PARAMS, coupledMask, resizeToParams } from '../shapes/resize'
import { toast } from '../ui/Toast'
import {
  angleInPlane,
  distanceAlongLine,
  emptyFrame,
  frameFromMeshes,
  perpendicularTo,
  snapTo,
  UNIT_Y,
  UNIT_Z,
} from './gizmoMath'

/**
 * Resize handles, in units of the box's half-extents.
 *
 * Every one of them sits on the *bottom* of the box and anchors to the far
 * side, so a block grows up and outward from the floor rather than sinking
 * through it, and only ever grows the way you pulled. `mask` says which axes
 * a handle is allowed to touch, and it is the whole difference between them:
 *
 *   sides    one axis. Pull the right face and only the width changes.
 *   corners  the two floor axes together, so the footprint keeps its shape.
 *            Deliberately *not* the height: grabbing a corner to make a block
 *            wider and finding it had grown taller too is the thing this
 *            mask exists to stop.
 *   top      the height, on its own.
 */
const SIDE_HANDLES = [
  { key: 's+x', handle: [1, -1, 0], anchor: [-1, -1, 0], mask: [1, 0, 0] },
  { key: 's-x', handle: [-1, -1, 0], anchor: [1, -1, 0], mask: [1, 0, 0] },
  { key: 's+z', handle: [0, -1, 1], anchor: [0, -1, -1], mask: [0, 0, 1] },
  { key: 's-z', handle: [0, -1, -1], anchor: [0, -1, 1], mask: [0, 0, 1] },
]

const CORNER_HANDLES = [
  { key: 'c++', handle: [1, -1, 1], anchor: [-1, -1, -1] },
  { key: 'c+-', handle: [1, -1, -1], anchor: [-1, -1, 1] },
  { key: 'c-+', handle: [-1, -1, 1], anchor: [1, -1, -1] },
  { key: 'c--', handle: [-1, -1, -1], anchor: [1, -1, 1] },
].map((h) => ({ ...h, mask: [1, 0, 1] }))

const HEIGHT_HANDLE = { key: 'top', handle: [0, 1, 0], anchor: [0, -1, 0], mask: [0, 1, 0] }

/**
 * Turn levers: a stick poking out of the box with a ball on the end, one per
 * axis. Swing the ball and the block turns about that axis.
 *
 * Each stick points along a direction perpendicular to the axis it turns, and
 * all three point different ways so they never overlap: the upright lever
 * reaches along +X, the across lever along +Z, the depth lever along -X.
 * `along` is which half-extent the stick has to clear before it starts.
 *
 * The colors come from `scene/axes` by internal slot, so a lever is the color
 * of the letter the properties rail and the view cube put on that same axis —
 * the upright one is Z, and blue, not three.js's green y.
 */
const TURN_HANDLES = [
  { key: 'turn-up', color: axisColor(1), axis: [0, 1, 0], rotation: [0, 0, -Math.PI / 2], along: 'x' },
  { key: 'turn-across', color: axisColor(0), axis: [1, 0, 0], rotation: [Math.PI / 2, 0, 0], along: 'z' },
  { key: 'turn-depth', color: axisColor(2), axis: [0, 0, 1], rotation: [0, 0, Math.PI / 2], along: 'x' },
].map((h) => ({ ...h, slot: h.axis.indexOf(1) }))

/**
 * The four edges of the box running along each internal axis, as signs of the
 * box's half-extents. A dimension is written beside whichever of the four is
 * nearest the camera, so the number is never round the back.
 */
const EDGES_ALONG = {
  0: [[0, -1, -1], [0, -1, 1], [0, 1, -1], [0, 1, 1]],
  1: [[-1, 0, -1], [-1, 0, 1], [1, 0, -1], [1, 0, 1]],
  2: [[-1, -1, 0], [-1, 1, 0], [1, -1, 0], [1, 1, 0]],
}

const axisOf = (slot) => AXES.find((a) => a.slot === slot)
const AXIS_KEYS = ['x', 'y', 'z']
/** A resize that touches one axis, before the shape has its say. */
const AXIS_MASKS = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]

/**
 * Always one decimal, so the label keeps its width. A number alternating
 * between "56" and "55.5" reflows the chip under it on every other frame,
 * which reads as a twitch even when the value is behaving.
 */
const fixed1 = (v) => v.toFixed(1)

/**
 * How quickly the shown number catches up with the real one, in seconds.
 *
 * The readout used to be written straight from the live geometry, sixty times
 * a second. Snapping meant it stepped half a millimetre at a time and, dragged
 * at any speed, several steps a second — which flickers rather than reads. It
 * is eased instead: it always moves toward the truth, never away, and settles
 * on it within a couple of frames of the pointer stopping, so what is on
 * screen when you let go is exact.
 */
const EASE_SECONDS = 0.07
// Close enough to be the number rather than approaching it.
const EASE_SETTLED = 0.02

const MIN_SCALE = 0.1
const MAX_SCALE = 40
const READOUT_MS = 90
// Handles hold this size on screen regardless of how far away the block is.
// Kept small: zoomed out, a scene is mostly gizmo otherwise.
const HANDLE_SCREEN = 0.017

/**
 * How close to the plate a block has to get before the plate takes it, in
 * millimetres.
 *
 * Lower something toward the floor and within this band it seats itself flat
 * rather than hovering a fraction above or sinking a fraction below — a thing
 * you can see at a glance but not place by hand, and a gap that would print
 * or not print depending on which side of nothing it landed on. Wider than
 * the snap grid on purpose: the grid makes 0 reachable, this makes it easy.
 *
 * Only for dragging. A number typed into the rail or onto the box is somebody
 * saying exactly what they want, and is left exactly there.
 */
const FLOOR_GRAB = 3

// How often the "can I actually reach this handle" test runs. Every frame
// would be wasted work: it only changes when the camera or the block moves.
const OCCLUDE_MS = 70

const euler = new THREE.Euler()
const mat = new THREE.Matrix4()
const quat = new THREE.Quaternion()
const vec = new THREE.Vector3()
const vec2 = new THREE.Vector3()
const reachPoint = new THREE.Vector3()
const reachDir = new THREE.Vector3()
const tagPoint = new THREE.Vector3()
const tagOut = new THREE.Vector3()

/**
 * The selection's bounding box, and every way to transform it.
 *
 * There are no tool modes: the corner handles resize, the top handle sets
 * height, the cone lifts, the round knob to one side turns it, and dragging
 * the block itself slides it across the floor. Which handle you grab is the
 * operation.
 *
 * Turning is always about world Y — the "spin it round" a kid expects. Tilting
 * on X or Z is typed into the properties panel, which keeps one knob on screen
 * instead of three rings.
 *
 * As with the rest of the scene, a drag mutates the meshes directly and the
 * store is written once at the end — that single write is also the undo entry.
 */
export default function BoxGizmo() {
  const selectedIds = useScene((s) => s.selectedIds)
  const snapEnabled = useScene((s) => s.snapEnabled)
  const snapStep = useScene((s) => s.snapStep)
  const freeMove = useScene((s) => s.freeMove)
  const stageTransform = useScene((s) => s.stageTransform)
  const commitTransform = useScene((s) => s.commitTransform)

  const { camera, gl, controls } = useThree()
  const raycaster = useMemo(() => new THREE.Raycaster(), [])
  const ndc = useMemo(() => new THREE.Vector2(), [])

  /**
   * The turning dial: a circle plus radial ticks every 15 degrees, with a
   * longer mark each quarter turn, so how far the block has swung is readable
   * at a glance. A scale to read the turn against rather than a picture of
   * the snap, which is finer than this and set from the snap switch.
   *
   * Drawn as lines rather than a torus so it stays a constant hairline: a
   * torus tube scales with the ring, which would be invisible around a small
   * block and a fat doughnut around a big one.
   */
  const dialGeometry = useMemo(() => {
    const points = []
    const ring = 96
    for (let i = 0; i < ring; i++) {
      const a = (i / ring) * Math.PI * 2
      const b = ((i + 1) / ring) * Math.PI * 2
      points.push(Math.cos(a), Math.sin(a), 0, Math.cos(b), Math.sin(b), 0)
    }
    const steps = 24
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2
      const c = Math.cos(a)
      const s2 = Math.sin(a)
      const inner = i % 6 === 0 ? 0.82 : 0.91
      points.push(c * inner, s2 * inner, 0, c, s2, 0)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(points, 3))
    return g
  }, [])

  // Mounting the readout needs React; keeping its text current must not, or
  // it would re-render the whole gizmo sixty times a second. So the labels go
  // up once when a drag starts and are written to by hand each frame.
  const dragging = useLive((s) => s.dragging)
  const tagGroups = useRef({})
  const tagDivs = useRef({})
  const eased = useRef({})
  // Which of the four edges along each axis the label is sitting on. Kept
  // across frames so it can be held steady; see `beside` below.
  const edgeChoice = useRef({})
  // The box's size along each axis as of the last frame, so a typed number
  // has something to be measured against.
  const liveSize = useRef([0, 0, 0])
  const [editing, setEditing] = useState(null)

  /**
   * The variable driving each axis, by name, or '' where nothing does.
   *
   * Returned as one string and split, rather than as an array: a selector
   * that builds a new array every call never compares equal, and would
   * re-render the gizmo on every store change.
   */
  const boundKey = useScene((s) => {
    if (s.selectedIds.length !== 1) return '||'
    const o = s.objects.find((x) => x.id === s.selectedIds[0])
    const map = o && AXIS_PARAMS[o.type]
    if (!map || !o.bindings) return '||'
    return AXIS_KEYS.map((axis) => {
      const key = (map[axis] ?? []).find((k) => o.bindings[k])
      const variable = key && s.variables.find((v) => v.id === o.bindings[key])
      return variable ? `${variable.name}\u0000${variable.id}` : ''
    }).join('|')
  })
  const bound = useMemo(
    () => boundKey.split('|').map((part) => {
      const [name = '', id = ''] = part.split('\u0000')
      return { name, id }
    }),
    [boundKey]
  )
  const boundNames = useMemo(() => bound.map((b) => b.name), [bound])

  // A different block is a different box; let its labels find their own edges,
  // and never leave an editor open over a block that is no longer there.
  useEffect(() => {
    edgeChoice.current = {}
    setEditing(null)
  }, [selectedIds])

  /**
   * Type a size straight onto the box.
   *
   * Goes the same way the rail's own numbers go — the shape's parameters via
   * `setParams` — rather than through a scale multiplier, so a typed height
   * keeps the block's underside on the plate exactly as typing it in the rail
   * does. The shape decides what one axis really means: ask a tube for a
   * wider X and it is the radius that changes, both ways at once.
   */
  const applyDim = useCallback((slot, typed) => {
    setEditing(null)
    const target = Number(typed)
    const from = liveSize.current[slot]
    if (!Number.isFinite(target) || target <= 0 || !(from > 0)) return
    if (Math.abs(target - from) < 1e-6) return

    const sel = useScene.getState().selectedObjects()
    if (sel.length !== 1) return
    const object = sel[0]
    const ratio = target / from
    const mask = coupledMask(object.type, AXIS_MASKS[slot])
    const resize = resizeToParams(object, mask.map((on) => (on ? ratio : 1)))

    if (resize?.blocked) {
      return toast(`${resize.blocked} follows a variable — change it in Variables`, 'warn')
    }
    if (!resize?.params) {
      const what = (SHAPE_LABEL[object.type] ?? 'shape').toLowerCase()
      return toast(`A ${what} has no single number for that side`, 'warn')
    }
    useScene.getState().setParams({ [object.id]: resize.params }, 'resize')
  }, [])

  const reachRay = useMemo(() => new THREE.Raycaster(), [])
  const occludeAt = useRef(0)

  const frame = useRef(emptyFrame())
  const boxGroup = useRef() // turns with the block
  const flatGroup = useRef() // stays world-aligned: turn ring and lift cone
  const handles = useRef({})
  const drag = useRef(null)
  const lastReadout = useRef(0)

  // The step to snap to, in millimetres, or 0 for none.
  const snapRef = useRef(SNAP_DEFAULT)
  snapRef.current = snapEnabled && !freeMove ? snapStep : 0

  const multi = selectedIds.length > 1

  // The shape of the one block picked, if it is one block. Which handles are
  // worth drawing depends on what its shape can tell apart.
  const soleType = useScene((s) =>
    s.selectedIds.length === 1
      ? (s.objects.find((o) => o.id === s.selectedIds[0])?.type ?? null)
      : null
  )

  /**
   * Only the handles that do different things.
   *
   * A handle can only pull what the shape can say, and a round shape says
   * very little: every axis of a ball is its radius, so all nine handles
   * scale it uniformly and eight of them are a promise of control that isn't
   * there. A tube is between the two — its width and depth are one number, so
   * the sides repeat the corners, but its height is its own.
   *
   * The corners always stay: they give a growth direction on each side of the
   * footprint, which is real even when the size they set is the same. A side
   * or the top is drawn only when it reaches something the corners can't. So
   * a cube keeps all nine, a tube keeps four corners and the top, and a ball
   * keeps four corners.
   */
  const scaleHandles = useMemo(() => {
    const all = [...CORNER_HANDLES, ...SIDE_HANDLES, HEIGHT_HANDLE]
    if (!soleType) return all // several blocks: no one shape to reason about
    const reach = (h) => coupledMask(soleType, h.mask).join('')
    const corners = reach(CORNER_HANDLES[0])
    return all.filter((h) => CORNER_HANDLES.includes(h) || reach(h) !== corners)
  }, [soleType])

  /* ------------------------------------------------------------- input -- */

  const rayAt = useCallback(
    (event) => {
      const rect = gl.domElement.getBoundingClientRect()
      ndc.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1
      )
      raycaster.setFromCamera(ndc, camera)
      return raycaster.ray
    },
    [camera, gl, ndc, raycaster]
  )

  /** Push a transform straight onto the live mesh — no React in the loop. */
  const paint = (id, position, rotation, scale) => {
    const mesh = meshes.get(id)
    if (!mesh) return
    mesh.position.set(position.x, position.y, position.z)
    if (rotation) mesh.rotation.set(rotation.x, rotation.y, rotation.z)
    if (scale) mesh.scale.set(scale.x, scale.y, scale.z)
  }

  const begin = (kind, extra, event) => {
    const selected = useScene.getState().selectedObjects()
    if (!selected.length) return
    if (controls) controls.enabled = false // stop OrbitControls stealing the gesture
    drag.current = {
      kind,
      ...extra,
      // A hole cuts what it overlaps, and the cut is worked out from the store
      // — which a drag deliberately doesn't write. With a hole anywhere in the
      // yard the drag stages itself a few times a second as well, so the cube
      // is seen to open up while the tube is still moving rather than only
      // once it lands.
      liveCut: useScene.getState().objects.some((o) => o.hole),
      items: selected.map((o) => ({
        id: o.id,
        position: new THREE.Vector3(...o.position),
        quaternion: new THREE.Quaternion().setFromEuler(new THREE.Euler(...o.rotation)),
        scale: new THREE.Vector3(...o.scale),
        before: { position: [...o.position], rotation: [...o.rotation], scale: [...o.scale] },
      })),
    }
    lastReadout.current = 0
    eased.current = {}
    beginDrag()
    event?.stopPropagation?.()
  }

  /* -------------------------------------------------------- drag starts -- */

  const startBodyMove = useCallback(
    (nativeEvent) => {
      // Read the centre straight from the store: the click may have *just*
      // changed the selection, so the drawn frame is a render behind.
      const selected = useScene.getState().selectedObjects()
      if (!selected.length) return
      const center = new THREE.Vector3()
      for (const o of selected) center.add(vec.set(...o.position))
      center.divideScalar(selected.length)

      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(UNIT_Y, center)
      const grab = new THREE.Vector3()
      if (!rayAt(nativeEvent).intersectPlane(plane, grab)) return
      begin('move-xz', { plane, grab }, null)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rayAt, controls]
  )

  useEffect(() => {
    dragBus.startBodyMove = startBodyMove
    return () => {
      dragBus.startBodyMove = null
    }
  }, [startBodyMove])

  const startLift = (event) => {
    const f = frame.current
    // A vertical plane facing the camera, so up/down tracks the pointer.
    camera.getWorldDirection(vec)
    vec.y = 0
    if (vec.lengthSq() < 1e-6) vec.set(0, 0, 1)
    vec.normalize()
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(vec, f.center)
    const grab = new THREE.Vector3()
    if (!event.ray.intersectPlane(plane, grab)) return
    // Where the lowest underside in the selection is now, and the lead's own
    // height, so a lift can be measured and seated by what is actually
    // closest to the plate rather than by whichever block happens to be first.
    const selected = useScene.getState().selectedObjects()
    const seat = selected.length
      ? Math.min(...selected.map((o) => o.position[1] + bottomOf(o)))
      : 0
    begin(
      'move-y',
      { plane, grab, handle: 'lift', seat, leadY: selected[0]?.position[1] ?? 0 },
      event
    )
  }

  const startScale = (def, event) => {
    const f = frame.current
    const local = (signs) =>
      new THREE.Vector3(signs[0] * f.half.x, signs[1] * f.half.y, signs[2] * f.half.z)

    // A handle may only pull what the shape can say. One block: widen the
    // mask to the axes its shape ties together, so a side pull on a tube
    // grows the radius — x and z at once, on screen, as it happens — and the
    // bake lands in the radius rather than in a stretch. Several blocks: the
    // frame is world-aligned and the shapes differ, so the mask stays as
    // drawn and each block bakes what it can.
    const selected = useScene.getState().selectedObjects()
    const mask = selected.length === 1 ? coupledMask(selected[0].type, def.mask) : def.mask

    const anchor = local(def.anchor).applyQuaternion(f.quat).add(f.center)
    const handleWorld = local(def.handle).applyQuaternion(f.quat).add(f.center)

    const dir = handleWorld.clone().sub(anchor)
    const length = dir.length()
    if (length < 1e-5) return
    dir.divideScalar(length)

    const grabT = distanceAlongLine(event.ray, anchor, dir)
    if (grabT === null) return

    // The box's full extent along each axis, so the drag can snap the size in
    // millimetres rather than the multiplier in quarters. `primary` is the
    // masked axis the snapping follows: the longest one, since that is the
    // dimension the handle most visibly controls, and for a corner the other
    // axis rides along with it to keep the footprint's shape.
    const extent = [f.half.x * 2, f.half.y * 2, f.half.z * 2]
    let primary = -1
    for (let i = 0; i < 3; i++) {
      if (mask[i] && extent[i] > 1e-6 && (primary < 0 || extent[i] > extent[primary])) primary = i
    }

    begin(
      'scale',
      { anchor, dir, length, grabT, extent, primary, mask, quat: f.quat.clone(), handle: def.key },
      event
    )
  }

  const startTurn = (def, event) => {
    const f = frame.current
    const axis = new THREE.Vector3(...def.axis).applyQuaternion(f.quat).normalize()
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(axis, f.center)
    const hit = new THREE.Vector3()
    if (!event.ray.intersectPlane(plane, hit)) return

    // Stand the dial up in the plane of rotation and leave it there. It is
    // deliberately world-fixed, not parented to the box: the lever has to be
    // seen travelling around it, and a dial that turned with the block would
    // sit still relative to the lever and show nothing at all.
    const dial = handles.current.dial
    const k = camera.position.distanceTo(f.center) * HANDLE_SCREEN
    const radius = (def.along === 'z' ? f.half.z : f.half.x) + k * 4
    if (dial) {
      dial.quaternion.setFromUnitVectors(UNIT_Z, axis)
      for (const child of dial.children) child.material.color.set(def.color)
    }

    const u = perpendicularTo(axis)
    const v = new THREE.Vector3().crossVectors(axis, u)
    begin(
      'rotate',
      {
        axis,
        plane,
        u,
        v,
        center: f.center.clone(),
        startAngle: angleInPlane(hit, f.center, u, v),
        dialRadius: radius,
        handle: def.key,
        slot: def.slot,
        angleStep: THREE.MathUtils.degToRad(angleStepFor(useScene.getState().snapStep)),
      },
      event
    )
  }

  /* ---------------------------------------------------------- drag move -- */

  useEffect(() => {
    const onMove = (event) => {
      const d = drag.current
      if (!d) return
      const ray = rayAt(event)
      const snap = snapRef.current

      if (d.kind === 'move-xz' || d.kind === 'move-y') {
        if (!ray.intersectPlane(d.plane, vec)) return
        const delta = vec2.copy(vec).sub(d.grab)
        if (d.kind === 'move-xz') delta.y = 0
        else delta.x = delta.z = 0
        if (snap) {
          // Snap where the block *lands*, not how far it moved: snapping the
          // distance keeps a block that is off the grid off it for good,
          // which mattered little while everything started on the same 5 mm
          // and matters a lot now the grid can be changed under it. The
          // first block sets the destination and the rest ride along
          // unchanged, so a selection stays rigid. Across the floor it is
          // the centre that lands on the grid, the way blocks are placed;
          // vertically it is the underside, the way the rail reports Z.
          const lead = d.items[0]
          if (d.kind === 'move-xz') {
            delta.set(
              snapTo(lead.position.x + delta.x, snap) - lead.position.x,
              0,
              snapTo(lead.position.z + delta.z, snap) - lead.position.z
            )
          } else {
            delta.set(0, snapTo(d.seat + delta.y, snap) - d.seat, 0)
          }

          // And within a few millimetres of the plate, the plate wins: the
          // block sits flat on it rather than near it. Suspended along with
          // everything else while Alt is held or snapping is off, so there is
          // still a way to hold something a hair above the floor by hand.
          if (d.kind === 'move-y' && Math.abs(d.seat + delta.y) <= FLOOR_GRAB) {
            delta.set(0, -d.seat, 0)
          }
        }
        for (const item of d.items) paint(item.id, vec.copy(item.position).add(delta), null, null)
      } else if (d.kind === 'scale') {
        const t = distanceAlongLine(ray, d.anchor, d.dir)
        if (t === null) return
        // How far the pointer has *travelled* along the handle's line, not
        // where it is aiming. `grabT` is where the press landed, which is
        // never the handle's exact centre — the handle is a ball a dozen-odd
        // pixels across — so mapping the aim straight onto the size jumped
        // the block a whole snap step before the drag had begun, and the
        // block ended up bigger than it was ever dragged to.
        let ratio = Math.max(0.02, (d.length + (t - d.grabT)) / d.length)
        if (!Number.isFinite(ratio)) return

        // Snap the size, not the multiplier. The switch names a grid in
        // millimetres and has to mean it: stepping the multiplier by a quarter moved a 40 mm
        // block in 10 mm jumps and a 42 mm one in 10.5 mm jumps, always
        // landing somewhere past the size that was wanted. Snapping the
        // dimension the handle is pulling puts it on the same millimetre grid
        // as everything else. Only for a single block — a multi-selection has
        // no one dimension to snap.
        if (snap && d.items.length === 1 && d.primary >= 0) {
          const from = d.extent[d.primary]
          ratio = Math.max(snap, snapTo(from * ratio, snap)) / from
        }

        for (const item of d.items) {
          const scale = new THREE.Vector3(
            THREE.MathUtils.clamp(item.scale.x * (d.mask[0] ? ratio : 1), MIN_SCALE, MAX_SCALE),
            THREE.MathUtils.clamp(item.scale.y * (d.mask[1] ? ratio : 1), MIN_SCALE, MAX_SCALE),
            THREE.MathUtils.clamp(item.scale.z * (d.mask[2] ? ratio : 1), MIN_SCALE, MAX_SCALE)
          )
          // Re-derive the ratio from the clamped scale so the anchor corner
          // stays exactly where it was.
          const applied = vec.set(
            item.scale.x ? scale.x / item.scale.x : 1,
            item.scale.y ? scale.y / item.scale.y : 1,
            item.scale.z ? scale.z / item.scale.z : 1
          )
          const offset = new THREE.Vector3()
            .copy(item.position)
            .sub(d.anchor)
            .applyQuaternion(quat.copy(d.quat).invert())
            .multiply(applied)
            .applyQuaternion(d.quat)
          paint(item.id, offset.add(d.anchor), null, scale)
        }
      } else if (d.kind === 'rotate') {
        if (!ray.intersectPlane(d.plane, vec)) return
        let delta = angleInPlane(vec, d.center, d.u, d.v) - d.startAngle
        if (snap) delta = snapTo(delta, d.angleStep)
        const dq = quat.setFromAxisAngle(d.axis, delta)
        for (const item of d.items) {
          const position = vec2.copy(item.position).sub(d.center).applyQuaternion(dq).add(d.center)
          euler.setFromQuaternion(new THREE.Quaternion().copy(dq).multiply(item.quaternion))
          paint(item.id, position, euler, null)
        }
      }

      const now = performance.now()
      if (now - lastReadout.current > READOUT_MS) {
        lastReadout.current = now
        const mesh = meshes.get(d.items[0].id)
        if (mesh) {
          setLive({
            position: mesh.position.toArray(),
            rotation: [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z],
            scale: mesh.scale.toArray(),
          })
        }
        if (d.liveCut) stageTransform(d.items.map((item) => staged(item.id)).filter(Boolean))
      }
    }

    /** The transform a mesh is showing right now, in the store's own terms. */
    const staged = (id) => {
      const mesh = meshes.get(id)
      if (!mesh) return null
      return {
        id,
        position: mesh.position.toArray(),
        rotation: [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z],
        scale: mesh.scale.toArray(),
      }
    }

    const onUp = () => {
      const d = drag.current
      if (!d) return
      drag.current = null
      if (controls) controls.enabled = true
      endDrag()

      const patches = []
      const before = {}
      for (const item of d.items) {
        const patch = staged(item.id)
        if (!patch) continue
        before[item.id] = item.before
        patches.push(patch)
      }
      if (patches.length) {
        stageTransform(patches)
        const blocked = commitTransform(
          before,
          d.kind === 'rotate' ? 'turn' : d.kind === 'scale' ? 'resize' : 'move'
        )
        // A resize is written into the shape's own numbers, and a number that
        // follows a variable isn't the block's to change — say so, rather than
        // let the drag quietly spring back.
        if (blocked?.length) {
          toast(`${blocked.join(' and ')} follows a variable — change it in Variables`, 'warn')
        }
      }
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [rayAt, controls, stageTransform, commitTransform])

  /* --------------------------------------------------------- per frame -- */

  // Recompute the box from the live meshes every frame so it tracks a drag,
  // and keep the handles a constant size on screen.
  useFrame((_, delta) => {
    if (!boxGroup.current || !selectedIds.length) return
    const f = frameFromMeshes(selectedIds, meshes, frame.current)
    if (!f) return

    boxGroup.current.position.copy(f.center)
    boxGroup.current.quaternion.copy(f.quat)
    if (flatGroup.current) flatGroup.current.position.copy(f.center)

    const k = camera.position.distanceTo(f.center) * HANDLE_SCREEN

    // How far the box actually reaches above its centre in world terms — the
    // y half-extent of its world-aligned bounds. The bounding-sphere radius
    // would also clear it, but leaves the lift handle floating miles over
    // anything wide and flat.
    mat.makeRotationFromQuaternion(f.quat)
    const me = mat.elements
    const topY =
      Math.abs(me[1]) * f.half.x + Math.abs(me[5]) * f.half.y + Math.abs(me[9]) * f.half.z

    const shell = handles.current.shell
    if (shell) shell.scale.set(f.half.x * 2, f.half.y * 2, f.half.z * 2)

    // The turning dial, only while a lever is actually being swung.
    const dial = handles.current.dial
    if (dial) {
      const d = drag.current
      const turning = d?.kind === 'rotate'
      dial.visible = turning
      if (turning) dial.scale.setScalar(d.dialRadius)
    }

    // While a handle is being dragged it lights up and grows, and every other
    // handle fades back, so there is never a question of which one has the
    // pointer — nine resize handles and three levers sit close together, and
    // the one you meant to grab is not always the one you got.
    const active = drag.current?.handle ?? null
    const dragging = Boolean(drag.current)
    const quiet = (on) => (on ? 1 : dragging ? 0.22 : null) // null: leave the resting opacity

    for (const [key, node] of Object.entries(handles.current)) {
      if (!node || key === 'shell') continue
      const { sign, lift, turn } = node.userData
      const on = key === active
      if (sign) {
        node.position.set(sign[0] * f.half.x, sign[1] * f.half.y, sign[2] * f.half.z)
        node.scale.setScalar(k * (on ? 1.45 : 1))
        node.material.color.set(on ? '#7C4DFF' : '#EDEFF4')
        node.material.opacity = quiet(on) ?? 0.72
      } else if (lift) {
        node.position.set(0, topY + k * 2.2, 0)
        node.scale.setScalar(k * (on ? 1.35 : 1))
        node.material.color.set(on ? '#C8B6FF' : '#7C4DFF')
        node.material.opacity = quiet(on) ?? 0.9
      } else if (turn) {
        // Stick starts at the box surface; ball sits a little beyond it.
        const start = node.userData.along === 'z' ? f.half.z : f.half.x
        const end = start + k * 4
        const [stick, ball, target] = node.children
        stick.scale.set(k * (on ? 0.12 : 0.085), end - start, k * (on ? 0.12 : 0.085))
        stick.position.y = (start + end) / 2
        ball.scale.setScalar(k * (on ? 1.15 : 0.85))
        ball.position.y = end
        target.scale.setScalar(k * 2.4)
        target.position.y = end
        // The lever keeps its axis colour and goes white-hot at the ball when
        // it is the one turning; its colour is what says which axis, so it
        // must not change to say "active".
        ball.material.color.set(on ? '#FFFFFF' : node.userData.color)
        ball.material.opacity = quiet(on) ?? 0.85
        stick.material.opacity = on ? 1 : dragging ? 0.15 : 0.55
      }
    }

    /* ------------------------------------------------ the live readout -- */

    const divs = tagDivs.current
    if (divs.dim0 || divs.note) {
      /** The shown value, easing toward the real one. */
      const smooth = (key, target) => {
        const store = eased.current
        const from = store[key]
        if (!Number.isFinite(from)) {
          store[key] = target
          return target
        }
        // Time-based, so the ease feels the same on a slow frame as a fast one.
        const next = from + (target - from) * (1 - Math.exp(-delta / EASE_SECONDS))
        store[key] = Math.abs(target - next) < EASE_SETTLED ? target : next
        return store[key]
      }

      if (divs.note) divs.note.style.display = 'none'
      const d = drag.current

      /**
       * Beside whichever of the four edges along `slot` faces the camera.
       *
       * Held rather than recomputed outright: the label keeps the edge it is
       * on until another is clearly nearer, and doesn't reconsider at all
       * while a drag is in flight. Picking the nearest every frame made the
       * label hop from one edge of the box to another as the camera crossed
       * the halfway point or the box grew past it — a far bigger jump than
       * any number it was showing.
       */
      const beside = (slot, out) => {
        const chosen = edgeChoice.current
        if (!d || chosen[slot] === undefined) {
          const away = EDGES_ALONG[slot].map((sign) =>
            camera.position.distanceTo(
              tagPoint
                .set(sign[0] * f.half.x, sign[1] * f.half.y, sign[2] * f.half.z)
                .applyQuaternion(f.quat)
                .add(f.center)
            )
          )
          let best = 0
          for (let i = 1; i < away.length; i++) if (away[i] < away[best]) best = i
          const held = chosen[slot]
          if (held === undefined || away[best] < away[held] * 0.9) chosen[slot] = best
        }
        const sign = EDGES_ALONG[slot][chosen[slot] ?? 0]
        out
          .set(sign[0] * f.half.x, sign[1] * f.half.y, sign[2] * f.half.z)
          .applyQuaternion(f.quat)
          .add(f.center)
        // Clear of the edge, straight out from the box.
        tagOut.set(sign[0], sign[1], sign[2]).applyQuaternion(f.quat).normalize()
        return out.addScaledVector(tagOut, k * 2)
      }

      const note = (text) => {
        if (!divs.note) return
        divs.note.textContent = text
        divs.note.style.display = ''
        const g = tagGroups.current.note
        if (g) {
          g.position.set(f.center.x, smooth('noteY', f.center.y + topY + k * 3.4), f.center.z)
        }
      }

      /*
       * How big the block is, always, along every axis — small and in the
       * colour of the box it labels, so it is there to glance at rather than
       * something to go and find. Read off the box itself, so it is what the
       * block measures rather than what it was asked for.
       *
       * An axis a resize is currently pulling steps forward: it takes that
       * axis's own colour, the one the rail and the turn levers use, and a
       * heavier chip. The rest stay as they were.
       */
      const size = [f.half.x * 2, f.half.y * 2, f.half.z * 2]
      liveSize.current = size
      const scaling = d?.kind === 'scale'
      for (let i = 0; i < 3; i++) {
        const g = tagGroups.current[`dim${i}`]
        if (g) g.position.copy(beside(i, tagPoint))

        const div = divs[`dim${i}`]
        if (!div) continue // being typed into: React owns it this frame
        const axis = axisOf(i)
        const lit = scaling && d.mask[i]
        const [valueEl, varEl] = div.children
        const text = `${axis.label} ${fixed1(smooth(`dim${i}`, size[i]))} mm`
        // Only touch the DOM when something actually changed; these run every
        // frame for as long as anything is selected.
        if (valueEl && valueEl.textContent !== text) valueEl.textContent = text
        if (varEl && varEl.textContent !== boundNames[i]) varEl.textContent = boundNames[i]
        const className = `live-dim${lit ? ' on' : ''}${boundNames[i] ? ' bound' : ''}`
        if (div.className !== className) div.className = className
        const color = lit ? axis.color : ''
        if (div.style.color !== color) div.style.color = color
      }

      if (d?.kind === 'rotate') {
        const mesh = meshes.get(d.items[0].id)
        const axis = axisOf(d.slot)
        if (mesh && axis) {
          const turned = THREE.MathUtils.radToDeg(mesh.rotation.toArray()[d.slot]) * axis.sign
          note(`${axis.label} ${fixed1(smooth('turn', turned))}°`)
          if (divs.note) divs.note.style.color = axis.color
        }
      } else if (d?.kind === 'move-xz' || d?.kind === 'move-y') {
        const mesh = meshes.get(d.items[0].id)
        if (mesh) {
          if (divs.note) divs.note.style.color = ''
          // The rail's names and the rail's idea of height: X across, Y away
          // from you, and Z the underside's height off the plate.
          note(
            d.kind === 'move-y'
              ? (() => {
                  const up = (d.seat ?? 0) + (mesh.position.y - (d.leadY ?? mesh.position.y))
                  const shown = smooth('z', up)
                  return `Z ${fixed1(shown)} mm${Math.abs(up) < 1e-6 ? ' · on the plate' : ''}`
                })()
              : `X ${fixed1(smooth('x', mesh.position.x))} · Y ${fixed1(smooth('y', -mesh.position.z))} mm`
          )
        }
      }
    }

    /*
     * Take away the handles the block is standing in front of.
     *
     * Handles draw with depth testing off, so they sit cleanly on top of
     * everything instead of being half-buried in the block they belong to.
     * The cost is that the ones on the far side show through as well — and
     * those cannot be used: the block's own surface is nearer along that ray,
     * so pressing one grabs the block and slides it across the floor. A
     * control that does something else when you press it is worse than no
     * control, so the ones out of reach go away and the box stops promising
     * more than it has.
     *
     * The test is a ray from the camera to the handle, run against the blocks
     * themselves rather than against the selection's box: a ball leaves its
     * box's corners out in the open, and those corners really are reachable.
     * Against every visible block, not just the selected ones, because a
     * block parked in front is just as much in the way. Frozen while a drag
     * is in flight, so the handle in your hand can never vanish underneath
     * it, and throttled the rest of the time.
     */
    const now = performance.now()
    if (!dragging && now - occludeAt.current > OCCLUDE_MS) {
      occludeAt.current = now
      const blocks = []
      for (const mesh of meshes.values()) if (mesh.visible) blocks.push(mesh)

      for (const [key, node] of Object.entries(handles.current)) {
        if (!node || key === 'shell' || key === 'dial') continue
        // A lever is grabbed by the ball on its end, not by the stick.
        const grabbable = node.userData.turn ? node.children[1] : node
        grabbable.getWorldPosition(reachPoint)
        reachDir.subVectors(reachPoint, camera.position)
        const reach = reachDir.length()
        if (reach < 1e-6) continue

        reachRay.set(camera.position, reachDir.divideScalar(reach))
        // Stop short of the handle itself by half its own size, so a ray that
        // merely grazes the corner it sits on doesn't count as blocked.
        reachRay.far = reach - k * 0.5
        node.visible = reachRay.far <= 0 || reachRay.intersectObjects(blocks, false).length === 0
      }
    }
  })

  if (!selectedIds.length) return null

  const bind = (key, extra) => (node) => {
    if (node) {
      Object.assign(node.userData, extra)
      handles.current[key] = node
    } else delete handles.current[key]
  }

  return (
    <>
      {/* turns with the block */}
      <group ref={boxGroup}>
        <lineSegments ref={bind('shell', {})} raycast={() => null}>
          <edgesGeometry args={[new THREE.BoxGeometry(1, 1, 1)]} />
          <lineBasicMaterial color="#7C4DFF" transparent opacity={0.62} depthTest={false} />
        </lineSegments>

        {scaleHandles.map((def) => (
          <mesh
            key={def.key}
            ref={bind(def.key, { sign: def.handle })}
            renderOrder={3}
            onPointerDown={(e) => startScale(def, e)}
          >
            <boxGeometry args={[1, 1, 1]} />
            <meshBasicMaterial
              color="#EDEFF4"
              transparent
              opacity={0.72}
              depthTest={false}
              toneMapped={false}
            />
          </mesh>
        ))}

        {/* turn levers: swing the ball, the block turns about that axis */}
        {TURN_HANDLES.map((def) => (
          <group
            key={def.key}
            ref={bind(def.key, { turn: def.key, along: def.along, color: def.color })}
            rotation={def.rotation}
            onPointerDown={(e) => startTurn(def, e)}
          >
            <mesh renderOrder={2}>
              <cylinderGeometry args={[1, 1, 1, 6]} />
              <meshBasicMaterial
                color={def.color}
                transparent
                opacity={0.55}
                depthTest={false}
                toneMapped={false}
              />
            </mesh>
            <mesh renderOrder={4}>
              <sphereGeometry args={[1, 18, 14]} />
              <meshBasicMaterial
                color={def.color}
                transparent
                opacity={0.85}
                depthTest={false}
                toneMapped={false}
              />
            </mesh>
            {/* generous invisible target, so it's grabbable on a tablet */}
            <mesh>
              <sphereGeometry args={[1, 8, 6]} />
              <meshBasicMaterial visible={false} />
            </mesh>
          </group>
        ))}
      </group>

      {/* The live readout, on the thing being changed rather than off in the
          rail: while a drag is in flight the numbers are where the eyes
          already are. Mounted on drag start and written to by hand each
          frame — see the useFrame above. */}
      {[0, 1, 2].map((slot) => (
        <group
          key={slot}
          ref={(g) => {
            tagGroups.current[`dim${slot}`] = g
          }}
        >
          <Html zIndexRange={[25, 15]} style={{ pointerEvents: 'none' }}>
            {editing === slot ? (
              <input
                className="live-dim-input"
                defaultValue={fixed1(liveSize.current[slot])}
                autoFocus
                onFocus={(e) => e.target.select()}
                onBlur={(e) => applyDim(slot, e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation()
                  if (e.key === 'Enter') applyDim(slot, e.currentTarget.value)
                  if (e.key === 'Escape') setEditing(null)
                }}
              />
            ) : (
              <div
                className="live-dim"
                ref={(el) => {
                  tagDivs.current[`dim${slot}`] = el
                }}
                title={
                  boundNames[slot]
                    ? `Follows "${boundNames[slot]}" — open it in Variables`
                    : multi
                      ? 'Pick a single block to type a size in'
                      : 'Click to type a size'
                }
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => {
                  if (multi) return
                  // A side driven by a variable can't be typed into here, so
                  // the click goes where the number actually lives.
                  if (bound[slot].id) {
                    useUI.getState().revealVariable(bound[slot].id)
                    return
                  }
                  setEditing(slot)
                }}
              >
                <span />
                <span className="live-var" />
              </div>
            )}
          </Html>
        </group>
      ))}

      {dragging && (
        <group
          ref={(g) => {
            tagGroups.current.note = g
          }}
        >
          <Html zIndexRange={[25, 15]} style={{ pointerEvents: 'none' }}>
            <div
              className="live-note"
              ref={(el) => {
                tagDivs.current.note = el
              }}
              style={{ display: 'none' }}
            />
          </Html>
        </group>
      )}

      {/* world-aligned: lifting is always along world up, and the turning
          dial has to hold still while the lever swings around it */}
      <group ref={flatGroup}>
        <group ref={bind('dial', {})} visible={false}>
          <lineSegments geometry={dialGeometry} renderOrder={2} raycast={() => null}>
            <lineBasicMaterial transparent opacity={0.9} depthTest={false} toneMapped={false} />
          </lineSegments>
        </group>

        <mesh ref={bind('lift', { lift: true })} renderOrder={3} onPointerDown={startLift}>
          <coneGeometry args={[0.72, 1.5, 16]} />
          <meshBasicMaterial
            color="#7C4DFF"
            transparent
            opacity={0.75}
            depthTest={false}
            toneMapped={false}
          />
        </mesh>

      </group>
    </>
  )
}
