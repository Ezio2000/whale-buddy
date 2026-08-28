import { describe, expect, it } from 'vitest';
import { parseComposerInput } from '../../src/renderer/state/commands';

describe('slash command parser', () => {
  it('maps core commands and preserves arguments', () => {
    expect(parseComposerInput('/rename  新名字 ')).toEqual({
      kind: 'command',
      name: 'rename',
      argument: '新名字',
    });
    expect(parseComposerInput('/diff')).toEqual({ kind: 'command', name: 'diff', argument: '' });
  });

  it('does not reinterpret ordinary messages', () => {
    expect(parseComposerInput('请修改 /src/main.ts')).toEqual({
      kind: 'message',
      text: '请修改 /src/main.ts',
    });
    expect(parseComposerInput('/does-not-exist')).toEqual({
      kind: 'unknown',
      command: 'does-not-exist',
    });
  });
});
