/**
 * The shape registry — the single source of truth for what can be built.
 *
 * A shape definition is:
 *
 *   { type, label, family, color, blurb, params, build }
 *
 * `params` is the spec list the properties panel renders and the cache keys
 * on; `build(params)` returns a geometry centred on the origin with +y up.
 * Adding a shape means adding one entry here and one icon — the tray, the
 * panel, persistence, undo and the exporters all pick it up for free.
 *
 * Two families: `solid` for the plain primitives, `generator` for the shapes
 * whose parameters describe a mechanism rather than a box.
 *
 * Lengths are millimetres — one world unit is 1 mm. Defaults are chosen so a
 * fresh shape drops with a 20 mm footprint, the size of the yard's grid
 * squares, so anything placed sits on the grid like a building block.
 */
import { choice, deg, defaultsOf, int, normalize, num, paramsKey, text } from './params'
import {
  buildCone,
  buildCube,
  buildCylinder,
  buildPipe,
  buildPyramid,
  buildSphere,
  buildStar,
  buildTorus,
  buildWedge,
} from './builders/primitives'
import { buildGear } from './builders/gear'
import { buildThread } from './builders/thread'
import { buildKnot, buildSpring } from './builders/spring'
import { buildText, DEFAULT_TEXT, FONT_OPTIONS } from './builders/text'

/**
 * A length, in millimetres. `length: true` is what the v3 -> v4 migration
 * looks for when it scales an older build up into millimetres, so a size that
 * doesn't go through here won't be found: put every length through it.
 */
const size = (key, label, def, opts) =>
  num(key, label, def, { min: 0.4, max: 160, step: 2, unit: 'mm', length: true, ...opts })
const smoothness = (def = 32) => int('sides', 'Smoothness', def, { min: 3, max: 96 })
const sweep = () => deg('sweep', 'Sweep', 360, { min: 10, max: 360, step: 15 })
const HAND = [
  { value: 'right', label: 'Right' },
  { value: 'left', label: 'Left' },
]

