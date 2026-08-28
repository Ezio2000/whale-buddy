import { existsSync } from 'node:fs';
import path from 'node:path';
import { codeModeHostFilename } from './platform';

export const CODE_MODE_HOST_FILENAME = codeModeHostFilename();

export function codeModeHostPathFor(
  codexPath: string,
  platform: NodeJS.Platform = process.platform,
): string {
  return path.join(path.dirname(codexPath), codeModeHostFilename(platform));
}

export function sidecarBundleResources(
  codexPath: string,
  pathExists: (candidate: string) => boolean = existsSync,
  platform: NodeJS.Platform = process.platform,
): string[] {
  if (!pathExists(codexPath)) {
    throw new Error(
      `Codex sidecar 缺失：${codexPath}。` +
        '请运行 pnpm codex:build，或设置 WHALE_CODEX_BIN 指向当前平台的有效二进制。',
    );
  }

  const codeModeHostPath = codeModeHostPathFor(codexPath, platform);
  if (!pathExists(codeModeHostPath)) {
    throw new Error(
      `Codex Code Mode host 缺失：${codeModeHostPath}。` +
        '请运行 pnpm codex:build，确保 codex 与 codex-code-mode-host 成对构建。',
    );
  }

  return [codexPath, codeModeHostPath];
}
