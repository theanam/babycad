// Block palette — 12 flat colors, from the design doc's token strip.
export const PALETTE = [
  '#FF5A47', // red
  '#FF8A3D', // orange
  '#FFC93D', // yellow
  '#D6E24A', // lime
  '#35C46B', // green
  '#16C1C1', // teal
  '#2E7DF6', // blue
  '#7C4DFF', // purple
  '#FF5FA2', // pink
  '#A9744F', // brown
  '#EDEFF4', // white
  '#3A414F', // slate
]

// The six that sit directly on the object panel; the rest live in the sheet.
export const QUICK_COLORS = ['#FF5A47', '#FF8A3D', '#FFC93D', '#35C46B', '#2E7DF6', '#7C4DFF']

// Names for the swatches, so a tooltip can say "Paint it red" rather than a hex code.
export const COLOR_NAME = {
  '#FF5A47': 'red',
  '#FF8A3D': 'orange',
  '#FFC93D': 'yellow',
  '#D6E24A': 'lime',
  '#35C46B': 'green',
  '#16C1C1': 'teal',
  '#2E7DF6': 'blue',
  '#7C4DFF': 'purple',
  '#FF5FA2': 'pink',
  '#A9744F': 'brown',
  '#EDEFF4': 'white',
  '#3A414F': 'slate',
}

// Shapes — what they are, what they're called and what they're made of — live
// in src/shapes, not here, because each one now carries its own parameters and
// its own builder. This file is for values that aren't about any one shape.

// One world unit is one millimetre. The numbers in the properties rail are
// millimetres, the grid squares are 20 mm — one shape footprint — and an
// exported STL lands in a slicer at the size it says it is.

// Snapping defaults on; hold Alt while dragging for free movement. `scale` is
// a multiplier rather than a length, so it carries no unit and no mm.
//
// `move` is the plate's grid: how far apart the lines are drawn and where a
// freshly dropped block lands. It is no longer what a drag snaps to — that is
// chosen from the snap switch, out of SNAP_STEPS below, and starts finer than
// the grid so a nudge is a nudge rather than a jump to the next line.
export const SNAP = {
  move: 5,
  scale: 0.25,
}

// The build plate is a bounded 200x200 mm yard rather than an endless grid, so
// the scene reads at a definite size and blocks always land somewhere
// meaningful. Ten shape footprints across.
/**
 * The grids the snap switch offers, finest first, and the one it starts on.
 *
 * Each carries the turn that goes with it. Rotation used to snap to a flat
 * 15° whatever you were doing, which is a big jump when the lengths beside it
 * are moving half a millimetre at a time; the switch now sets how fine the
 * work is in both senses at once.
 */
export const SNAP_STEPS = [
  // Finer than the printer can hold, but a hole in a bracket sometimes wants
  // to be exactly where it is rather than near it.
  { mm: 0.1, deg: 1 },
  { mm: 0.5, deg: 1 },
  { mm: 1, deg: 5 },
  { mm: 5, deg: 15 },
]
export const SNAP_DEFAULT = 0.5

/** The turn that goes with a length grid. */
export const angleStepFor = (mm) => SNAP_STEPS.find((s) => s.mm === mm)?.deg ?? 15

export const PLATE = 200
export const PLATE_HALF = PLATE / 2

// The floor space one placed shape gets to itself. Every shape's defaults are
// drawn to fill it, the grid's heavier lines mark it out, and placement keeps
// it clear — so shapes dropped one after another land side by side on the
// grid instead of inside one another.
export const FOOTPRINT = 20

// v2 added per-shape parameters; v3 added named variables and the bindings
// that point parameters at them. Both migrate forward without changing how a
// build looks: a v1 shape's defaults are exactly the geometry v1 had, and a
// scene with no variables is a scene with nothing bound.
// v4 is the move to millimetres, and is the one migration that changes the
// numbers rather than filling in missing ones: every length in an older build
// is multiplied by 20, so it comes back the same shape in the same place on a
// plate that grew by the same factor.
// v5 adds `hole`: a block that cuts the solids it is combined with instead of
// being one. Purely additive — a v4 build has no holes in it, so it loads
// looking exactly as it did.
export const SCENE_VERSION = 6
export const MAX_HISTORY = 200

// Past this many blocks we drop shadow quality rather than let the frame rate go.
export const HEAVY_SCENE = 120
