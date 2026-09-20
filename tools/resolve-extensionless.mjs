/**
 * Node resolve hook that accepts the extensionless imports the app uses.
 *
 * Vite resolves `./params` to `./params.js` for us in the browser; plain Node
 * does not, so running any of the shape code under Node needs this. It exists
 * only so `tools/check-shapes.mjs` can import the real builders rather than a
 * copy of them.
 */
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context)
  } catch (error) {
    if (specifier.startsWith('.') || specifier.startsWith('/')) {
      const base = new URL(specifier, context.parentURL)
      for (const suffix of ['.js', '.jsx', '/index.js']) {
        const candidate = new URL(base.href + suffix)
        if (existsSync(fileURLToPath(candidate))) return next(candidate.href, context)
      }
    }
    throw error
  }
}
