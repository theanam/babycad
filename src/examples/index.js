/**
 * The builds the welcome screen offers instead of an empty plate.
 *
 * An example is plain data — a list of parts and, where it earns one, a
 * variable or two — and `buildExample` turns it into a scene the app can load
 * like any other. Writing them as data rather than as a saved `.babycad` file
 * means they can't drift out of date: every part goes through the same
 * `makeObject`, the same parameter validation and the same migration as a real
 * build, so an example that would be broken by a change to a shape breaks the
 * build rather than quietly loading wrong.
 *
 * `feature: true` marks one of the three that exist to show the app off. The
 * rest are objects somebody might actually want, and the welcome screen lays
 * the two sets out differently: the three get room to explain themselves, the
 * rest get a shelf to be browsed along.
 *
 * A part with `hole: true` is a hole: it cuts the solids it overlaps instead of
 * being one. That is what lets an example have a cavity, a bore or a pip.
 * `combine: true` then groups every solid with the holes that cut it, which is
 * exactly what pressing Combine on that selection does: the hole stops being
 * drawn as a ghost, and — the part that matters — it travels with the solid it
 * belongs to instead of staying where it was when the solid moves away.
 * Examples of a *thing* want it; one teaching what a hole is might not.
 *
 * Positions are in the scene's own y-up millimetres (the properties rail calls
 * that axis Z — see scene/axes). A part gives where it stands on the floor as
 * `at: [x, z]` and how far its underside is off the floor as `lift`, and the
 * height is worked out from the geometry, so a part that sits on another
 * doesn't need a number that has to be recomputed by hand every time a shape
 * changes. Anything turned on its side gives `y` outright, since a rotated
 * shape's resting height isn't its own.
 */
import { SCENE_VERSION } from '../constants'
import { makeObject } from '../scene/sceneStore'
import { migrate } from '../io/persistence'
import { defaultParams, normalizeParams } from '../shapes'
import { restingHeight } from '../shapes/geometryCache'
import { cuttersByObject } from '../shapes/csg'

const TURN = Math.PI * 2

/** Three fins evenly around a body of this radius, tall edge against it. */
const finsAround = (radius, fin) =>
  [0, 1, 2].map((i) => {
    const angle = (TURN * i) / 3
    const out = radius + fin.params.depth / 2
    return {
      ...fin,
      at: [out * Math.sin(angle), out * Math.cos(angle)],
      rot: [0, angle, 0],
    }
  })

/**
 * The wall hook's peg: where it starts, how far it reaches and how steeply.
 *
 * A cylinder is built along +y, and a turn of `a` about x swings that axis to
 * (0, cos a, sin a). So a peg raked `RAKE` above horizontal needs a turn of
 * 90 degrees minus that, and its centre and tip follow from the base point by
 * walking along the axis. Worked out rather than eyeballed: a peg whose ball
 * is a few millimetres off the end reads as a mistake from any angle.
 */
const HOOK_RAKE = Math.PI / 7.2 // 25 degrees above horizontal
const HOOK_TILT = Math.PI / 2 - HOOK_RAKE
const HOOK_AXIS = [0, Math.sin(HOOK_RAKE), Math.cos(HOOK_RAKE)]

/**
 * The peg starts inside the plate, not against it.
 *
 * A raked peg's end is a disc lying at 25 degrees to the plate's face. Started
 * on that face, half the disc is in the material and half is hanging in the
 * air, which is not a joint — the peg reads as stuck on rather than part of
 * the thing, and printed it would snap off at the first coat. Starting it on
 * the plate's middle buries the whole disc: the disc spans ±2.11 mm in z, the
 * plate runs from −12 to −8, so a centre at −10 leaves the nearest edge a
 * hair inside the front face and the furthest a hair inside the back.
 */
const HOOK_FACE = [0, 16, -8] // where it comes out of the plate's front
const HOOK_PLATE_MID = -10
const HOOK_EMBED = (HOOK_FACE[2] - HOOK_PLATE_MID) / HOOK_AXIS[2]
const HOOK_REACH = 34 // how far it stands out, which is what matters to a coat
const HOOK_LEN = HOOK_REACH + HOOK_EMBED
const HOOK_START = HOOK_FACE.map((v, i) => v - HOOK_AXIS[i] * HOOK_EMBED)
const alongHook = (d) => HOOK_START.map((v, i) => v + HOOK_AXIS[i] * d)
const HOOK_MID = alongHook(HOOK_LEN / 2)
const HOOK_TIP = alongHook(HOOK_LEN)

