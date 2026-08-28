import { accessSync, constants } from 'node:fs';
import path from 'node:path';
import type { DesktopPlatformStrategy } from '../contract';
import { windowsApplicationMenuTemplate } from './menu';

export const windowsPlatformStrategy: DesktopPlatformStrategy = {
  id: 'win32',
  codexFilename: 'codex.exe',
  codeModeHostFilename: 'codex-code-mode-host.exe',
  appUserModelId: 'dev.whalebuddy.desktop',
  quitWhenAllWindowsClosed: true,
  enforcesPrivateMode: false,
  executableFilename: (baseName) => `${baseName}.exe`,
  assertExecutable: (targetPath) => accessSync(targetPath, constants.F_OK),
  // userData inherits the current user's ACL; POSIX mode bits are not an ACL substitute.
  hardenPrivatePath: () => undefined,
  windowChromeOptions: () => ({}),
  packagedAppExecutable: (outRoot, productName, architecture) =>
    path.join(outRoot, `${productName}-win32-${architecture}`, `${productName}.exe`),
  applicationMenuTemplate: windowsApplicationMenuTemplate,
};
