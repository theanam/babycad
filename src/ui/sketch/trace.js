/**
 * A photograph to draw over.
 *
 * Put a picture of the thing behind the board, scale it until something in it
 * is the size you know it to be, and trace the outline you want. It is a
 * backdrop and nothing more: it never becomes part of the document, it is not
 * in what gets extruded, and it does not travel in the build.
 *
 * **It is deliberately not saved.** A photograph is a megabyte or two and the
 * sketch document is kilobytes; putting one in `params` would be exactly the
 * mistake `shapes/meshStore` exists to avoid, except worse — a model's
 * triangles are at least part of the part, and this is a reference somebody
 * used once. So it lives in this module, in memory, for as long as the tab is
 * open. Close the board and come back to it and the photo is still there;
 * reload the page and it is gone, along with the object URL behind it.
 *
 * The box is millimetres, `{ x, y, w, h }` with `y` at the bottom, the same
 * way a `rect` node reads.
 */

/** editing target -> { src, box, fade, url } */
const kept = new Map()

export const tracedFor = (key) => kept.get(key) ?? null

export function keepTrace(key, photo) {
  const had = kept.get(key)
  // One object URL at a time per board: replacing a photo lets the old one go
  // rather than leaving it held for as long as the tab lives.
  if (had?.url && had.url !== photo?.url) URL.revokeObjectURL(had.url)
  if (photo) kept.set(key, photo)
  else kept.delete(key)
}

/**
 * Hand a photo on from one key to another.
 *
 * A drawing that has not been placed yet is kept under `new`, because there
 * is no block to key it to; the moment it lands there is. Without this the
 * photo somebody traced over would be gone the first time they reopened the
 * thing they traced — which is exactly when they would want it, because
 * tracing is rarely finished in one sitting.
 */
export function adoptTrace(from, to) {
  const had = kept.get(from)
  if (!had || from === to) return
  kept.delete(from)
  const already = kept.get(to)
  if (already?.url && already.url !== had.url) URL.revokeObjectURL(already.url)
  kept.set(to, had)
}

export function dropTrace(key) {
  const had = kept.get(key)
  if (had?.url) URL.revokeObjectURL(had.url)
  kept.delete(key)
}

/* ------------------------------------------------------------ the size -- */

/**
 * Where a photo lands when it is first opened: middle of the board, as big as
 * will fit with a margin, keeping its own proportions.
 *
 * Fitted to the *view* rather than to some fixed number of millimetres,
 * because the view is where the person is looking and a photo that arrives
 * off-screen or a hundredth of the size of the grid is a photo they have to
 * go and find. Its real size is the next thing they will set anyway — that is
 * the whole point of tracing — and there is no way to guess it from a JPEG.
 */
export function fitPhoto(natural, view, size, margin = 0.8) {
  const aspect = natural.h > 0 ? natural.w / natural.h : 1
  const across = ((size.w || 600) / view.scale) * margin
  const down = ((size.h || 400) / view.scale) * margin
  let w = across
  let h = w / aspect
  if (h > down) {
    h = down
    w = h * aspect
  }
  return { x: view.cx - w / 2, y: view.cy - h / 2, w, h }
}

export const photoHandles = (box) => [
  { id: 't0', x: box.x, y: box.y },
  { id: 't1', x: box.x + box.w, y: box.y },
  { id: 't2', x: box.x + box.w, y: box.y + box.h },
  { id: 't3', x: box.x, y: box.y + box.h },
]

/**
 * Drag a corner. The opposite corner stays put and the proportions hold —
 * a traced photograph that has been stretched is a tracing of the wrong
 * shape, and there is no reason anybody would want one.
 *
 * Which of the two directions wins is whichever asks for more, so the corner
 * keeps up with the pointer on the axis being pulled hardest rather than
 * lagging behind on both.
 */
export function resizePhoto(box, id, to, least = 1) {
  const corners = photoHandles(box)
  const at = corners.findIndex((c) => c.id === id)
  if (at < 0) return box
  const anchor = corners[(at + 2) % 4]
  const aspect = box.h > 0 ? box.w / box.h : 1
  const wantW = Math.abs(to.x - anchor.x)
  const wantH = Math.abs(to.y - anchor.y)
  let w = Math.max(wantW, wantH * aspect)
  if (w < least) w = least
  const h = w / aspect
  return {
    x: to.x < anchor.x ? anchor.x - w : anchor.x,
    y: to.y < anchor.y ? anchor.y - h : anchor.y,
    w,
    h,
  }
}

export const movePhoto = (box, dx, dy) => ({ ...box, x: box.x + dx, y: box.y + dy })

/** What a file picker should offer. Anything a browser will draw. */
export const PHOTO_TYPES = 'image/png,image/jpeg,image/webp,image/gif,image/avif'
