import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import {
  projectRoot,
  resolveCodeModeHostBinary,
  resolveCodexBinary,
} from '../../lib.mjs';
import { currentScriptPlatform } from '../index.mjs';

const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'whale-win-layout-'));
const outputRoot = path.join(projectRoot, 'out-platform-check');
const sourceCodex = resolveCodexBinary();
const sourceHost = resolveCodeModeHostBinary(sourceCodex);
const testCodex = path.join(temporaryRoot, 'codex.exe');
const testHost = path.join(temporaryRoot, 'codex-code-mode-host.exe');

try {
  cpSync(sourceCodex, testCodex);
  cpSync(sourceHost, testHost);
  rmSync(outputRoot, { recursive: true, force: true });
  const result = spawnSync(
    currentScriptPlatform.pnpmCommand,
    ['exec', 'electron-forge', 'package', '--platform=win32', '--arch=x64'],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        WHALE_CODEX_BIN: testCodex,
        WHALE_FORGE_OUT_DIR: 'out-platform-check',
      },
      stdio: 'inherit',
      // Node 安全修复后无 shell 直接执行 .cmd 会抛 EINVAL，Windows 需经 shell 解析。
      shell: true,
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);

  const packageRoot = path.join(outputRoot, 'Whale Buddy-win32-x64');
  const expected = [
    path.join(packageRoot, 'Whale Buddy.exe'),
    path.join(packageRoot, 'resources', 'app.asar'),
    path.join(packageRoot, 'resources', 'codex.exe'),
    path.join(packageRoot, 'resources', 'codex-code-mode-host.exe'),
  ];
  const missing = expected.filter((candidate) => !existsSync(candidate));
  if (missing.length) throw new Error(`Windows 包结构缺失：${missing.join(', ')}`);
  console.log('Windows x64 包结构检查通过（应用、codex.exe 与 Code Mode host 均已就位）。');
} finally {
  rmSync(outputRoot, { recursive: true, force: true });
  rmSync(temporaryRoot, { recursive: true, force: true });
}
