import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const allowedRoots = ['src/platform/', 'scripts/platform/'];
const checkedExtensions = new Set(['.ts', '.tsx', '.mjs']);
const forbidden = [
  { label: 'direct process platform access', pattern: /process\.platform/ },
  { label: 'raw Node platform type', pattern: /NodeJS\.Platform/ },
  { label: 'raw Windows platform literal', pattern: /(['"])win32\1/ },
  { label: 'raw macOS platform literal', pattern: /(['"])darwin\1/ },
  { label: 'platform-specific access mode', pattern: /constants\.(?:F_OK|X_OK)/ },
];

const candidates = [
  ...walk(path.join(projectRoot, 'src')),
  ...walk(path.join(projectRoot, 'scripts')),
  path.join(projectRoot, 'forge.config.ts'),
];
const violations = [];

for (const filename of candidates) {
  if (!checkedExtensions.has(path.extname(filename))) continue;
  const relative = path.relative(projectRoot, filename).split(path.sep).join('/');
  if (relative === 'scripts/check-platform-boundary.mjs') continue;
  if (allowedRoots.some((root) => relative.startsWith(root))) continue;
  const lines = readFileSync(filename, 'utf8').split('\n');
  for (const [index, line] of lines.entries()) {
    for (const rule of forbidden) {
      if (rule.pattern.test(line)) violations.push(`${relative}:${index + 1} ${rule.label}`);
    }
  }
}

if (violations.length > 0) {
  throw new Error(`平台差异越过策略目录边界：\n${violations.join('\n')}`);
}

console.log('平台边界检查通过：平台差异仅存在于 macOS/Windows 策略目录。');

function walk(root) {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(root, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  });
}
