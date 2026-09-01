import { accessSync, constants } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';

export const macosScriptPlatform = {
  id: 'darwin',
  pnpmCommand: 'pnpm',
  pnpmShell: false,
  codexFilename: 'codex',
  codeModeHostFilename: 'codex-code-mode-host',
  assertExecutable: (targetPath) => accessSync(targetPath, constants.X_OK),
  packagedAppExecutable: (packageRoot, productName) =>
    path.join(packageRoot, `${productName}.app`, 'Contents', 'MacOS', productName),
  launchApplication: (packageRoot, productName) =>
    spawn('/usr/bin/open', ['-n', path.join(packageRoot, `${productName}.app`)], {
      stdio: 'ignore',
    }),
  verifyApplication: (_launched, productName) => {
    const status = spawnSync('pgrep', ['-x', productName], { stdio: 'ignore' });
    if (status.status !== 0) throw new Error(`${productName} 启动后未保持运行`);
  },
  stopApplication: (productName) => {
    spawnSync('pkill', ['-x', productName], { stdio: 'ignore' });
  },
};
