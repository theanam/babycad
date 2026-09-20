import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Relative base so the same bundle works on a GitHub Pages project site
// (user.github.io/babycad/) without hardcoding the repo name.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { outDir: 'dist', sourcemap: false },
})
