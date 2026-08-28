export type SlashCommandName =
  | 'new'
  | 'resume'
  | 'fork'
  | 'rename'
  | 'archive'
  | 'delete'
  | 'model'
  | 'permissions'
  | 'review'
  | 'compact'
  | 'diff'
  | 'status'
  | 'quit';

export type ParsedComposerInput =
  | { kind: 'message'; text: string }
  | { kind: 'command'; name: SlashCommandName; argument: string }
  | { kind: 'unknown'; command: string };

const COMMANDS = new Set<SlashCommandName>([
  'new',
  'resume',
  'fork',
  'rename',
  'archive',
  'delete',
  'model',
  'permissions',
  'review',
  'compact',
  'diff',
  'status',
  'quit',
]);

export function parseComposerInput(raw: string): ParsedComposerInput {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('/')) return { kind: 'message', text: raw };
  const match = /^\/([^\s]+)(?:\s+([\s\S]*))?$/.exec(trimmed);
  if (!match) return { kind: 'message', text: raw };
  const name = match[1].toLocaleLowerCase();
  if (!COMMANDS.has(name as SlashCommandName)) return { kind: 'unknown', command: name };
  return {
    kind: 'command',
    name: name as SlashCommandName,
    argument: match[2]?.trim() ?? '',
  };
}

export const commandDescriptions: Array<{
  name: SlashCommandName;
  description: string;
}> = [
  { name: 'new', description: '在当前项目新建线程' },
  { name: 'resume', description: '恢复指定线程' },
  { name: 'fork', description: '从当前线程创建分支' },
  { name: 'rename', description: '重命名当前线程' },
  { name: 'archive', description: '归档当前线程' },
  { name: 'delete', description: '删除当前线程' },
  { name: 'model', description: '打开模型设置' },
  { name: 'permissions', description: '打开权限设置' },
  { name: 'review', description: '审查未提交变更' },
  { name: 'compact', description: '压缩当前线程上下文' },
  { name: 'diff', description: '切换 Diff 面板' },
  { name: 'status', description: '查看运行状态' },
  { name: 'quit', description: '退出应用' },
];
