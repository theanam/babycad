/**
 * Text, as a solid you can print.
 *
 * **Why the font is bundled rather than fetched.** Every builder in here is
 * synchronous — `build(params)` hands back a geometry, and the cache, the
 * placement maths and `measure` all call it expecting an answer immediately.
 * A font arriving over the network would mean the first text block had no size
 * to be placed by, so the two typefaces are imported as JSON and parsed once
 * when this module loads. They are three's own MgOpen-derived faces, whose
 * licence permits redistribution; the notice travels with them in
 * `shapes/fonts/LICENSE`. They are kept as JS modules rather than .json so the
 * same import works under Vite and under plain node, which would otherwise
 * demand an import attribute the bundler does not need.
 *
 * **Why it lies down.** `TextGeometry` writes in the XY plane and extrudes
 * along +Z, which would stand the letters up like a billboard. Everything in
 * this app is built to be printed, and lettering prints lying flat — face up
 * on the plate, extruded upward, the way a nameplate or a stamp is made. So
 * the geometry is turned a quarter circle about X: the text then reads in the
 * XZ plane with its thickness running up +Y, which is also the up axis every
 * other builder uses.
 *
 * **Why it is re-centred by hand.** A glyph run starts at the origin and grows
 * to the right, and sits on its own baseline — so descenders hang below it and
 * the whole string leans off to one side. Left alone, a text block would turn
 * about a corner instead of its middle and drop through the plate by the depth
 * of its lowest tail. Centring on the real bounding box is what lets the gizmo,
 * `restingHeight` and the resize substitution treat it like any other shape.
 */
import { Font } from 'three/examples/jsm/loaders/FontLoader.js'
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js'
import regular from '../fonts/helvetiker_regular'
import bold from '../fonts/helvetiker_bold'

const FONTS = {
  regular: new Font(regular),
  bold: new Font(bold),
}

export const FONT_OPTIONS = [
  { value: 'bold', label: 'Bold' },
  { value: 'regular', label: 'Regular' },
]

/**
 * The face's own em size. `size` in the parameters is what the user means by
 * "how tall", so the glyphs are built at this fixed size and then scaled to
 * the cap height actually asked for — building at the final size directly
 * would make the curve tolerance vary with it, so a small word came out
 * visibly coarser than a large one.
 */
const EM = 10

/** Nothing printable left after trimming means there is no solid to make. */
const printable = (value) => String(value ?? '').replace(/\s+/g, ' ').trim()

export function buildText({ text, size, thickness, font, curve, edge, edgeStyle }) {
  const content = printable(text) || 'Text'
  const face = FONTS[font] ?? FONTS.bold

  const cut = (bevel) =>
    new TextGeometry(content, {
      font: face,
      size: EM,
      // `height` was renamed `depth` in r163; pass both so the builder does not
      // quietly extrude nothing if three moves under us again.
      depth: EM,
      height: EM,
      curveSegments: curve,
      ...(bevel
        ? {
            bevelEnabled: true,
            bevelThickness: bevel.deep,
            bevelSize: bevel.wide,
            bevelOffset: 0,
            bevelSegments: bevel.segments,
          }
        : { bevelEnabled: false }),
    })

  let geometry = cut(null)

  // The letters are built at a fixed em and scaled to the millimetres asked
  // for, so a bevel measured in millimetres has to be divided by the scale it
  // is about to be multiplied by — and the two axes do not scale alike. That
  // needs the plain run's measurements, so it is cut once to measure and once
  // to keep.
  if (edge > 0) {
    geometry.computeBoundingBox()
    const b0 = geometry.boundingBox
    const tall0 = Math.max(b0.max.y - b0.min.y, 1e-6)
    const deep0 = Math.max(b0.max.z - b0.min.z, 1e-6)
    // Half the thickness and half the letter height are as far as an edge can
    // come back before the two sides of it meet.
    const e = Math.min(edge, thickness * 0.49, size * 0.24)
    if (e > 1e-4) {
      const bevelled = cut({
        wide: (e * tall0) / size,
        deep: (e * deep0) / thickness,
        segments: edgeStyle === 'bevel' ? 1 : 3,
      })
      geometry.dispose()
      geometry = bevelled
    }
  }

  // Lie the letters down: reading direction stays +X, thickness becomes +Y.
  geometry.rotateX(-Math.PI / 2)
  geometry.computeBoundingBox()

  // Scale to the asked-for cap height and thickness. Measured from the glyphs
  // themselves rather than assumed from `EM`, because a string of lower-case
  // letters with no ascender is genuinely shorter than one with.
  geometry.computeBoundingBox()
  const box = geometry.boundingBox
  const tall = Math.max(box.max.z - box.min.z, 1e-6)
  const deep = Math.max(box.max.y - box.min.y, 1e-6)
  geometry.scale(size / tall, thickness / deep, size / tall)

  // Centre on the origin in all three, as every builder here does. Sitting it
  // on the plate is not this function's job — `restingHeight` reads the box
  // back and places it, and it can only do that if the origin is the middle.
  geometry.computeBoundingBox()
  const b = geometry.boundingBox
  geometry.translate(
    -(b.min.x + b.max.x) / 2,
    -(b.min.y + b.max.y) / 2,
    -(b.min.z + b.max.z) / 2
  )

  geometry.computeVertexNormals()
  return geometry
}

/** Exported for the parameter spec, so the two can't drift apart. */
export const DEFAULT_TEXT = 'ABC'
