import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Google Analytics, for whoever is doing the publishing — and nobody else.
 *
 * No measurement ID appears anywhere in this repository. The ID is handed in
 * through `ANALYTICS_ID` at build time, and with nothing in that variable this
 * plugin does nothing at all. That is what keeps the arrangement fair to
 * everyone downstream:
 *
 *   - `npm run dev` and a plain `npm run build` are untagged, so nobody's local
 *     pottering is counted.
 *   - Someone who downloads the source gets no tag, because there is no ID here
 *     to find.
 *   - A fork that turns Pages on builds its own untagged site: the workflow
 *     only supplies an ID when it is running on the original repository, so a
 *     fork's visitors can never be counted into somebody else's property.
 *   - Anyone who wants their own analytics sets their own ID, in their own
 *     workflow. This file needs no editing to do it.
 *
 * `apply: 'build'` is a second lock on the first of those: even with the
 * variable exported in a shell, the dev server will not inject anything.
 */
const analytics = () => ({
  name: 'babycad-analytics',
  apply: 'build',
  transformIndexHtml: {
    order: 'pre',
    handler: (html) => {
      const id = (process.env.ANALYTICS_ID ?? '').trim()
      if (!id) return html
      return {
        html,
        tags: [
          {
            tag: 'script',
            attrs: { async: true, src: `https://www.googletagmanager.com/gtag/js?id=${id}` },
            injectTo: 'head',
          },
          {
            tag: 'script',
            children: [
              'window.dataLayer = window.dataLayer || [];',
              'function gtag(){dataLayer.push(arguments);}',
              "gtag('js', new Date());",
              `gtag('config', '${id}');`,
            ].join('\n'),
            injectTo: 'head',
          },
        ],
      }
    },
  },
})

// Relative base so the same bundle works on a GitHub Pages project site
// (user.github.io/babycad/) without hardcoding the repo name.
export default defineConfig({
  base: './',
  plugins: [react(), analytics()],
  build: { outDir: 'dist', sourcemap: false },
})
