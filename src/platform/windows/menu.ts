import type { MenuItemConstructorOptions } from 'electron';
import type { ApplicationMenuContext } from '../contract';
import { commonFileMenuItems, editMenu, viewMenu } from '../menu-common';

export function windowsApplicationMenuTemplate({
  window,
  brandName,
  send,
  showAboutPanel,
}: ApplicationMenuContext): MenuItemConstructorOptions[] {
  return [
    {
      label: '文件',
      submenu: [
        ...commonFileMenuItems(send),
        { type: 'separator' },
        { role: 'quit', label: `退出 ${brandName}` },
      ],
    },
    editMenu(),
    viewMenu(send),
    {
      label: '窗口',
      submenu: [
        { role: 'minimize', label: '最小化' },
        {
          label: '最大化',
          click: () => (window.isMaximized() ? window.unmaximize() : window.maximize()),
        },
        { role: 'close', label: '关闭窗口' },
      ],
    },
    {
      label: '帮助',
      submenu: [{ label: `关于 ${brandName}`, click: showAboutPanel }],
    },
  ];
}
