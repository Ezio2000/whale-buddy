import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { "@whale-buddy/plugin-sdk/ui": fileURLToPath(new URL("./packages/plugin-sdk/src/ui.ts", import.meta.url)) } },
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    exclude: ['tests/e2e/**'],
    coverage: {
      reporter: ['text', 'html'],
    },
  },
});
