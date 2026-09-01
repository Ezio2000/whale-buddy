import { accessSync, constants } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';

export const windowsScriptPlatform = {
  id: 'win32',
  pnpmCommand: 'pnpm.cmd',
  // Node 安全修复后无 shell 直接执行 .cmd 会抛 EINVAL，pnpm 需经 shell 解析。
  pnpmShell: true,
  codexFilename: 'codex.exe',
  codeModeHostFilename: 'codex-code-mode-host.exe',
  assertExecutable: (targetPath) => accessSync(targetPath, constants.F_OK),
  packagedAppExecutable: (packageRoot, productName) =>
    path.join(packageRoot, `${productName}.exe`),
  launchApplication: (packageRoot, productName) =>
    spawn(path.join(packageRoot, `${productName}.exe`), [], {
      detached: true,
      stdio: 'ignore',
    }),
  verifyApplication: (launched, productName) => {
    if (launched.exitCode !== null) {
      throw new Error(`${productName} 启动后已退出，退出码 ${launched.exitCode}`);
    }
  },
  stopApplication: (productName) => {
    spawnSync('taskkill.exe', ['/IM', `${productName}.exe`, '/T', '/F'], { stdio: 'ignore' });
  },
};
