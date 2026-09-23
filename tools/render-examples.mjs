/**
 * Shoot the welcome screen's thumbnails:  `npm run shots`
 *
 * The cards on the welcome screen are renders of the builds themselves (see
 * src/ui/ExampleArt.jsx for why). This drives the real app in a real browser
 * and photographs each example, so a thumbnail is never a picture of something
 * the build stopped being.
 *
 * It needs two things that the app itself does not, which is why neither is a
 * dependency of this project:
 *
 *   - the dev server already running:  npm run dev
 *   - Playwright, and a Chrome to drive. It is not a dependency of this
 *     project, so either `npm i -D playwright` or point `PLAYWRIGHT_MODULE` at
 *     one you already have. Either way it drives the Chrome already installed
 *     rather than downloading a browser, so there is nothing to
 *     `playwright install`.
 *
 * Pass example ids to re-shoot only those:
 *
 *   node tools/render-examples.mjs dice wall-hook
 *
 * The camera is the app's own Corner view followed by its own Fit, so every
 * shot is framed the way the app frames things rather than by numbers made up
 * here. The panels are hidden with `visibility` rather than `display` on
 * purpose: nothing reflows, so the framing that was just settled on is still
 * the framing when the shutter goes.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'src/assets/examples')
const URL_ = 'http://localhost:5180/'

// An ESM import resolves against this file, not NODE_PATH, so a Playwright
// that only exists in an npx cache has to be pointed at outright.
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
  console.error('Playwright not found. Either:')
  console.error('  npm i -D playwright')
  console.error('or point at one you already have, such as an npx cache:')
  console.error('  PLAYWRIGHT_MODULE=$(echo ~/.npm/_npx/*/node_modules/playwright/index.mjs) \\')
  console.error('    node tools/render-examples.mjs')
  console.error('Either way it drives the Chrome already installed — nothing to download.')
  process.exit(1)
}

const source = fs.readFileSync(path.join(ROOT, 'src/examples/index.js'), 'utf8')
const all = [...source.matchAll(/id: '([^']+)',[\s\S]{0,160}?name: '([^']+)'/g)].map((m) => ({
  id: m[1],
  name: m[2],
}))
const only = process.argv.slice(2)
const items = only.length ? all.filter((i) => only.includes(i.id)) : all
if (!items.length) {
  console.error(only.length ? `no example matches ${only.join(', ')}` : 'no examples found')
  process.exit(1)
}

fs.mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
let problems = 0
console.log(`shooting ${items.length} example(s) into src/assets/examples`)

for (const { id, name } of items) {
  // 560 wide at one device pixel per CSS pixel: twice the width a card is ever
  // drawn at, which is enough for a retina screen and no more. These are
  // checked into the repo, so every kilobyte is one everybody clones.
  const page = await browser.newPage({ viewport: { width: 560, height: 480 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  try {
    await page.goto(URL_, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1300)
    await page.getByText(name, { exact: true }).click()
    await page.waitForTimeout(1800)
    await page.keyboard.press('Escape') // nothing selected, so no gizmo in shot
    await page.getByTitle('Corner view').click()
    await page.waitForTimeout(900)
    await page.getByTitle('Fit the whole build').click()
    await page.waitForTimeout(1400)

    await page.evaluate(() => {
      const canvas = document.querySelector('canvas')
      const keep = new Set()
      for (let e = canvas; e; e = e.parentElement) keep.add(e)
      document.querySelectorAll('body *').forEach((el) => {
        if (!keep.has(el) && !el.contains(canvas)) el.style.visibility = 'hidden'
      })
    })
    await page.waitForTimeout(400)
    await page
      .locator('canvas')
      .screenshot({ path: path.join(OUT, `${id}.jpg`), type: 'jpeg', quality: 82 })

    if (errors.length) {
      problems++
      console.log(`  BAD ${id}: ${errors.join(' | ')}`)
    } else {
      console.log(`  ${id}`)
    }
  } catch (error) {
    problems++
    console.log(`  BAD ${id}: ${error.message.split('\n')[0]}`)
  }
  await page.close()
}

await browser.close()
console.log(problems ? `\n${problems} problem(s)` : '\nall shot')
process.exitCode = problems ? 1 : 0
