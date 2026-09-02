import type { BrowserWindow } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { platformStrategyFor } from '../../src/platform';
import { forgePlatformStrategy } from '../../src/platform/forge';
import { sandboxPlatformStrategyFor } from '../../src/platform/sandbox';

describe('desktop platform strategies', () => {
  it('keeps lifecycle and security behavior platform-owned', () => {
    const macos = platformStrategyFor('darwin');
    const windows = platformStrategyFor('win32');

    expect(macos).toMatchObject({
      appUserModelId: null,
      quitWhenAllWindowsClosed: false,
      enforcesPrivateMode: true,
    });
    expect(windows).toMatchObject({
      appUserModelId: 'dev.whalebuddy.desktop',
      quitWhenAllWindowsClosed: true,
      enforcesPrivateMode: false,
    });
  });

  it('keeps sandbox capabilities free from main-process strategy imports', () => {
    expect(sandboxPlatformStrategyFor('darwin')).toMatchObject({
      rendererDragRegions: true,
    });
    expect(sandboxPlatformStrategyFor('win32')).toMatchObject({
      rendererDragRegions: false,
    });
    expect(sandboxPlatformStrategyFor('win32').isAbsolutePath('C:\\workspace')).toBe(true);
    expect(sandboxPlatformStrategyFor('win32').isAbsolutePath('workspace')).toBe(false);
  });

  it('fully ad-hoc signs macOS packages without requiring a certificate', () => {
    const osxSign = forgePlatformStrategy('darwin').packagerConfig.osxSign;

    expect(osxSign).toMatchObject({
      identity: '-',
      identityValidation: false,
    });
    expect(typeof osxSign === 'object' && osxSign.optionsForFile?.('Whale Buddy.app')).toEqual({
      hardenedRuntime: false,
      timestamp: 'none',
    });
    expect(forgePlatformStrategy('win32').packagerConfig.osxSign).toBeUndefined();
  });

  it('builds only the native installer format for each platform', () => {
    expect(forgePlatformStrategy('darwin').makers).toHaveLength(1);
    expect(forgePlatformStrategy('darwin').makers[0].constructor.name).toBe('MakerDMG');
    expect(forgePlatformStrategy('win32').makers).toHaveLength(1);
    expect(forgePlatformStrategy('win32').makers[0].constructor.name).toBe('MakerSquirrel');
  });

  it('provides native menu topology from each platform implementation', () => {
    const window = {
      isDestroyed: () => false,
      isMaximized: () => false,
      maximize: vi.fn(),
      unmaximize: vi.fn(),
      webContents: { send: vi.fn() },
    } as unknown as BrowserWindow;
    const context = {
      window,
      brandName: 'AI小鲸',
      send: vi.fn(),
      showAboutPanel: vi.fn(),
    };

    expect(platformStrategyFor('darwin').applicationMenuTemplate(context).map((item) => item.label))
      .toEqual(['AI小鲸', '文件', '编辑', '视图', '窗口']);
    expect(platformStrategyFor('win32').applicationMenuTemplate(context).map((item) => item.label))
      .toEqual(['文件', '编辑', '视图', '窗口', '帮助']);
  });
});
