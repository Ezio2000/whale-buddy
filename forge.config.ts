import path from 'node:path';
import { existsSync, realpathSync } from 'node:fs';
import type { ForgeConfig } from '@electron-forge/shared-types';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { sidecarBundleResources } from './src/main/sidecar-layout';
import { forgePlatformStrategy } from './src/platform/forge';
import { forgeTargetPlatform, platformStrategyFor } from './src/platform';

const targetPlatform = forgeTargetPlatform(process.argv);
const platform = platformStrategyFor(targetPlatform);
const forgePlatform = forgePlatformStrategy(targetPlatform);
const configuredSidecar = process.env.WHALE_CODEX_BIN;
const developmentSidecar = path.resolve(
  'codex-source',
  'codex-rs',
  'target',
  'release',
  platform.codexFilename,
);
const sidecar = configuredSidecar ?? developmentSidecar;
const canonicalSidecar = existsSync(sidecar) ? realpathSync.native(sidecar) : sidecar;
const isE2ePackage = process.env.WHALE_FORGE_OUT_DIR === 'out-e2e';

const config: ForgeConfig = {
  outDir: process.env.WHALE_FORGE_OUT_DIR ?? 'out',
  packagerConfig: {
    asar: true,
    appBundleId: isE2ePackage ? 'dev.whalebuddy.desktop.e2e' : 'dev.whalebuddy.desktop',
    ...forgePlatform.packagerConfig,
    executableName: 'Whale Buddy',
    extraResource: isE2ePackage
      ? []
      : sidecarBundleResources(canonicalSidecar, existsSync, targetPlatform),
  },
  rebuildConfig: {},
  makers: forgePlatform.makers,
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: 'src/main.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/preload.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts',
        },
      ],
    }),
  ],
};

export default config;
