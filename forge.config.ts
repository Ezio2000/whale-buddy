import path from 'node:path';
import { existsSync, realpathSync } from 'node:fs';
import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { sidecarBundleResources } from './src/main/sidecar-layout';
import { codexFilename, forgeTargetPlatform } from './src/main/platform';

const targetPlatform = forgeTargetPlatform(process.argv);
const configuredSidecar = process.env.WHALE_CODEX_BIN;
const developmentSidecar = path.resolve(
  'codex-source',
  'codex-rs',
  'target',
  'release',
  codexFilename(targetPlatform),
);
const sidecar = configuredSidecar ?? developmentSidecar;
const canonicalSidecar = existsSync(sidecar) ? realpathSync.native(sidecar) : sidecar;
const isE2ePackage = process.env.WHALE_FORGE_OUT_DIR === 'out-e2e';

const config: ForgeConfig = {
  outDir: process.env.WHALE_FORGE_OUT_DIR ?? 'out',
  packagerConfig: {
    asar: true,
    appBundleId: isE2ePackage ? 'dev.whalebuddy.desktop.e2e' : 'dev.whalebuddy.desktop',
    ...(targetPlatform === 'darwin'
      ? { appCategoryType: 'public.app-category.developer-tools' }
      : {}),
    executableName: 'Whale Buddy',
    extraResource: isE2ePackage
      ? []
      : sidecarBundleResources(canonicalSidecar, existsSync, targetPlatform),
  },
  rebuildConfig: {},
  makers:
    targetPlatform === 'darwin'
      ? [new MakerDMG({}, ['darwin']), new MakerZIP({}, ['darwin'])]
      : [
          new MakerSquirrel({
            name: 'ai_xiaojing',
            authors: 'AI小鲸',
            description: 'AI小鲸 Codex 桌面客户端',
          }),
        ],
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
