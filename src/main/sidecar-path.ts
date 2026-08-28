import { existsSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { app } from 'electron';
import protocolManifest from '../generated/protocol/manifest.json';
import { currentPlatformStrategy } from '../platform';
import { codeModeHostPathFor } from './sidecar-layout';

const platform = currentPlatformStrategy();

export interface ResolvedSidecar {
  path: string;
  codeModeHostPath: string;
  version: string;
  arguments: string[];
  environment: NodeJS.ProcessEnv;
}

export function resolveSidecarPath(projectRoot: string): ResolvedSidecar {
  const testScript = process.env.WHALE_E2E_CODEX_SCRIPT;
  if (testScript) return resolveElectronNodeScript(testScript);

  if (!app.isPackaged && !process.env.WHALE_CODEX_BIN) {
    const submoduleHead = execFileSync(
      'git',
      ['-C', path.join(projectRoot, 'codex-source'), 'rev-parse', 'HEAD'],
      { encoding: 'utf8', timeout: 5_000, windowsHide: true },
    ).trim();
    if (submoduleHead !== protocolManifest.codexCommit) {
      throw new Error(
        'codex-source 提交与生成协议不一致。请运行 pnpm protocol:generate 后再启动。',
      );
    }
  }
  const candidates = process.env.WHALE_CODEX_BIN
    ? [process.env.WHALE_CODEX_BIN]
    : [
        app.isPackaged ? path.join(process.resourcesPath, platform.codexFilename) : undefined,
        path.join(projectRoot, 'codex-source', 'codex-rs', 'target', 'release', platform.codexFilename),
        path.join(projectRoot, 'codex-source', 'codex-rs', 'target', 'debug', platform.codexFilename),
      ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    const absolute = path.resolve(candidate);
    if (!existsSync(absolute)) continue;
    try {
      platform.assertExecutable(absolute);
      const canonical = realpathSync.native(absolute);
      const version = execFileSync(canonical, ['--version'], {
        encoding: 'utf8',
        timeout: 5_000,
        windowsHide: true,
      }).trim();
      if (version !== protocolManifest.codexVersion) {
        throw new Error(
          `sidecar 版本为 ${version}，生成协议版本为 ${protocolManifest.codexVersion}。请运行 pnpm protocol:generate。`,
        );
      }
      const codeModeHostPath = realpathSync.native(codeModeHostPathFor(canonical));
      platform.assertExecutable(codeModeHostPath);
      return { path: canonical, codeModeHostPath, version, arguments: [], environment: {} };
    } catch (error) {
      if (error instanceof Error && error.message.includes('生成协议版本')) throw error;
    }
  }
  throw new Error(
    '找不到完整且与协议匹配的 Codex sidecar。请先运行 pnpm codex:build && pnpm protocol:generate；' +
      'codex-code-mode-host 必须与 codex 位于同一目录。',
  );
}

function resolveElectronNodeScript(scriptPath: string): ResolvedSidecar {
  const canonicalScript = realpathSync.native(path.resolve(scriptPath));
  const environment = { ELECTRON_RUN_AS_NODE: '1' };
  const version = execFileSync(process.execPath, [canonicalScript, '--version'], {
    encoding: 'utf8',
    timeout: 5_000,
    env: { ...process.env, ...environment },
    windowsHide: true,
  }).trim();
  if (version !== protocolManifest.codexVersion) {
    throw new Error(
      `测试 sidecar 版本为 ${version}，生成协议版本为 ${protocolManifest.codexVersion}。`,
    );
  }
  return {
    path: process.execPath,
    codeModeHostPath: canonicalScript,
    version,
    arguments: [canonicalScript],
    environment,
  };
}
