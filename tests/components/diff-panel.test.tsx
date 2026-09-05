import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { WhaleApi } from '../../src/shared/types';
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
  it('opens the selected file diff, keeping file properties as a secondary action', () => {
    const filePreview = vi.fn();
    window.whale = { turns: { filePreview } } as unknown as WhaleApi;
    render(<DiffPanel turns={[turn]} />);
    fireEvent.click(screen.getByRole('button', { name: '变更' }));
    fireEvent.click(screen.getByRole('button', { name: /src\/a.ts 修改/ }));
    expect(screen.getByText('export const value = 2;')).toBeVisible();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(filePreview).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'src/a.ts 文件属性' }));
    expect(screen.getByRole('dialog')).toBeVisible();
    expect(screen.getByText('文件大小')).toBeVisible();
  });

  it('labels fallback content as current and reports read failures', async () => {
    const filePreview = vi.fn().mockResolvedValueOnce('print("current")').mockRejectedValueOnce(new Error('文件已不存在'));
    window.whale = { turns: { filePreview } } as unknown as WhaleApi;
    const second = { ...turn.fileChanges[0], path: 'missing.py' };
    render(<DiffPanel turns={[{ ...turn, diff: '', fileChanges: [...turn.fileChanges, second] }]} />);
    fireEvent.click(screen.getByRole('button', { name: '变更' }));
    fireEvent.click(screen.getByRole('button', { name: /src\/a.ts 修改/ }));
    expect(await screen.findByText('print("current")')).toBeVisible();
    expect(screen.getByText(/当前文件内容/)).toBeVisible();
    expect(filePreview).toHaveBeenCalledWith({ turnId: 'turn-1', path: 'src/a.ts' });
    fireEvent.click(screen.getByRole('button', { name: /missing.py 修改/ }));
    expect(await screen.findByText('文件已不存在')).toBeVisible();
    expect(screen.queryByText('print("current")')).not.toBeInTheDocument();
  });

  it('removes internal context from the turn picker', () => {
    render(<DiffPanel turns={[{ ...turn, itemOrder: ['user'], items: { user: {
      id: 'user', type: 'userMessage', content: [{ type: 'text', text: '写代码 <whale_brand_identity> 内部提示词' }],
    } } }]} />);
    expect(screen.getByRole('option')).toHaveTextContent('第 1 轮 · 写代码');
    expect(screen.queryByText(/whale_brand/)).not.toBeInTheDocument();
  });

  it('renders unified/split controls and plan status', () => {
    render(<DiffPanel turns={[turn]} />);
    expect(screen.getByRole('combobox', { name: '对话轮次' })).toHaveValue('turn-1');
    expect(screen.getByText('Alice')).not.toBeVisible();
    fireEvent.click(screen.getByText('诊断信息'));
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('operation-1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /变更/ }));
    expect(screen.getAllByText('src/a.ts')).toHaveLength(2);
    expect(screen.getByText('修改')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '分栏视图' }));
    fireEvent.click(screen.getByRole('button', { name: /计划/ }));
    expect(screen.getByText('验证 sidecar')).toBeInTheDocument();
    expect(screen.getByText('已完成')).toBeInTheDocument();
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
