import { app, Menu, type BrowserWindow, type MenuItemConstructorOptions } from 'electron';
import { IPC } from '../shared/ipc';
import type { MenuCommand } from '../shared/types';

export function installApplicationMenu(
  window: BrowserWindow,
  brandName: string,
  platform: NodeJS.Platform = process.platform,
): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate(applicationMenuTemplate(window, brandName, platform)));
}

export function applicationMenuTemplate(
  window: BrowserWindow,
  brandName: string,
  platform: NodeJS.Platform = process.platform,
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

  const template: MenuItemConstructorOptions[] = [];
  if (platform === 'darwin') {
    template.push({
      label: brandName,
      submenu: [
        { role: 'about', label: `关于 ${brandName}` },
        { type: 'separator' },
        { role: 'hide', label: `隐藏 ${brandName}` },
        { role: 'hideOthers', label: '隐藏其他' },
        { role: 'unhide', label: '全部显示' },
        { type: 'separator' },
        { role: 'quit', label: `退出 ${brandName}` },
      ],
    });
  }

  template.push(
    {
      label: '文件',
      submenu: [
        { label: '打开项目…', accelerator: 'CmdOrCtrl+O', click: () => send('open-project') },
        { label: '新建线程', accelerator: 'CmdOrCtrl+N', click: () => send('new-thread') },
        { type: 'separator' },
        { role: 'close', label: '关闭窗口' },
        ...(platform === 'darwin'
          ? []
          : [
              { type: 'separator' as const },
              { role: 'quit' as const, label: `退出 ${brandName}` },
            ]),
      ],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { label: '命令面板', accelerator: 'CmdOrCtrl+K', click: () => send('command-palette') },
        {
          label: '切换 Diff 面板',
          accelerator: 'CmdOrCtrl+Shift+D',
          click: () => send('toggle-diff'),
        },
        { type: 'separator' },
        { role: 'reload', label: '重新载入' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { role: 'togglefullscreen', label: '切换全屏' },
      ],
    },
    {
      label: '窗口',
      submenu:
        platform === 'darwin'
          ? [
              { role: 'minimize', label: '最小化' },
              { role: 'zoom', label: '缩放' },
              { role: 'front', label: '前置全部窗口' },
            ]
          : [
              { role: 'minimize', label: '最小化' },
              {
                label: '最大化',
                click: () => (window.isMaximized() ? window.unmaximize() : window.maximize()),
              },
              { role: 'close', label: '关闭窗口' },
            ],
    },
  );

  if (platform !== 'darwin') {
    template.push({
      label: '帮助',
      submenu: [{ label: `关于 ${brandName}`, click: () => app.showAboutPanel() }],
    });
  }
  return template;
}
