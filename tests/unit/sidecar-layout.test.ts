import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CODE_MODE_HOST_FILENAME,
  codeModeHostPathFor,
  sidecarBundleResources,
} from '../../src/main/sidecar-layout';
import {
  codeModeHostFilename,
  codexFilename,
  developmentCodexPaths,
  forgeTargetPlatform,
  packagedAppExecutable,
  packagedCodexPath,
  windowChromeOptions,
} from '../../src/main/platform';
import { windowInteractionStrategy } from '../../src/shared/window-strategy';

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
    expect(codexFilename('darwin')).toBe('codex');
    expect(codexFilename('win32')).toBe('codex.exe');
    expect(codeModeHostFilename('darwin')).toBe('codex-code-mode-host');
    expect(codeModeHostFilename('win32')).toBe('codex-code-mode-host.exe');
  });

  it('resolves development and packaged Windows sidecars without Unix assumptions', () => {
    expect(developmentCodexPaths('C:\\whale', 'win32')).toEqual([
      path.join('C:\\whale', 'codex-source', 'codex-rs', 'target', 'release', 'codex.exe'),
      path.join('C:\\whale', 'codex-source', 'codex-rs', 'target', 'debug', 'codex.exe'),
    ]);
    expect(packagedCodexPath('C:\\app\\resources', 'win32')).toBe(
      path.join('C:\\app\\resources', 'codex.exe'),
    );
    expect(codeModeHostPathFor('C:\\sidecar\\codex.exe', 'win32')).toBe(
      path.join(path.dirname('C:\\sidecar\\codex.exe'), 'codex-code-mode-host.exe'),
    );
  });

  it('keeps platform-specific chrome and package paths behind one adapter', () => {
    expect(windowInteractionStrategy('darwin')).toEqual({
      nativeTitleBar: false,
      rendererDragRegions: true,
    });
    expect(windowInteractionStrategy('win32')).toEqual({
      nativeTitleBar: true,
      rendererDragRegions: false,
    });
    expect(windowChromeOptions('darwin')).toMatchObject({ titleBarStyle: 'hiddenInset' });
    expect(windowChromeOptions('win32')).toEqual({});
    expect(packagedAppExecutable('/out', 'Whale Buddy', 'win32', 'x64')).toBe(
      path.join('/out', 'Whale Buddy-win32-x64', 'Whale Buddy.exe'),
    );
    expect(packagedAppExecutable('/out', 'Whale Buddy', 'darwin', 'arm64')).toBe(
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
