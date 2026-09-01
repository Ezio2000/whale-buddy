import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
const pluginRoot = path.dirname(fileURLToPath(import.meta.url));
export default defineConfig({
  root: path.join(pluginRoot, 'ui-src'), base: './', plugins: [react()],
  resolve: { alias: {
    '@whale-buddy/plugin-sdk/ui': path.resolve(pluginRoot, '../../../../packages/plugin-sdk/src/ui.ts'),
    '@whale-buddy/plugin-sdk/runtime': path.resolve(pluginRoot, '../../../../packages/plugin-sdk/src/runtime.ts'),
  } },
  build: { outDir: path.join(pluginRoot, 'ui'), emptyOutDir: true, sourcemap: false },
});
