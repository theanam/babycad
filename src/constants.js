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

// Kid-facing names, per the design's tray flyout.
export const SHAPES = [
  { type: 'cube', label: 'Cube', color: '#FFC93D' },
  { type: 'sphere', label: 'Ball', color: '#2E7DF6' },
  { type: 'cone', label: 'Cone', color: '#FF5A47' },
  { type: 'cylinder', label: 'Tube', color: '#35C46B' },
  { type: 'pyramid', label: 'Pyramid', color: '#FF8A3D' },
  { type: 'torus', label: 'Donut', color: '#FF5FA2' },
]

export const SHAPE_LABEL = Object.fromEntries(SHAPES.map((s) => [s.type, s.label]))
export const SHAPE_COLOR = Object.fromEntries(SHAPES.map((s) => [s.type, s.color]))

// Snapping defaults on; hold Alt while dragging for free movement.
export const SNAP = {
  move: 0.25,
  rotate: Math.PI / 12, // 15°
  scale: 0.25,
}

// The build plate is a bounded 20x20 yard rather than an endless grid, so the
// scene reads at a definite size and blocks always land somewhere meaningful.
export const PLATE = 20
export const PLATE_HALF = PLATE / 2

export const SCENE_VERSION = 1
export const MAX_HISTORY = 200

// Past this many blocks we drop shadow quality rather than let the frame rate go.
export const HEAVY_SCENE = 120
