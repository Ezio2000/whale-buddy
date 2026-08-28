import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const pluginRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: path.join(pluginRoot, 'ui-src'),
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@whale-buddy/plugin-sdk': path.resolve(
        pluginRoot,
        '../../../../packages/plugin-sdk/src/index.ts',
      ),
    },
  },
  build: {
    outDir: path.join(pluginRoot, 'ui'),
    emptyOutDir: true,
    sourcemap: false,
  },
});
