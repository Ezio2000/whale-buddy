import type { MenuItemConstructorOptions } from 'electron';
import type { ApplicationMenuContext } from './contract';

export function commonFileMenuItems(
  send: ApplicationMenuContext['send'],
): MenuItemConstructorOptions[] {
  return [
    { label: '打开项目…', accelerator: 'CmdOrCtrl+O', click: () => send('open-project') },
    { label: '新建线程', accelerator: 'CmdOrCtrl+N', click: () => send('new-thread') },
    { type: 'separator' },
    { role: 'close', label: '关闭窗口' },
  ];
}

export function editMenu(): MenuItemConstructorOptions {
  return {
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
  };
}

export function viewMenu(send: ApplicationMenuContext['send']): MenuItemConstructorOptions {
  return {
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
  };
}
