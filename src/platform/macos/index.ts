import { accessSync, chmodSync, constants } from 'node:fs';
import path from 'node:path';
import type { DesktopPlatformStrategy } from '../contract';
import { macosApplicationMenuTemplate } from './menu';

export const macosPlatformStrategy: DesktopPlatformStrategy = {
  id: 'darwin',
  codexFilename: 'codex',
  codeModeHostFilename: 'codex-code-mode-host',
  appUserModelId: null,
  quitWhenAllWindowsClosed: false,
  enforcesPrivateMode: true,
  executableFilename: (baseName) => baseName,
  assertExecutable: (targetPath) => accessSync(targetPath, constants.X_OK),
  hardenPrivatePath: (targetPath, mode) => chmodSync(targetPath, mode),
  windowChromeOptions: () => ({
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 18 },
  }),
  packagedAppExecutable: (outRoot, productName, architecture) =>
    path.join(
      outRoot,
      `${productName}-darwin-${architecture}`,
      `${productName}.app`,
      'Contents',
      'MacOS',
      productName,
    ),
  applicationMenuTemplate: macosApplicationMenuTemplate,
};
