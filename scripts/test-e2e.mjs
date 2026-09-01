import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { projectRoot } from './lib.mjs';
import { currentScriptPlatform as platform } from './platform/index.mjs';

const environment = {
  ...process.env,
  WHALE_FORGE_OUT_DIR: 'out-e2e',
  WHALE_TARGET_PLATFORM: platform.id,
};

run(['exec', 'electron-forge', 'package']);
run(['exec', 'playwright', 'test']);

function run(args) {
  const result = spawnSync(platform.pnpmCommand, args, {
    cwd: projectRoot,
    env: environment,
    stdio: 'inherit',
    // Node 安全修复后无 shell 直接执行 .cmd 会抛 EINVAL，Windows 需经 shell 解析。
    shell: platform.id === 'win32',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
