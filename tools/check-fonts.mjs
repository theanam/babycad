/**
 * Fonts check:  `node tools/check-fonts.mjs`
 *
 * Every typeface on offer, set in a spread of strings, checked for the one
 * thing that matters: that building the letters cannot throw.
 *
 * It could, and did. A builder runs inside a render, so a throw there unmounts
 * the app — and three of the fourteen faces threw on every string, plain ABC
 * included, because opentype.js does not implement the substitution table they
 * use. Picking Nunito was not a font that failed to load; it was a white page.
 * A fourth kind of failure came from typing characters a face has no glyphs
 * for, which left no outlines and a geometry with no vertex data in it.
 *
 * Nothing here judges how the letters look — only that a word can be built out
 * of every face without taking the afternoon with it.
 *
 * The builder is called directly rather than through `buildGeometry`, which
 * catches a throw and hands back an empty block on purpose. That safety net is
 * there so a bad shape costs one block instead of the session — but it would
 * also hide this from the check, which first time round it duly did, passing
 * happily against the very code whose crash prompted it. So the throw is
 * caught here, where it can be reported, and `buildGeometry` is asked
 * separately whether real letters actually came out the other end.
 *
 * And the letters have to be in the face that was asked for. `shapesFor` falls
 * back to the bundled face when a chosen one gives nothing, which is right for
 * a reader and useless for a check: with that fallback in place, the crash
 * this file exists to catch came back as a silent substitution and the check
 * sat there saying all clear. So each fetched face also has to set ABC
 * differently from the bundled one. Two faces cannot draw the same letters at
 * the same size and still be two faces.
 *
 * The faces are fetched from the Google Fonts CDN, so this is the one check
 * that wants the network. Without it the fetched faces are reported as skipped
 * rather than failed: being offline is not a bug in the app.
 */
import { register } from 'node:module'

register('./resolve-extensionless.mjs', import.meta.url)

const { BUNDLED, FONT_CATALOGUE } = await import('../src/shapes/fonts/catalogue.js')
const { ensureFont, isFontReady } = await import('../src/shapes/fontStore.js')
const { buildGeometry } = await import('../src/shapes/geometryCache.js')
const { defaultParams, getShapeDef, normalizeParams } = await import('../src/shapes/index.js')

/**
 * Strings chosen for the ways they have gone wrong: ordinary words, letters
 * that hang below the line, the pairs that tempt a ligature, punctuation with
 * no outline of its own, whitespace only, and three alphabets no Latin face
 * has a glyph for.
 */
const STRINGS = [
  'ABC', 'Hello', 'gjpqy', 'fi ffl fl', '0123456789', 'Wi-Fi!', '()[]{}',
  'O o 0 @ #', 'Ünïcödé', '.', '|', ' ', '', 'мир', '日本', '💡',
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
]

let problems = 0
let skipped = 0
const fail = (message) => {
  console.log(`  BAD ${message}`)
  problems++
}

const base = defaultParams('text')

console.log('\nevery typeface can set every kind of string…')
for (const entry of FONT_CATALOGUE) {
  await ensureFont(entry.family)
  if (!isFontReady(entry.family)) {
    // Bundled faces are always there; a fetched one that is not means no
    // network, and the app's own fallback covers that case by design.
    if (!entry.url) fail(`${entry.family} is bundled and should always be ready`)
    else {
      console.log(`  --  ${entry.family} — could not be fetched, skipped`)
      skipped++
    }
    continue
  }

  const def = getShapeDef('text')
  let worst = null
  for (const text of STRINGS) {
    for (const edge of [0, 1.2]) {
      const params = { ...base, text, font: entry.family, edge }
      // Straight at the builder: this is what a render calls, and a throw here
      // is what used to unmount the app.
      try {
        def.build(normalizeParams('text', params))?.dispose?.()
      } catch (error) {
        worst ??= `${JSON.stringify(text)} threw — ${error.message}`
        continue
      }
      // And through the cache, which is what the rest of the app measures.
      const geometry = buildGeometry('text', params)
      const position = geometry.getAttribute('position')
      if (!position) worst ??= `${JSON.stringify(text)} came back with no vertex data`
      else {
        for (let i = 0; i < position.array.length; i++) {
          if (!Number.isFinite(position.array[i])) {
            worst ??= `${JSON.stringify(text)} came back with broken coordinates`
            break
          }
        }
      }
      const box = geometry.boundingBox
      if (!box || !Number.isFinite(box.min.y)) {
        worst ??= `${JSON.stringify(text)} has a box that cannot be measured`
      }
      // Latin letters must actually produce a solid. Without this, a face that
      // quietly returned nothing at all would look like a pass.
      if (text === 'ABC' && !(position?.count > 0)) {
        worst ??= 'ABC came out with nothing in it'
      }
      geometry.dispose()
    }
  }
  // Did it really set the letters, or quietly hand back the fallback face?
  if (!worst && entry.url) {
    const shape = (family) => {
      const g = buildGeometry('text', { ...base, text: 'ABC', font: family })
      const b = g.boundingBox
      const fingerprint = `${g.getAttribute('position')?.count}:${(b.max.x - b.min.x).toFixed(4)}:${(b.max.z - b.min.z).toFixed(4)}`
      g.dispose()
      return fingerprint
    }
    if (shape(entry.family) === shape(BUNDLED)) {
      worst = `ABC came out identical to ${BUNDLED} — the face was never used`
    }
  }

  if (worst) fail(`${entry.family}: ${worst}`)
  else console.log(`  ok  ${entry.family}`)
}

if (skipped) console.log(`\n${skipped} face${skipped === 1 ? '' : 's'} skipped — no network`)
console.log(problems ? `\n${problems} problem${problems === 1 ? '' : 's'}` : '\nall clear')
process.exit(problems ? 1 : 0)