/** How far a pip's ball sits outside the face it dimples. See diePips. */
const PIP_OUT = 0

/** Where the pips sit on a face, in units of the pip spacing. */
const PIP_FACES = {
  1: [[0, 0]],
  2: [[-1, -1], [1, 1]],
  3: [[-1, -1], [0, 0], [1, 1]],
  4: [[-1, -1], [-1, 1], [1, -1], [1, 1]],
  5: [[-1, -1], [-1, 1], [0, 0], [1, -1], [1, 1]],
  6: [[-1, -1], [-1, 0], [-1, 1], [1, -1], [1, 0], [1, 1]],
}

/**
 * All twenty-one pips of a die, on all six faces.
 *
 * Opposite faces add to seven — 1 against 6, 2 against 5, 3 against 4 — which
 * is what makes it a die rather than a cube with some dots on the side you
 * happen to be looking at. Written out rather than typed out because
 * twenty-one near-identical parts is exactly what a loop is for.
 *
 * Each pip is a ball centred *on* the face, so half of it is inside and the
 * cut it leaves is a round dimple rather than a bore.
 */
const diePips = (size, spacing, radius, out) => {
  const h = size / 2
  const o = h + out
  // [pip count, where (u, v) on that face lands in the scene's own y-up]
  const faces = [
    [1, (u, v) => [u, size + out, v]],
    [6, (u, v) => [u, -out, v]],
    [2, (u, v) => [u, h + v, o]],
    [5, (u, v) => [u, h + v, -o]],
    [3, (u, v) => [o, h + v, u]],
    [4, (u, v) => [-o, h + v, u]],
  ]
  return faces.flatMap(([count, place]) =>
    PIP_FACES[count].map(([a, b]) => {
      const [x, y, z] = place(a * spacing, b * spacing)
      return {
        type: 'sphere',
        color: '#3A414F',
        params: { radius, sides: 24, rings: 16 },
        at: [x, z],
        y,
        hole: true,
      }
    })
  )
}

