import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CODE_MODE_HOST_FILENAME,
  codeModeHostPathFor,
  sidecarBundleResources,
} from '../../src/main/sidecar-layout';
import { forgeTargetPlatform, platformStrategyFor } from '../../src/platform';
import { sandboxPlatformStrategyFor } from '../../src/platform/sandbox';

describe('sidecar bundle layout', () => {
  it('keeps the Code Mode host beside the Codex executable', () => {
    const codexPath = path.join('/opt', 'whale', 'codex');
    const hostPath = path.join('/opt', 'whale', CODE_MODE_HOST_FILENAME);
    const existing = new Set([codexPath, hostPath]);

    expect(codeModeHostPathFor(codexPath)).toBe(hostPath);
    expect(sidecarBundleResources(codexPath, (candidate) => existing.has(candidate))).toEqual([
      codexPath,
      hostPath,
    ]);
  });

  it('fails packaging when Codex exists without its Code Mode host', () => {
    const codexPath = path.join('/opt', 'whale', 'codex');

    expect(() => sidecarBundleResources(codexPath, (candidate) => candidate === codexPath)).toThrow(
      'Codex Code Mode host 缺失',
    );
  });

  it('fails packaging instead of producing an installable app without a sidecar', () => {
    expect(() => sidecarBundleResources('/missing/codex', () => false)).toThrow(
      'Codex sidecar 缺失',
    );
  });

  it('uses native executable names for macOS and Windows', () => {
    expect(platformStrategyFor('darwin').codexFilename).toBe('codex');
    expect(platformStrategyFor('win32').codexFilename).toBe('codex.exe');
    expect(platformStrategyFor('darwin').codeModeHostFilename).toBe('codex-code-mode-host');
    expect(platformStrategyFor('win32').codeModeHostFilename).toBe('codex-code-mode-host.exe');
  });

  it('resolves the Windows Code Mode host without Unix filename assumptions', () => {
    expect(codeModeHostPathFor('C:\\sidecar\\codex.exe', 'win32')).toBe(
      path.join(path.dirname('C:\\sidecar\\codex.exe'), 'codex-code-mode-host.exe'),
    );
  });

  it('keeps platform-specific chrome and package paths behind one adapter', () => {
    const macos = platformStrategyFor('darwin');
    const windows = platformStrategyFor('win32');
    expect(sandboxPlatformStrategyFor('darwin').isAbsolutePath('/repo')).toBe(true);
    expect(sandboxPlatformStrategyFor('win32').isAbsolutePath('C:\\repo')).toBe(true);
    expect(sandboxPlatformStrategyFor('darwin').rendererDragRegions).toBe(true);
    expect(sandboxPlatformStrategyFor('win32').rendererDragRegions).toBe(false);
    expect(macos.windowChromeOptions()).toMatchObject({ titleBarStyle: 'hiddenInset' });
    expect(windows.windowChromeOptions()).toEqual({});
    expect(windows.packagedAppExecutable('/out', 'Whale Buddy', 'x64')).toBe(
      path.join('/out', 'Whale Buddy-win32-x64', 'Whale Buddy.exe'),
    );
    expect(macos.packagedAppExecutable('/out', 'Whale Buddy', 'arm64')).toBe(
      path.join(
        '/out',
        'Whale Buddy-darwin-arm64',
        'Whale Buddy.app',
        'Contents',
        'MacOS',
        'Whale Buddy',
      ),
    );
  });

  it('takes Forge cross-package targets from either CLI form or the explicit override', () => {
    expect(forgeTargetPlatform(['package', '--platform=win32'], {}, 'darwin')).toBe('win32');
    expect(forgeTargetPlatform(['package', '--platform', 'win32'], {}, 'darwin')).toBe('win32');
    expect(
      forgeTargetPlatform(['package', '--platform=darwin'], { WHALE_TARGET_PLATFORM: 'win32' }, 'darwin'),
    ).toBe('win32');
  });
});
