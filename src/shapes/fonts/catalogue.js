/**
 * The typefaces `text` offers.
 *
 * Two of them are bundled and always there; the rest are fetched the first
 * time somebody picks them. They are drawn from the `google/fonts` repository
 * over its raw CDN, which serves real TTF with `access-control-allow-origin:
 * *`. The web-font CSS API is deliberately not used — it answers with WOFF2,
 * which cannot be turned into glyph outlines without a decompressor, and
 * outlines are the whole point here: these letters become a solid.
 *
 * Chosen for printing rather than for reading. A hairline serif at 15 mm is a
 * stroke a nozzle cannot lay down, so the list leans on rounded and heavy
 * faces that come off a printer as something you can pick up.
 */
/** The face a text block starts in, and the one anything else falls back to. */
export const DEFAULT_FAMILY = 'Helvetiker Bold'
/** The fallback while a fetched face is still on its way. */
export const BUNDLED = 'Helvetiker'

const CDN = 'https://raw.githubusercontent.com/google/fonts/main/'

/** `{ family, url }`, or no url for the ones that ship with the app. */
export const FONT_CATALOGUE = [
  { family: 'Helvetiker', bundled: 'regular' },
  { family: 'Helvetiker Bold', bundled: 'bold' },
  { family: 'Fredoka', path: 'ofl/fredoka/Fredoka%5Bwdth,wght%5D.ttf' },
  { family: 'Baloo', path: 'ofl/baloo2/Baloo2%5Bwght%5D.ttf' },
  { family: 'Nunito', path: 'ofl/nunito/Nunito%5Bwght%5D.ttf' },
  { family: 'Luckiest Guy', path: 'apache/luckiestguy/LuckiestGuy-Regular.ttf' },
  { family: 'Bangers', path: 'ofl/bangers/Bangers-Regular.ttf' },
  { family: 'Titan One', path: 'ofl/titanone/TitanOne-Regular.ttf' },
  { family: 'Bungee', path: 'ofl/bungee/Bungee-Regular.ttf' },
  { family: 'Righteous', path: 'ofl/righteous/Righteous-Regular.ttf' },
  { family: 'Archivo Black', path: 'ofl/archivoblack/ArchivoBlack-Regular.ttf' },
  { family: 'Lobster', path: 'ofl/lobster/Lobster-Regular.ttf' },
  { family: 'Pacifico', path: 'ofl/pacifico/Pacifico-Regular.ttf' },
  { family: 'Roboto Slab', path: 'apache/robotoslab/RobotoSlab%5Bwght%5D.ttf' },
].map((f) => ({ ...f, url: f.path ? CDN + f.path : null }))

export const FONT_OPTIONS = FONT_CATALOGUE.map((f) => ({ value: f.family, label: f.family }))
export const fontEntry = (family) =>
  FONT_CATALOGUE.find((f) => f.family === family) ?? FONT_CATALOGUE[0]