export const EXAMPLES = [
  {
    id: 'rocket',
    feature: true,
    name: 'Rocket',
    blurb: 'One number drives the whole body. Open Variables and drag it.',
    teaches: 'variables',
    variables: [{ ref: 'body', name: 'bodyRadius', kind: 'number', value: 11 }],
    parts: [
      {
        type: 'cylinder',
        color: '#EDEFF4',
        params: { bottomRadius: 11, topRadius: 11, height: 54, sides: 48 },
        bind: { bottomRadius: 'body', topRadius: 'body' },
      },
      {
        type: 'cone',
        color: '#FF5A47',
        params: { radius: 11, height: 24, sides: 48 },
        bind: { radius: 'body' },
        lift: 54,
      },
      // Two bands round the body. A donut lies flat, so it hugs a standing
      // tube at whatever radius the variable is currently saying.
      {
        type: 'torus',
        color: '#FF8A3D',
        params: { radius: 11, tube: 1.6, segments: 48, sides: 12 },
        bind: { radius: 'body' },
        lift: 12,
      },
      {
        type: 'torus',
        color: '#FF8A3D',
        params: { radius: 11, tube: 1.6, segments: 48, sides: 12 },
        bind: { radius: 'body' },
        lift: 44,
      },
      ...finsAround(11, {
        type: 'wedge',
        color: '#FF5A47',
        params: { width: 4, height: 16, depth: 13 },
      }),
    ],
  },

  {
    id: 'gear-train',
    feature: true,
    name: 'Gear train',
    blurb: 'A 24 and a 16 tooth gear, meshing for real — the teeth are involutes.',
    teaches: 'the generator shapes',
    variables: [{ ref: 'thick', name: 'gearThickness', kind: 'number', value: 8 }],
    parts: [
      { type: 'cube', color: '#3A414F', params: { width: 112, height: 6, depth: 76 } },

      // Centres 32 mm apart, which is the sum of the two pitch radii
      // (1.6 × 24 / 2 and 1.6 × 16 / 2) — that is what makes them mesh.
      {
        type: 'gear',
        color: '#A9744F',
        params: { teeth: 24, module: 1.6, thickness: 8, pressureAngle: 20, bore: 6 },
        bind: { thickness: 'thick' },
        at: [-16, 0],
        lift: 6,
      },
      {
        type: 'gear',
        color: '#FFC93D',
        params: { teeth: 16, module: 1.6, thickness: 8, pressureAngle: 20, bore: 6 },
        bind: { thickness: 'thick' },
        at: [16, 0],
        lift: 6,
      },

      {
        type: 'cylinder',
        color: '#EDEFF4',
        params: { bottomRadius: 3, topRadius: 3, height: 30, sides: 24 },
        at: [-16, 0],
        lift: 2,
      },
      {
        type: 'cylinder',
        color: '#EDEFF4',
        params: { bottomRadius: 3, topRadius: 3, height: 30, sides: 24 },
        at: [16, 0],
        lift: 2,
      },
      {
        type: 'spring',
        color: '#8A93A5',
        params: { radius: 5, wire: 1.2, turns: 6, height: 12, sides: 10 },
        at: [16, 0],
        lift: 14,
      },

      // Four bolts, one per corner of the plate. Lifted half a millimetre so
      // their ends sit just inside the slab rather than exactly on its
      // underside, where two faces in the same plane flicker against each
      // other when the build is looked at from below.
      ...[
        [-46, -28],
        [46, -28],
        [-46, 28],
        [46, 28],
      ].map((at) => ({
        type: 'thread',
        color: '#EDEFF4',
        params: { diameter: 8, pitch: 2, length: 18, angle: 60, starts: 1, sides: 32 },
        at,
        lift: 0.5,
      })),
    ],
  },

  {
    id: 'robot',
    feature: true,
    name: 'Robot',
    blurb: 'Fifteen plain blocks. Nothing clever — a good one to take apart.',
    teaches: 'stacking and colour',
    parts: [
      { type: 'cube', color: '#FF8A3D', params: { width: 13, height: 4, depth: 16 }, at: [-8, 2] },
      { type: 'cube', color: '#FF8A3D', params: { width: 13, height: 4, depth: 16 }, at: [8, 2] },
      { type: 'cube', color: '#3A414F', params: { width: 9, height: 18, depth: 9 }, at: [-8, 0], lift: 4 },
      { type: 'cube', color: '#3A414F', params: { width: 9, height: 18, depth: 9 }, at: [8, 0], lift: 4 },

      { type: 'cube', color: '#2E7DF6', params: { width: 34, height: 30, depth: 20 }, lift: 22 },
      // Stood upright to face front: a donut is built lying flat.
      {
        type: 'torus',
        color: '#D6E24A',
        params: { radius: 5, tube: 1.6, segments: 32, sides: 12 },
        at: [0, 10],
        rot: [Math.PI / 2, 0, 0],
        y: 40,
      },

      { type: 'cube', color: '#FFC93D', params: { width: 22, height: 17, depth: 18 }, lift: 52 },
      { type: 'sphere', color: '#3A414F', params: { radius: 2.6 }, at: [-5.5, 8], lift: 59.4 },
      { type: 'sphere', color: '#3A414F', params: { radius: 2.6 }, at: [5.5, 8], lift: 59.4 },

      {
        type: 'cylinder',
        color: '#8A93A5',
        params: { bottomRadius: 0.9, topRadius: 0.9, height: 11, sides: 16 },
        lift: 69,
      },
      { type: 'sphere', color: '#FF5A47', params: { radius: 3 }, lift: 79 },

      // Arms laid on their side, so they carry their own height.
      {
        type: 'cylinder',
        color: '#EDEFF4',
        params: { bottomRadius: 3.2, topRadius: 3.2, height: 24, sides: 20 },
        at: [-29, 0],
        rot: [0, 0, Math.PI / 2],
        y: 40,
      },
      {
        type: 'cylinder',
        color: '#EDEFF4',
        params: { bottomRadius: 3.2, topRadius: 3.2, height: 24, sides: 20 },
        at: [29, 0],
        rot: [0, 0, Math.PI / 2],
        y: 40,
      },
      { type: 'sphere', color: '#FF5A47', params: { radius: 4.4 }, at: [-43, 0], y: 40 },
      { type: 'sphere', color: '#FF5A47', params: { radius: 4.4 }, at: [43, 0], y: 40 },
    ],
  },
  /* --------------------------------------------------------------------- *
   * Things worth printing.
   *
   * The three above show off what the app can do. These are here for the
   * other reason someone opens a CAD program: they want the object. Each is a
   * real thing that comes off a printer useful, built only out of shapes in
   * the tray, and sized in millimetres that suit the job rather than numbers
   * that suit the example.
   * --------------------------------------------------------------------- */

  {
    id: 'phone-stand',
    name: 'Phone stand',
    blurb: 'A ramp to lean on and a lip to stop it sliding. Fits any phone.',
    teaches: 'ramps',
    parts: [
      { type: 'cube', color: '#2E7DF6', params: { width: 84, height: 6, depth: 70, edge: 2 } },
      // The ramp is full height at its back edge and tapers to nothing at the
      // front, which is exactly the wedge a phone wants to lean against.
      { type: 'wedge', color: '#2E7DF6', params: { width: 84, height: 46, depth: 46 }, at: [0, -12], lift: 6 },
      { type: 'cube', color: '#FFC93D', params: { width: 84, height: 12, depth: 6, edge: 2 }, at: [0, 30], lift: 6 },
    ],
  },

  {
    id: 'pen-pot',
    name: 'Pen pot',
    blurb: 'A pipe is a tube with its middle already gone. Give it a floor and it holds things.',
    teaches: 'pipes',
    parts: [
      { type: 'cylinder', color: '#35C46B', params: { bottomRadius: 34, topRadius: 34, height: 3, sides: 64 } },
      { type: 'pipe', color: '#35C46B', params: { radius: 34, wall: 3, height: 89, sides: 64, edge: 1.2 }, lift: 3 },
    ],
  },

  {
    id: 'coaster',
    name: 'Coaster',
    blurb: 'A disc with a raised rim, so a wet glass stays where you put it.',
    teaches: 'round shapes',
    parts: [
      { type: 'cylinder', color: '#A9744F', params: { bottomRadius: 45, topRadius: 45, height: 3, sides: 64, edge: 1 } },
      { type: 'pipe', color: '#8A5B3C', params: { radius: 45, wall: 3, height: 5, sides: 64, edge: 1.2 }, lift: 3 },
    ],
  },

  {
    id: 'cable-clip',
    name: 'Cable clip',
    blurb: 'A pipe swept most of the way round grips a cable and still lets it back out.',
    teaches: 'partial sweeps',
    parts: [
      { type: 'cube', color: '#FF8A3D', params: { width: 24, height: 4, depth: 16, edge: 1 } },
      // A pipe is built standing, so the quarter turn about X is what lays its
      // axis along the cable. The turn about Y comes first (Euler 'XYZ' with no
      // Z applies Y innermost, about the pipe's own axis) and spins the gap to
      // the top, so the cable presses in from above. 50 degrees is where the
      // gap in a 280 degree sweep actually ends up pointing straight up —
      // measured off the built geometry rather than guessed at.
      {
        type: 'pipe',
        color: '#FF8A3D',
        params: { radius: 8, wall: 2.5, height: 14, sides: 48, sweep: 280 },
        rot: [Math.PI / 2, (50 * Math.PI) / 180, 0],
        // A millimetre into the base rather than balanced on it: two parts that
        // meet at a plane and share no material are one piece only by luck.
        y: 11,
      },
    ],
  },

  {
    id: 'key-tag',
    combine: true,
    name: 'Key tag',
    blurb: 'Your own word on it and a hole for the ring. Change the word in the rail.',
    teaches: 'text and holes',
    parts: [
      { type: 'cube', color: '#7C4DFF', params: { width: 46, height: 4, depth: 20, edge: 1.4 } },
      { type: 'cylinder', color: '#7C4DFF', params: { bottomRadius: 10, topRadius: 10, height: 4, sides: 48 }, at: [-23, 0] },
      // Taller than the tag on purpose: a hole has to come out the far side to
      // be a hole rather than a dent.
      {
        type: 'cylinder',
        color: '#8A93A5',
        params: { bottomRadius: 3, topRadius: 3, height: 14, sides: 32 },
        at: [-23, 0],
        y: 2,
        hole: true,
      },
      { type: 'text', color: '#EDEFF4', params: { text: 'KEYS', size: 9, thickness: 1.6 }, at: [6, 0], lift: 4 },
    ],
  },

  {
    id: 'name-plate',
    name: 'Name plate',
    blurb: 'A slab and a word. Type your own into Words and it rebuilds itself.',
    teaches: 'text',
    parts: [
      { type: 'cube', color: '#3A414F', params: { width: 110, height: 6, depth: 34, edge: 2 } },
      { type: 'text', color: '#FFC93D', params: { text: 'HELLO', size: 15, thickness: 3, edge: 0.6 }, lift: 6 },
    ],
  },

  {
    id: 'wall-hook',
    combine: true,
    name: 'Wall hook',
    blurb: 'A back plate with two screw holes, and a peg raked upward so nothing slides off.',
    teaches: 'turning parts',
    parts: [
      { type: 'cube', color: '#EDEFF4', params: { width: 30, height: 44, depth: 4, edge: 1.6 }, at: [0, -10] },
      // Lying along z, so they bore front to back through the plate.
      {
        type: 'cylinder',
        color: '#8A93A5',
        params: { bottomRadius: 2.5, topRadius: 2.5, height: 16, sides: 24 },
        at: [0, -10],
        y: 6,
        rot: [Math.PI / 2, 0, 0],
        hole: true,
      },
      {
        type: 'cylinder',
        color: '#8A93A5',
        params: { bottomRadius: 2.5, topRadius: 2.5, height: 16, sides: 24 },
        at: [0, -10],
        y: 38,
        rot: [Math.PI / 2, 0, 0],
        hole: true,
      },
      // HOOK_* below: the peg starts on the plate's front face and is raked
      // 25 degrees up. Its centre and its tip are worked out from that rake
      // rather than guessed, which is the only way the ball lands on the end
      // of the peg instead of somewhere near it.
      {
        type: 'cylinder',
        color: '#FF5A47',
        params: { bottomRadius: 5, topRadius: 4, height: HOOK_LEN, sides: 32 },
        at: [0, HOOK_MID[2]],
        y: HOOK_MID[1],
        rot: [HOOK_TILT, 0, 0],
      },
      {
        type: 'sphere',
        color: '#FF5A47',
        params: { radius: 4, sides: 32, rings: 24 },
        at: [0, HOOK_TIP[2]],
        y: HOOK_TIP[1],
      },
    ],
  },

  {
    id: 'desk-tray',
    combine: true,
    name: 'Desk tray',
    blurb: 'One block, and a second marked as a hole to scoop the inside out.',
    teaches: 'holes',
    parts: [
      { type: 'cube', color: '#2E7DF6', params: { width: 90, height: 26, depth: 60, edge: 3 } },
      // Open at the top: the hole runs past the rim rather than stopping level
      // with it, or the tray would come out as a sealed box.
      { type: 'cube', color: '#8A93A5', params: { width: 82, height: 30, depth: 52, edge: 3 }, lift: 4, hole: true },
    ],
  },

  {
    id: 'dice',
    combine: true,
    name: 'Dice',
    blurb: 'Twenty-one balls marked as holes. Opposite faces add up to seven.',
    teaches: 'holes',
    parts: [
      { type: 'cube', color: '#EDEFF4', params: { width: 24, height: 24, depth: 24, edge: 2.4 } },
      ...diePips(24, 5, 2.6, PIP_OUT),
    ],
  },

  {
    id: 'plant-pot',
    combine: true,
    name: 'Plant pot',
    blurb: 'A tube wider at the top than the bottom, hollowed out and drained.',
    teaches: 'taper',
    parts: [
      { type: 'cylinder', color: '#A9744F', params: { bottomRadius: 26, topRadius: 34, height: 56, sides: 64, edge: 2 } },
      // The cavity tapers with the outside, so the wall stays the same
      // thickness all the way up instead of thinning toward the rim.
      {
        type: 'cylinder',
        color: '#8A93A5',
        params: { bottomRadius: 22, topRadius: 31, height: 60, sides: 64 },
        lift: 5,
        hole: true,
      },
      {
        type: 'cylinder',
        color: '#8A93A5',
        params: { bottomRadius: 4, topRadius: 4, height: 20, sides: 24 },
        y: 4,
        hole: true,
      },
    ],
  },

  {
    id: 'tealight',
    combine: true,
    name: 'Tealight holder',
    blurb: 'Two holes laid crosswise cut four windows for the light to come through.',
    teaches: 'holes',
    parts: [
      { type: 'cylinder', color: '#FF8A3D', params: { bottomRadius: 24, topRadius: 24, height: 3, sides: 64, edge: 1 } },
      { type: 'pipe', color: '#FF8A3D', params: { radius: 24, wall: 3.5, height: 26, sides: 64, edge: 1.4 }, lift: 3 },
      // One bar front to back, one left to right: two parts, four windows,
      // because each bar leaves the wall twice.
      {
        type: 'cylinder',
        color: '#8A93A5',
        params: { bottomRadius: 6, topRadius: 6, height: 70, sides: 32 },
        y: 16,
        rot: [Math.PI / 2, 0, 0],
        hole: true,
      },
      {
        type: 'cylinder',
        color: '#8A93A5',
        params: { bottomRadius: 6, topRadius: 6, height: 70, sides: 32 },
        y: 16,
        rot: [0, 0, Math.PI / 2],
        hole: true,
      },
    ],
  },

  {
    id: 'spinning-top',
    name: 'Spinning top',
    blurb: 'A cone turned right over onto its point, with a stem to pinch and twist.',
    teaches: 'turning a shape over',
    parts: [
      // Half a turn about X stands the cone on its point. A turned part gives
      // its centre height outright, since its resting height is no longer its.
      {
        type: 'cone',
        color: '#FF5FA2',
        params: { radius: 20, height: 42, sides: 64 },
        rot: [Math.PI, 0, 0],
        y: 21,
      },
      { type: 'cylinder', color: '#C23C77', params: { bottomRadius: 20, topRadius: 9, height: 4, sides: 64 }, lift: 42 },
      { type: 'cylinder', color: '#FFC93D', params: { bottomRadius: 4, topRadius: 3, height: 17, sides: 32 }, lift: 46 },
      { type: 'sphere', color: '#FFC93D', params: { radius: 4, sides: 32, rings: 20 }, lift: 63 },
    ],
  },

  {
    id: 'stacking-rings',
    name: 'Stacking rings',
    blurb: 'Four flat rings down a post, each one wider than the last but with the same hole.',
    teaches: 'sizes',
    parts: [
      { type: 'cylinder', color: '#EDEFF4', params: { bottomRadius: 40, topRadius: 40, height: 5, sides: 64, edge: 1.5 } },
      { type: 'cylinder', color: '#C3CAD9', params: { bottomRadius: 6, topRadius: 5, height: 52, sides: 32 }, lift: 5 },
      // Pipes, not donuts. A donut's hole is its radius less its tube, so a
      // slim ring with a small hole can only be a small ring — the four would
      // have come out the same size, or floating round a post far too thin for
      // them. A pipe sets its outside and its wall apart, so every ring here
      // keeps the same 8 mm hole and only the outside grows.
      { type: 'pipe', color: '#FF5A47', params: { radius: 34, wall: 26, height: 11, sides: 64, edge: 1.4 }, lift: 5 },
      { type: 'pipe', color: '#FF8A3D', params: { radius: 28, wall: 20, height: 11, sides: 64, edge: 1.4 }, lift: 16 },
      { type: 'pipe', color: '#FFC93D', params: { radius: 22, wall: 14, height: 11, sides: 64, edge: 1.4 }, lift: 27 },
      { type: 'pipe', color: '#35C46B', params: { radius: 16, wall: 8, height: 11, sides: 64, edge: 1.4 }, lift: 38 },
    ],
  },

  {
    id: 'bookend',
    name: 'Bookend',
    blurb: 'A foot the books sit on and an upright they lean on, braced by a ramp.',
    teaches: 'right angles',
    parts: [
      { type: 'cube', color: '#3A414F', params: { width: 90, height: 6, depth: 85, edge: 2 } },
      { type: 'cube', color: '#3A414F', params: { width: 90, height: 110, depth: 8, edge: 2 }, at: [0, -38.5], lift: 6 },
      // The ramp does what an unbraced upright cannot: it stops the corner
      // opening up under the weight of the books.
      // Overlapping the upright by a millimetre, for the same reason: a brace
      // that only touches is a brace that comes off.
      { type: 'wedge', color: '#2E7DF6', params: { width: 90, height: 45, depth: 45 }, at: [0, -13], lift: 6 },
    ],
  },

  {
    id: 'bolt-and-nut',
    combine: true,
    name: 'Bolt and nut',
    blurb: 'A real ISO metric thread, and a six-sided nut with its bore taken out.',
    teaches: 'the screw generator',
    parts: [
      { type: 'thread', color: '#C3CAD9', params: { diameter: 16, pitch: 2.5, length: 40, angle: 60, starts: 1, sides: 48 }, at: [-20, 0] },
      // Six sides makes a hex head; it is the same tube the pen pot is made of.
      { type: 'cylinder', color: '#8A93A5', params: { bottomRadius: 13, topRadius: 13, height: 8, sides: 6, edge: 1.4, edgeStyle: 'bevel' }, at: [-20, 0], lift: 40 },
      { type: 'cylinder', color: '#8A93A5', params: { bottomRadius: 13, topRadius: 13, height: 10, sides: 6, edge: 1.4, edgeStyle: 'bevel' }, at: [20, 0] },
      { type: 'cylinder', color: '#3A414F', params: { bottomRadius: 7.2, topRadius: 7.2, height: 20, sides: 32 }, at: [20, 0], y: 5, hole: true },
    ],
  },

  {
    id: 'cookie-cutter',
    combine: true,
    name: 'Cookie cutter',
    blurb: 'A star, and a slightly smaller star marked as a hole, leaving just the wall.',
    teaches: 'holes',
    parts: [
      { type: 'star', color: '#FF5FA2', params: { points: 6, radius: 45, innerRadius: 24, height: 18 } },
      // Straight through, top and bottom: a cutter is open at both ends, so the
      // hole has to stand proud of the shape at each.
      {
        type: 'star',
        color: '#8A93A5',
        params: { points: 6, radius: 42, innerRadius: 21, height: 30 },
        y: 9,
        hole: true,
      },
    ],
  },

  {
    id: 'soap-dish',
    combine: true,
    name: 'Soap dish',
    blurb: 'A tray with three holes in the floor, so the soap dries instead of sitting in water.',
    teaches: 'holes',
    parts: [
      { type: 'cube', color: '#35C46B', params: { width: 100, height: 16, depth: 70, edge: 4 } },
      { type: 'cube', color: '#8A93A5', params: { width: 90, height: 20, depth: 60, edge: 4 }, lift: 5, hole: true },
      { type: 'cylinder', color: '#8A93A5', params: { bottomRadius: 5, topRadius: 5, height: 20, sides: 32 }, at: [-24, 0], y: 4, hole: true },
      { type: 'cylinder', color: '#8A93A5', params: { bottomRadius: 5, topRadius: 5, height: 20, sides: 32 }, at: [0, 0], y: 4, hole: true },
      { type: 'cylinder', color: '#8A93A5', params: { bottomRadius: 5, topRadius: 5, height: 20, sides: 32 }, at: [24, 0], y: 4, hole: true },
    ],
  },

  {
    id: 'napkin-ring',
    name: 'Napkin ring',
    blurb: 'A short length of pipe with a star stood up on the front of it.',
    teaches: 'putting shapes together',
    parts: [
      { type: 'pipe', color: '#D6E24A', params: { radius: 22, wall: 3, height: 32, sides: 64, edge: 1.2 } },
      // A star is built lying flat, like a donut, so it has to be stood up to be
      // seen at all. A quarter turn about Z puts its face along +x — the side
      // the opening view looks straight at, rather than the back of the ring
      // where it may as well not be.
      {
        type: 'star',
        color: '#FFC93D',
        params: { points: 5, radius: 11, innerRadius: 4.8, height: 4 },
        at: [22, 0],
        y: 16,
        // Rx is outermost in Euler 'XYZ', so once Rz has stood the star on the
        // +x face that first angle spins it in its own plane. 54 degrees is
        // what puts a point straight up; left at zero a five-pointed star sits
        // between two points and reads as an X.
        rot: [(54 * Math.PI) / 180, 0, -Math.PI / 2],
      },
    ],
  },

  {
    id: 'domino',
    combine: true,
    name: 'Domino',
    blurb: 'A groove down the middle and five dimples, every one of them a hole.',
    teaches: 'holes',
    parts: [
      { type: 'cube', color: '#EDEFF4', params: { width: 48, height: 8, depth: 24, edge: 1.6 } },
      // Past the edge at both ends, or the groove stops short and reads as a
      // scratch rather than a line.
      { type: 'cube', color: '#8A93A5', params: { width: 1.6, height: 3, depth: 28 }, lift: 7, hole: true },
      { type: 'sphere', color: '#3A414F', params: { radius: 2.2, sides: 24, rings: 16 }, at: [-18, -6], y: 8, hole: true },
      { type: 'sphere', color: '#3A414F', params: { radius: 2.2, sides: 24, rings: 16 }, at: [-12, 0], y: 8, hole: true },
      { type: 'sphere', color: '#3A414F', params: { radius: 2.2, sides: 24, rings: 16 }, at: [-6, 6], y: 8, hole: true },
      { type: 'sphere', color: '#3A414F', params: { radius: 2.2, sides: 24, rings: 16 }, at: [12, -5], y: 8, hole: true },
      { type: 'sphere', color: '#3A414F', params: { radius: 2.2, sides: 24, rings: 16 }, at: [12, 5], y: 8, hole: true },
    ],
  },
]

