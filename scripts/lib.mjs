import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { currentScriptPlatform } from './platform/index.mjs';

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const codexFilename = currentScriptPlatform.codexFilename;
export const codeModeHostFilename = currentScriptPlatform.codeModeHostFilename;

export function resolveCodexBinary() {
  const candidates = process.env.WHALE_CODEX_BIN
    ? [process.env.WHALE_CODEX_BIN]
    : [
        path.join(projectRoot, 'codex-source', 'codex-rs', 'target', 'release', codexFilename),
        path.join(projectRoot, 'codex-source', 'codex-rs', 'target', 'debug', codexFilename),
      ];

  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (!existsSync(resolved)) continue;
    try {
      currentScriptPlatform.assertExecutable(resolved);
      return realpathSync(resolved);
    } catch {
      // Continue to the next candidate so the final error is actionable.
    }
  }

  throw new Error(
    [
      '找不到可执行的 Codex sidecar。',
      '请先运行 `pnpm codex:build`，或设置 WHALE_CODEX_BIN 指向固定版本的 codex。',
      `已检查：${candidates.join(', ')}`,
    ].join('\n'),
  );
}

export function resolveCodeModeHostBinary(codexBinary) {
  const candidate = path.join(path.dirname(codexBinary), codeModeHostFilename);
  try {
    currentScriptPlatform.assertExecutable(candidate);
    return realpathSync(candidate);
  } catch {
    throw new Error(
      [
        `找不到可执行的 Codex Code Mode host：${candidate}`,
        '请运行 `pnpm codex:build`，确保 codex 与 codex-code-mode-host 成对构建。',
      ].join('\n'),
    );
  }
}
