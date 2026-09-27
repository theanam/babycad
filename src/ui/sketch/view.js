/**
 * The drawing board's camera: millimetres to pixels and back, the grid, and
 * where a point lands once it has snapped.
 *
 * A view is `{ cx, cy, scale }` — the millimetre point in the middle of the
 * board and how many pixels one millimetre gets. Screen y runs downward and
 * the drawing's runs up, which is the sign in every one of these and the
 * reason they are all in one file.
 */
import { FOOTPRINT, PLATE_HALF } from '../../constants'

export const toScreen = (view, size, x, y) => ({
  x: size.w / 2 + (x - view.cx) * view.scale,
  y: size.h / 2 - (y - view.cy) * view.scale,
})

export const toDrawing = (view, size, x, y) => ({
  x: view.cx + (x - size.w / 2) / view.scale,
  y: view.cy - (y - size.h / 2) / view.scale,
})

/** How far apart two things are on screen, in millimetres. */
export const mmPerPixel = (view) => 1 / view.scale

export const snapped = (value, step) => (step > 0 ? Math.round(value / step) * step : value)

export const snapPoint = (point, step) => ({
  x: snapped(point.x, step),
  y: snapped(point.y, step),
})

/**
 * Zoom about a point on screen, so the millimetre under the cursor stays
 * under it — the same bargain `zoomToCursor` strikes in the 3D view.
 */
export function zoomAt(view, size, screen, factor) {
  const scale = Math.max(0.4, Math.min(80, view.scale * factor))
  if (scale === view.scale) return view
  const before = toDrawing(view, size, screen.x, screen.y)
  const after = toDrawing({ ...view, scale }, size, screen.x, screen.y)
  return { cx: view.cx + before.x - after.x, cy: view.cy + before.y - after.y, scale }
}

/** Frame a box with a margin, or sit at a sensible default if there is none. */
export function fitView(box, size, margin = 0.16) {
  if (!size.w || !size.h) return { cx: 0, cy: 0, scale: 4 }
  if (!box || box.width < 1e-6 || box.height < 1e-6) {
    // Nothing drawn yet: a board about six footprints across, which is a
    // hand-sized part at a size you can see the grid under.
    return { cx: 0, cy: 0, scale: Math.min(size.w, size.h) / (FOOTPRINT * 6) }
  }
  const scale = Math.min(size.w / box.width, size.h / box.height) * (1 - margin)
  return {
    cx: (box.minX + box.maxX) / 2,
    cy: (box.minY + box.maxY) / 2,
    scale: Math.max(0.4, Math.min(80, scale)),
  }
}

/**
 * The grid lines to draw, in millimetres.
 *
 * Two steps, the way the plate has two: the snap grid, and a heavier line
 * every footprint so there is something to count in. The fine grid drops out
 * once it would be closer than a few pixels — a grid you cannot see between
 * is a grey wash, and it costs a line element each.
 */
export function gridLines(view, size, step) {
  const topLeft = toDrawing(view, size, 0, 0)
  const bottomRight = toDrawing(view, size, size.w, size.h)
  const fine = step > 0 && step * view.scale >= 6 ? step : 0
  const out = { fine: { x: [], y: [] }, coarse: { x: [], y: [] } }

  const run = (from, to, at, into) => {
    if (!(at > 0)) return
    const start = Math.ceil(from / at) * at
    // A bounded number of lines whatever the zoom, so a view dragged far out
    // cannot ask for a hundred thousand elements.
    for (let n = start, i = 0; n <= to && i < 400; n += at, i++) into.push(n)
  }

  run(topLeft.x, bottomRight.x, fine, out.fine.x)
  run(bottomRight.y, topLeft.y, fine, out.fine.y)
  run(topLeft.x, bottomRight.x, FOOTPRINT, out.coarse.x)
  run(bottomRight.y, topLeft.y, FOOTPRINT, out.coarse.y)
  return out
}

/** The plate, drawn faintly behind everything, so a size means something. */
export const PLATE_BOX = {
  minX: -PLATE_HALF,
  minY: -PLATE_HALF,
  maxX: PLATE_HALF,
  maxY: PLATE_HALF,
}
