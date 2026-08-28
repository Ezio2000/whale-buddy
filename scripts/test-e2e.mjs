import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { projectRoot } from './lib.mjs';

const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const environment = {
  ...process.env,
  WHALE_FORGE_OUT_DIR: 'out-e2e',
  WHALE_TARGET_PLATFORM: process.platform,
};

run(['exec', 'electron-forge', 'package']);
run(['exec', 'playwright', 'test']);

function run(args) {
  const result = spawnSync(pnpm, args, {
    cwd: projectRoot,
    env: environment,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
