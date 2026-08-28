import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { projectRoot } from './lib.mjs';
import { currentScriptPlatform as platform } from './platform/index.mjs';

const mode = process.argv[2] ?? 'run';
const productName = 'Whale Buddy';
const packageRoot = path.join(
  projectRoot,
  'out',
  `${productName}-${platform.id}-${process.arch}`,
);
const executable = platform.packagedAppExecutable(packageRoot, productName);

if (!['run', 'verify'].includes(mode)) {
  throw new Error('usage: pnpm app:run 或 pnpm app:verify');
}

platform.stopApplication(productName);
run(platform.pnpmCommand, ['build']);
if (!existsSync(executable)) throw new Error(`找不到打包后的应用：${executable}`);

const launched = platform.launchApplication(packageRoot, productName);
await waitForSpawn(launched);

if (mode === 'run') {
  launched.unref();
  process.exit(0);
}

await new Promise((resolve) => setTimeout(resolve, 1_500));
platform.verifyApplication(launched, productName);
launched.unref();
console.log(`${productName} 已在 ${platform.id}-${process.arch} 启动并保持运行`);

function run(command, args) {
  const result = spawnSync(command, args, { cwd: projectRoot, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function waitForSpawn(child) {
  return new Promise((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
}
