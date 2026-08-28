import { app, Menu, type BrowserWindow, type MenuItemConstructorOptions } from 'electron';
import { currentPlatformStrategy, type DesktopPlatformStrategy } from '../platform';
import { IPC } from '../shared/ipc';
import type { MenuCommand } from '../shared/types';

export function installApplicationMenu(
  window: BrowserWindow,
  brandName: string,
  platform: DesktopPlatformStrategy = currentPlatformStrategy(),
): void {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate(applicationMenuTemplate(window, brandName, platform)),
  );
}

export function applicationMenuTemplate(
  window: BrowserWindow,
  brandName: string,
  platform: DesktopPlatformStrategy = currentPlatformStrategy(),
): MenuItemConstructorOptions[] {
  const send = (command: MenuCommand) => {
    if (window.isDestroyed()) return;
    window.webContents.send(IPC.event, {
      kind: 'runtime',
      generation: 0,
      sequence: Date.now(),
      event: { type: 'menu', command },
    });
  };

  return platform.applicationMenuTemplate({
    window,
    brandName,
    send,
    showAboutPanel: () => app.showAboutPanel(),
  });
}
