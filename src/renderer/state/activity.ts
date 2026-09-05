import type { ItemView } from './conversation';

export function commandText(item: ItemView): string {
  if (typeof item.command === 'string') return item.command;
  if (!Array.isArray(item.command)) return '';
  const args = item.command.filter((entry): entry is string => typeof entry === 'string');
  const shellFlag = args.findIndex((entry) => /^-[a-z]*c$/.test(entry));
  return shellFlag >= 0 ? args.slice(shellFlag + 1).join(' ') : args.join(' ');
}

export function activityTitle(item: ItemView): string {
  if (item.type === 'commandExecution') {
    const command = commandText(item).replace(/\s+/g, ' ').trim();
    return command ? `运行 ${command.length > 72 ? `${command.slice(0, 72)}…` : command}` : '命令执行';
  }
  if (item.type === 'fileChange') return '更新文件';
  if (item.type === 'webSearch') return '搜索网页';
  if (item.type === 'hookRun') return typeof item.statusMessage === 'string' ? item.statusMessage : '执行结束操作';
  if (typeof item.tool === 'string') return item.tool;
  return '工具活动';
}