export const getExample = (id) => EXAMPLES.find((e) => e.id === id) ?? null

/**
 * Turn an example into a scene, with fresh ids every time so loading the same
 * one twice can't collide. It comes back through `migrate` for the same reason
 * a file does: that is what validates every parameter and settles the bound
 * ones against their variables, so an example can't load in a state a build
 * couldn't reach on its own.
 */
export function buildExample(example) {
  const variables = (example.variables ?? []).map((v) => ({
    id: `${example.id}-${v.ref}`,
    name: v.name,
    kind: v.kind,
    value: v.value,
    ...(v.options ? { options: v.options } : {}),
  }))
  const idOf = Object.fromEntries(
    (example.variables ?? []).map((v, i) => [v.ref, variables[i].id])
  )

  const objects = example.parts.map((part) => {
    const params = normalizeParams(part.type, { ...defaultParams(part.type), ...part.params })
    const [x, z] = part.at ?? [0, 0]
    const y = part.y ?? restingHeight(part.type, params) + (part.lift ?? 0)

    const object = makeObject(part.type, [x, y, z], part.color, params)
    if (part.rot) object.rotation = [...part.rot]
    // A part marked `hole` is a cutting tool rather than a piece of the model:
    // it takes its own volume out of every solid it overlaps. Half of what
    // makes a useful object useful is the space inside it, so an example that
    // could only add material could only ever show toys.
    if (part.hole) object.hole = true
    if (part.bind) {
      object.bindings = Object.fromEntries(
        Object.entries(part.bind).map(([key, ref]) => [key, idOf[ref]])
      )
    }
    return object
  })

  // Combine each solid with the holes that cut it — the same grouping pressing
  // Combine on that selection would give.
  //
  // An earlier version put the holes in a group of their own. That hid them,
  // which was the visible half of the job, but left them behind: a group is
  // what makes a set of parts travel together, so a die dragged across the
  // plate walked out of its own pips and left twenty-one dimples floating
  // where it used to be. They could not be clicked back, either, because a
  // combined hole is not drawn.
  //
  // A part can only belong to one group, so a hole that reaches into two
  // solids has to pull both into the same one. That makes this a
  // connected-components problem rather than a loop: holes are the edges,
  // parts are the nodes, and each component that is more than one part becomes
  // a group.
  const groups = []
  if (example.combine) {
    const parent = new Map(objects.map((o) => [o.id, o.id]))
    const find = (id) => {
      while (parent.get(id) !== id) {
        parent.set(id, parent.get(parent.get(id)))
        id = parent.get(id)
      }
      return id
    }
    const union = (a, b) => {
      const ra = find(a)
      const rb = find(b)
      if (ra !== rb) parent.set(ra, rb)
    }
    for (const [solidId, holes] of cuttersByObject(objects)) {
      for (const hole of holes) union(solidId, hole.id)
    }

    const members = new Map()
    for (const o of objects) {
      const root = find(o.id)
      if (!members.has(root)) members.set(root, [])
      members.get(root).push(o)
    }
    let n = 0
    for (const parts of members.values()) {
      // A part nothing cuts, and that cuts nothing, is its own thing and stays
      // free to be picked up on its own.
      if (parts.length < 2) continue
      const id = `${example.id}-${++n}`
      for (const o of parts) o.parentGroupId = id
      groups.push({ id, memberIds: parts.map((o) => o.id) })
    }
  }

  return migrate({ version: SCENE_VERSION, objects, groups, variables })
}
