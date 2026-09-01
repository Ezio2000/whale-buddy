import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DiffPanel } from '../../src/renderer/components/DiffPanel';
import type { TurnView } from '../../src/renderer/state/conversation';

const turn: TurnView = {
  id: 'turn-1',
  status: 'completed',
  error: null,
  startedAt: 1,
  completedAt: 2,
  durationMs: 1_000,
  itemOrder: [],
  items: {},
  diff: [
    'diff --git a/src/a.ts b/src/a.ts',
    'index 1111111..2222222 100644',
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    '@@ -1 +1 @@',
    '-export const value = 1;',
    '+export const value = 2;',
  ].join('\n'),
  fileChanges: [{
    path: 'src/a.ts',
    kind: 'modified',
    size: 42,
    binary: false,
    createdAt: 1_000,
    modifiedAt: 2_000,
  }],
  plan: [{ step: '验证 sidecar', status: 'completed' }],
  planExplanation: '固定协议版本',
  operation: {
    operationId: 'operation-1',
    identity: {
      userId: 'user-1', username: 'alice', displayName: 'Alice', sessionId: 'session-1',
    },
    action: 'turn.execute',
    resource: { source: 'composer' },
    threadId: 'thread-1',
    turnId: 'turn-1',
    createdAt: 1,
    updatedAt: 2,
    decisions: [{
      id: 'decision-1', source: 'execution-policy', action: 'turn.execute', effect: 'allow',
      reason: '校验通过', decidedAt: 1, requestId: null,
    }],
    events: [],
  },
};

describe('DiffPanel', () => {
  it('renders unified/split controls and plan status', () => {
    render(<DiffPanel turns={[turn]} />);
    expect(screen.getByRole('combobox', { name: '对话轮次' })).toHaveValue('turn-1');
    expect(screen.getAllByText('src/a.ts')).toHaveLength(2);
    expect(screen.getByText('修改')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '分栏视图' }));
    fireEvent.click(screen.getByRole('button', { name: /计划/ }));
    expect(screen.getByText('验证 sidecar')).toBeInTheDocument();
    expect(screen.getByText('已完成')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /执行/ }));
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('operation-1')).toBeInTheDocument();
  });

  it('switches between every conversation turn', () => {
    const firstTurn: TurnView = {
      ...turn,
      id: 'turn-0',
      itemOrder: ['user-0'],
      items: {
        'user-0': { id: 'user-0', type: 'userMessage', content: [{ type: 'text', text: '第一轮问题' }] },
      },
      plan: [{ step: '第一轮计划', status: 'completed' }],
      diff: '',
      fileChanges: [],
    };
    const secondTurn: TurnView = {
      ...turn,
      itemOrder: ['user-1'],
      items: {
        'user-1': { id: 'user-1', type: 'userMessage', content: [{ type: 'text', text: '第二轮问题' }] },
      },
      plan: [{ step: '第二轮计划', status: 'completed' }],
    };

    render(<DiffPanel turns={[firstTurn, secondTurn]} />);
    fireEvent.click(screen.getByRole('button', { name: /计划/ }));
    expect(screen.getByText('第二轮计划')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: '对话轮次' }), {
      target: { value: 'turn-0' },
    });
    expect(screen.getByText('第一轮计划')).toBeInTheDocument();
  });
});
