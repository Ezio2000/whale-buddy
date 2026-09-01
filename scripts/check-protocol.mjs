import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { projectRoot } from './lib.mjs';

const generatedRoot = path.join(projectRoot, 'src/generated/protocol');
const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'whale-protocol-'));
const backupRoot = path.join(temporaryRoot, 'checked-in');

try {
  cpSync(generatedRoot, backupRoot, { recursive: true });
  execFileSync(process.execPath, ['scripts/generate-protocol.mjs'], {
    cwd: projectRoot,
    stdio: 'inherit',
  });

  const previousFiles = directoryFiles(backupRoot);
  const generatedFiles = directoryFiles(generatedRoot);
  if (previousFiles.length !== generatedFiles.length) {
    throw new Error('协议文件数量发生变化');
  }
  for (let index = 0; index < previousFiles.length; index += 1) {
    const previous = previousFiles[index];
    const generated = generatedFiles[index];
    if (previous !== generated) throw new Error(`协议文件集合发生变化：${previous} / ${generated}`);
    if (!sameGeneratedFile(previous, backupRoot, generatedRoot)) {
      throw new Error(`协议文件发生漂移：${previous}`);
    }
  }

  const oldManifest = JSON.parse(readFileSync(path.join(backupRoot, 'manifest.json'), 'utf8'));
  const nextManifest = JSON.parse(readFileSync(path.join(generatedRoot, 'manifest.json'), 'utf8'));
  if (
    oldManifest.codexVersion !== nextManifest.codexVersion ||
    oldManifest.codexCommit !== nextManifest.codexCommit ||
    oldManifest.experimentalApi !== false
  ) {
    throw new Error('协议清单与固定 sidecar 版本不一致。请运行 pnpm protocol:generate 并提交结果。');
  }
  console.log('协议生成结果无漂移。');
} catch (error) {
  console.error(error?.stdout ?? (error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
} finally {
  rmSync(generatedRoot, { recursive: true, force: true });
  cpSync(backupRoot, generatedRoot, { recursive: true });
  rmSync(temporaryRoot, { recursive: true, force: true });
}

function directoryFiles(root, relative = '') {
  const files = [];
  for (const entry of readdirSync(path.join(root, relative), { withFileTypes: true })) {
    // 统一使用 posix 分隔符，避免 Windows 上 `json\X.json` 与 `json/X.json` 视为不同路径。
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...directoryFiles(root, child));
    else if (child !== 'manifest.json') files.push(child);
  }
  return files.sort();
}

// 协议产物对比需要跨平台归一化：JSON 按语义（键序无关）深度对比，
// 其余文件（TypeScript 等）在换行符归一为 LF 后按字节对比。
function sameGeneratedFile(relative, backupRoot, generatedRoot) {
  const previous = readFileSync(path.join(backupRoot, relative));
  const generated = readFileSync(path.join(generatedRoot, relative));
  if (relative.endsWith('.json')) {
    return jsonEquals(JSON.parse(previous.toString('utf8')), JSON.parse(generated.toString('utf8')));
  }
  return previous.toString('utf8').replace(/\r\n/g, '\n') ===
    generated.toString('utf8').replace(/\r\n/g, '\n');
}

function jsonEquals(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => jsonEquals(item, b[index]));
  }
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every(
    (key) => Object.hasOwn(b, key) && jsonEquals(a[key], b[key]),
  );
}
