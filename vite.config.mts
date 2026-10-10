import { defineConfig } from 'vitest/config';
import electron from 'vite-plugin-electron';

export default defineConfig({
  base: './',
  plugins: [
    electron([
      {
        entry: 'electron/main.ts',
        vite: { build: { outDir: 'dist-electron', emptyOutDir: false } },
      },
      {
        entry: 'electron/preload.ts',
        onstart(options) {
          options.reload();
        },
        vite: {
          build: {
            outDir: 'dist-electron',
            emptyOutDir: false,
            rollupOptions: { output: { format: 'cjs', entryFileNames: 'preload.js' } },
          },
        },
      },
    ]),
  ],
  build: { outDir: 'dist', chunkSizeWarningLimit: 2000 },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
