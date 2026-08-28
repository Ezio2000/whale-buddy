import type { MenuItemConstructorOptions } from 'electron';
import type { ApplicationMenuContext } from '../contract';
import { commonFileMenuItems, editMenu, viewMenu } from '../menu-common';

export function macosApplicationMenuTemplate({
  brandName,
  send,
}: ApplicationMenuContext): MenuItemConstructorOptions[] {
  return [
    {
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
    },
    {
      label: '文件',
      submenu: commonFileMenuItems(send),
    },
    editMenu(),
    viewMenu(send),
    {
      label: '窗口',
      submenu: [
        { role: 'minimize', label: '最小化' },
        { role: 'zoom', label: '缩放' },
        { role: 'front', label: '前置全部窗口' },
      ],
    },
  ];
}
