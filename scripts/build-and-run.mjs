import { existsSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { projectRoot } from './lib.mjs';

const mode = process.argv[2] ?? 'run';
const productName = 'Whale Buddy';
const packageRoot = path.join(
  projectRoot,
  'out',
  `${productName}-${process.platform}-${process.arch}`,
);
const appBundle = path.join(packageRoot, `${productName}.app`);
const executable =
  process.platform === 'darwin'
    ? path.join(appBundle, 'Contents', 'MacOS', productName)
    : path.join(packageRoot, `${productName}.exe`);

if (process.platform !== 'darwin' && process.platform !== 'win32') {
  throw new Error(`AI小鲸目前只支持 macOS 和 Windows，当前平台为 ${process.platform}`);
}
if (!['run', 'verify'].includes(mode)) {
  throw new Error('usage: pnpm app:run 或 pnpm app:verify');
}

stopExistingApplication();
run(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', ['build']);
if (!existsSync(executable)) throw new Error(`找不到打包后的应用：${executable}`);

const launched =
  process.platform === 'darwin'
    ? spawn('/usr/bin/open', ['-n', appBundle], { stdio: 'ignore' })
    : spawn(executable, [], { detached: true, stdio: 'ignore' });
await waitForSpawn(launched);

if (mode === 'run') {
  launched.unref();
  process.exit(0);
}

await new Promise((resolve) => setTimeout(resolve, 1_500));
if (process.platform === 'darwin') {
  const status = spawnSync('pgrep', ['-x', productName], { stdio: 'ignore' });
  if (status.status !== 0) throw new Error(`${productName} 启动后未保持运行`);
} else if (launched.exitCode !== null) {
  throw new Error(`${productName} 启动后已退出，退出码 ${launched.exitCode}`);
}
launched.unref();
console.log(`${productName} 已在 ${process.platform}-${process.arch} 启动并保持运行`);

function stopExistingApplication() {
  if (process.platform === 'darwin') {
    spawnSync('pkill', ['-x', productName], { stdio: 'ignore' });
    return;
  }
  spawnSync('taskkill.exe', ['/IM', `${productName}.exe`, '/T', '/F'], { stdio: 'ignore' });
}

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
