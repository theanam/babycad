/**
 * What the axes are *called*.
 *
 * The scene graph is three.js-native Y-up: the floor is the XZ plane and a
 * block's height is its `y`. CAD is Z-up — X across the bench, Y away from
 * you, Z up off the bench — and this is a CAD program, so Z-up is what every
 * axis the user meets is named: the view cube's triad, the numbers in the
 * properties rail, the colors on the gizmo's turn levers.
 *
 * This is a naming layer and nothing else. The scene graph, the saved file and
 * both exporters keep their internal Y-up coordinates, so nothing about this
 * changes what a build *is* — only what its parts are called.
 *
 * - `slot` indexes the internal `[x, y, z]` triples.
 * - `sign` flips the one axis whose direction reverses. Internal +z points at
 *   the viewer; CAD's +Y points away from them, so displayed Y is internal
 *   −z. That flip is the whole reason the labels can't simply be swapped: it
 *   is what keeps the displayed frame right-handed, which is what makes a
 *   turn of +90° go the way a CAD user expects.
 * - `vec` is the displayed axis written as an internal direction, for anything
 *   that has to draw it in scene space.
 */
export const AXES = [
  { label: 'X', slot: 0, sign: 1, vec: [1, 0, 0], color: '#FF5A47' },
  { label: 'Y', slot: 2, sign: -1, vec: [0, 0, -1], color: '#35C46B' },
  { label: 'Z', slot: 1, sign: 1, vec: [0, 1, 0], color: '#2E7DF6' },
]

/** The color naming an internal axis index — the gizmo's levers turn about those. */
export const axisColor = (slot) => AXES.find((a) => a.slot === slot).color
