/**
 * Redraw the line that names the site on the social card:
 *
 *   node tools/render-og.mjs
 *
 * `public/og.png` is the picture that turns up when somebody shares a link —
 * the logo, the headline, the shapes on their plate, and along the bottom a
 * row of swatches and the address. Everything but that last line is artwork
 * and stays as it is. The address is the one part that goes stale, and it
 * went stale: the card still said the GitHub Pages URL long after the site
 * had a name of its own.
 *
 * So this leaves the artwork alone and redraws the caption over it. Change
 * `SITE` below, run it, and the card says the right thing. It is a browser
 * doing the drawing, for one reason: the card is set in JetBrains Mono at a
 * size and colour that have to match what is already there, and the surest
 * way to match a web font is to use the same web font.
 *
 * Like `render-examples.mjs` it wants Playwright, which is not a dependency
 * of this project — `npm i -D playwright`, or point `PLAYWRIGHT_MODULE` at
 * one you already have. It drives the Chrome already installed.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CARD = path.join(ROOT, 'public/og.png')

/** What the card says the site is. The whole point of the file. */
const SITE = 'babycad.org'

/*
 * Measured off the card as it stands, so the new line lands exactly where the
 * old one was: the swatch row ends at x=202, the address began at x=220, its
 * ink sat between y=550 and y=567, and it was #626C86. The patch is cleared
 * to the shell colour, which that whole corner of the card already is.
 */
const CARD_W = 1200
const CARD_H = 630
const TEXT_X = 220
const BASELINE = 563
const FONT = 17
const INK = '#626C86'
const SHELL = '#0E1014'
const PATCH = { x: 212, y: 542, w: 400, h: 34 }

let chromium
for (const from of ['playwright', process.env.PLAYWRIGHT_MODULE].filter(Boolean)) {
  try {
    ;({ chromium } = await import(from))
    break
  } catch {
    /* try the next one */
  }
}
if (!chromium) {
  console.error('Playwright is needed for this: npm i -D playwright, or set PLAYWRIGHT_MODULE')
  process.exit(1)
}

const base = fs.readFileSync(CARD).toString('base64')
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage({ viewport: { width: CARD_W, height: CARD_H } })

await page.setContent(`<!doctype html>
<html><head>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
  html, body { margin: 0; background: ${SHELL}; }
  #card { position: relative; width: ${CARD_W}px; height: ${CARD_H}px; overflow: hidden; }
  #art { position: absolute; inset: 0; width: 100%; height: 100%; }
  #patch { position: absolute; left: ${PATCH.x}px; top: ${PATCH.y}px;
           width: ${PATCH.w}px; height: ${PATCH.h}px; background: ${SHELL}; }
  #site  { position: absolute; left: ${TEXT_X}px; top: ${BASELINE}px;
           font-family: 'JetBrains Mono', monospace; font-weight: 500;
           font-size: ${FONT}px; line-height: 0; color: ${INK}; white-space: pre; }
</style></head>
<body><div id="card">
  <img id="art" src="data:image/png;base64,${base}">
  <div id="patch"></div>
  <div id="site">${SITE}</div>
</div></body></html>`)

await page.evaluate(() => document.fonts.ready)
await page.waitForTimeout(250)

const width = await page.evaluate(() => document.getElementById('site').getBoundingClientRect().width)
await page.locator('#card').screenshot({ path: CARD })
await browser.close()

console.log(`og.png now says ${SITE} — ${Math.round(width)}px of it, from x=${TEXT_X}`)
