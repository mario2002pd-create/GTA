import { defineConfig } from 'vite';

// `base: './'` para que el build funcione en GitHub Pages bajo /<repo>/.
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1500,
  },
});
