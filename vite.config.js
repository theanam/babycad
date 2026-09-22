import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Google Analytics, on the published site and nowhere else.
 *
 * The tag is not in `index.html`, because that file is what `npm run dev`
 * serves and what anyone building this themselves gets: a tag sitting there
 * would count every local reload and would follow any fork that never asked
 * for it. Instead it is injected into the built HTML only when `ANALYTICS=1`,
 * which the Pages workflow sets on its build step and nothing else does.
 *
 * `apply: 'build'` is the second lock: even with the variable exported in a
 * shell, the dev server will not inject it.
 */
const GA_ID = 'G-3830NKM98L'

const analytics = () => ({
  name: 'babycad-analytics',
  apply: 'build',
  transformIndexHtml: {
    order: 'pre',
    handler: (html) => {
      if (process.env.ANALYTICS !== '1') return html
      return {
        html,
        tags: [
          {
            tag: 'script',
            attrs: { async: true, src: `https://www.googletagmanager.com/gtag/js?id=${GA_ID}` },
            injectTo: 'head',
          },
          {
            tag: 'script',
            children: [
              'window.dataLayer = window.dataLayer || [];',
              'function gtag(){dataLayer.push(arguments);}',
              "gtag('js', new Date());",
              `gtag('config', '${GA_ID}');`,
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
