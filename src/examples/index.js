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

export const EXAMPLES = [
  {
    id: 'rocket',
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

      // Four bolts, one per corner of the plate.
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
      })),
    ],
  },

  {
    id: 'robot',
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
    if (part.bind) {
      object.bindings = Object.fromEntries(
        Object.entries(part.bind).map(([key, ref]) => [key, idOf[ref]])
      )
    }
    return object
  })

  return migrate({ version: SCENE_VERSION, objects, groups: [], variables })
}