export const SHAPE_DEFS = [
  {
    type: 'text',
    label: 'Text',
    family: 'generator',
    color: '#35C46B',
    params: [
      text('text', 'Words', DEFAULT_TEXT),
      size('size', 'Letter height', 20),
      size('thickness', 'Thickness', 5),
      choice('font', 'Weight', 'bold', FONT_OPTIONS),
      int('curve', 'Smoothness', 6, { min: 1, max: 12 }),
    ],
    build: buildText,
  },
  {
    type: 'cube',
    label: 'Cube',
    family: 'solid',
    color: '#FFC93D',
    params: [
      size('width', 'Width', 20),
      size('height', 'Height', 20),
      size('depth', 'Depth', 20),
    ],
    build: buildCube,
  },
  {
    type: 'sphere',
    label: 'Ball',
    family: 'solid',
    color: '#2E7DF6',
    params: [
      size('radius', 'Radius', 10),
      smoothness(32),
      int('rings', 'Rings', 24, { min: 2, max: 64 }),
      deg('slice', 'Slice', 360, { min: 10, max: 360, step: 15 }),
    ],
    build: buildSphere,
  },
  {
    type: 'cone',
    label: 'Cone',
    family: 'solid',
    color: '#FF5A47',
    params: [size('radius', 'Radius', 10), size('height', 'Height', 20), smoothness(32), sweep()],
    build: buildCone,
  },
  {
    type: 'cylinder',
    label: 'Tube',
    family: 'solid',
    color: '#35C46B',
    params: [
      size('bottomRadius', 'Bottom', 10),
      size('topRadius', 'Top', 10, { min: 0 }),
      size('height', 'Height', 20),
      smoothness(32),
      sweep(),
    ],
    build: buildCylinder,
  },
  {
    type: 'pyramid',
    label: 'Pyramid',
    family: 'solid',
    color: '#FF8A3D',
    params: [
      size('radius', 'Base', 14.4),
      size('height', 'Height', 20),
      int('sides', 'Sides', 4, { min: 3, max: 16 }),
    ],
    build: buildPyramid,
  },
  {
    type: 'torus',
    label: 'Donut',
    family: 'solid',
    color: '#FF5FA2',
    params: [
      size('radius', 'Radius', 6.8),
      size('tube', 'Thickness', 3.2),
      int('segments', 'Smoothness', 40, { min: 3, max: 96 }),
      int('sides', 'Roundness', 18, { min: 3, max: 48 }),
      sweep(),
    ],
    build: buildTorus,
  },
  {
    type: 'wedge',
    label: 'Ramp',
    family: 'solid',
    color: '#16C1C1',
    params: [size('width', 'Width', 20), size('height', 'Height', 20), size('depth', 'Depth', 20)],
    build: buildWedge,
  },
  {
    type: 'pipe',
    label: 'Pipe',
    family: 'solid',
    color: '#7C4DFF',
    params: [
      size('radius', 'Radius', 10),
      size('wall', 'Wall', 2.4, { max: 40, step: 0.4 }),
      size('height', 'Height', 20),
      smoothness(48),
      sweep(),
    ],
    build: buildPipe,
  },
  {
    type: 'star',
    label: 'Star',
    family: 'solid',
    color: '#D6E24A',
    params: [
      int('points', 'Points', 5, { min: 3, max: 24 }),
      size('radius', 'Radius', 10),
      size('innerRadius', 'Inner', 4.4),
      size('height', 'Thickness', 6),
      deg('twist', 'Twist', 0, { min: -360, max: 360, step: 15 }),
    ],
    build: buildStar,
  },

  /* ------------------------------------------------------- generators -- */

  {
    type: 'gear',
    label: 'Gear',
    family: 'generator',
    color: '#A9744F',
    blurb: 'Involute spur gear — two gears of the same tooth size mesh.',
    params: [
      int('teeth', 'Teeth', 16, { min: 6, max: 80 }),
      size('module', 'Tooth size', 1.2, { min: 0.2, max: 8, step: 0.1 }),
      size('thickness', 'Thickness', 5, { max: 60 }),
      choice('pressureAngle', 'Tooth angle', 20, [
        { value: 14.5, label: '14.5°' },
        { value: 20, label: '20°' },
        { value: 25, label: '25°' },
      ]),
      size('bore', 'Hole', 4, { min: 0, max: 80, step: 1 }),
      deg('helix', 'Helix', 0, { min: -45, max: 45, step: 5 }),
    ],
    build: buildGear,
  },
  {
    type: 'thread',
    label: 'Screw',
    family: 'generator',
    color: '#EDEFF4',
    blurb: 'Threaded rod with an ISO metric profile.',
    params: [
      size('diameter', 'Diameter', 12, { max: 80 }),
      size('pitch', 'Pitch', 3.2, { min: 0.4, max: 20, step: 0.2 }),
      size('length', 'Length', 28, { max: 160 }),
      deg('angle', 'Thread angle', 60, { min: 20, max: 100, step: 5 }),
      int('starts', 'Starts', 1, { min: 1, max: 6 }),
      choice('hand', 'Hand', 'right', HAND),
      smoothness(32),
    ],
    build: buildThread,
  },
  {
    type: 'spring',
    label: 'Spring',
    family: 'generator',
    color: '#8A93A5',
    blurb: 'Round-wire coil.',
    params: [
      size('radius', 'Coil radius', 8),
      size('wire', 'Wire', 1.6, { min: 0.2, max: 20, step: 0.2 }),
      num('turns', 'Turns', 5, { min: 0.25, max: 40, step: 0.5 }),
      size('height', 'Height', 24, { max: 160 }),
      int('sides', 'Smoothness', 10, { min: 3, max: 32 }),
      choice('hand', 'Hand', 'right', HAND),
    ],
    build: buildSpring,
  },
  {
    type: 'knot',
    label: 'Knot',
    family: 'generator',
    color: '#FF5FA2',
    blurb: 'Torus knot — p turns one way, q the other.',
    params: [
      size('radius', 'Radius', 8),
      size('tube', 'Thickness', 2.4, { min: 0.2, max: 20, step: 0.2 }),
      int('p', 'P', 2, { min: 1, max: 12 }),
      int('q', 'Q', 3, { min: 1, max: 12 }),
      int('sides', 'Smoothness', 12, { min: 3, max: 32 }),
    ],
    build: buildKnot,
  },
]

const byType = new Map(SHAPE_DEFS.map((d) => [d.type, d]))

/** Unknown types fall back to the cube rather than crashing a loaded scene. */
export const getShapeDef = (type) => byType.get(type) ?? byType.get('cube')

export const SHAPE_TYPES = SHAPE_DEFS.map((d) => d.type)
export const SOLIDS = SHAPE_DEFS.filter((d) => d.family === 'solid')
export const GENERATORS = SHAPE_DEFS.filter((d) => d.family === 'generator')

export const SHAPE_LABEL = Object.fromEntries(SHAPE_DEFS.map((d) => [d.type, d.label]))
export const SHAPE_COLOR = Object.fromEntries(SHAPE_DEFS.map((d) => [d.type, d.color]))

export const defaultParams = (type) => defaultsOf(getShapeDef(type).params)
export const normalizeParams = (type, raw) => normalize(getShapeDef(type).params, raw)
export const keyOfParams = (type, params) => type + paramsKey(getShapeDef(type).params, params)
