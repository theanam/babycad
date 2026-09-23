/**
 * The picture on an example's card: a render of the build itself.
 *
 * These used to be flat drawings, on the reasoning that a drawing can say
 * "rocket" at 150 pixels in a way a shaded 3D view of seven blocks cannot.
 * That holds for a rocket. It stops holding at twenty-two builds, most of them
 * objects rather than toys — a drawn soap dish is a green rectangle — and a
 * drawing has no way of staying true: nothing checks it, so a card can go on
 * promising a shape the build no longer has. A render cannot drift, because it
 * is the build.
 *
 * They are made ahead of time rather than in the browser. Rendering twenty-two
 * scenes off-screen before the app has been used once is a great deal of work
 * for a set of thumbnails, and it would fall on every first visit.
 * `tools/render-examples.mjs` drives the real app and shoots each one; run it
 * whenever a build changes.
 */
const SHOTS = import.meta.glob('../assets/examples/*.jpg', { eager: true, import: 'default' })

const byId = Object.fromEntries(
  Object.entries(SHOTS).map(([path, url]) => [path.split('/').pop().replace(/\.jpg$/, ''), url])
)

export default function ExampleArt({ id }) {
  const src = byId[id]
  // No shot for this one yet: the panel behind it stands in, so a newly added
  // example looks unfinished rather than broken.
  if (!src) return <span className="example-art" aria-hidden="true" />
  return <img className="example-art" src={src} alt="" loading="lazy" draggable="false" />
}
