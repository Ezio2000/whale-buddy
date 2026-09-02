import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ItemCard } from '../../src/renderer/components/ItemCard';

describe('ItemCard', () => {
  it('renders plugin Hook progress and expandable output', () => {
    render(
      <ItemCard
        item={{
          id: 'hook', type: 'hookRun', status: 'failed', statusMessage: '整理结果',
          durationMs: 25, entries: [{ kind: 'error', text: 'fixture failed' }],
        }}
        approvals={[]}
        onRespondApproval={() => undefined}
      />,
    );
    expect(screen.getByText('整理结果')).toBeInTheDocument();
    expect(screen.getByText('失败 · 25 ms')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('fixture failed')).toBeInTheDocument();
  });
  it('renders a Bash card in the waiting state as soon as execution starts', () => {
    render(
      <ItemCard
        item={{
          id: 'bash-started',
          type: 'commandExecution',
          command: ['/bin/zsh', '-lc', 'pwd'],
          status: 'inProgress',
          whaleStartedAtMs: Date.now(),
        }}
        approvals={[]}
        onRespondApproval={() => undefined}
      />,
    );

    expect(screen.getByText('命令执行')).toBeInTheDocument();
    expect(screen.getByText(/等待中/)).toBeInTheDocument();
  });

  it('renders streamed markdown and command execution summaries', () => {
    const { rerender } = render(
      <ItemCard
        item={{ id: 'a', type: 'agentMessage', text: '正在**处理**' }}
        approvals={[]}
        onRespondApproval={() => undefined}
      />,
    );
    expect(screen.getByText('处理')).toHaveTextContent('处理');

    rerender(
      <ItemCard
        item={{
          id: 'c',
          type: 'commandExecution',
          command: 'pnpm test',
          cwd: '/repo',
          status: 'completed',
          aggregatedOutput: '42 tests passed',
          exitCode: 0,
          durationMs: 1200,
        }}
        approvals={[]}
        onRespondApproval={() => undefined}
      />,
    );
    expect(screen.getByText('命令执行')).toBeInTheDocument();
    expect(screen.getByText('完成 · 1.2 s')).toBeInTheDocument();
    expect(screen.queryByText('pnpm test')).not.toBeInTheDocument();
    expect(screen.queryByText('42 tests passed')).not.toBeInTheDocument();
  });

  it('keeps fenced code blocks structurally valid and loads Shiki highlighting', async () => {
    const { container } = render(
      <ItemCard
        item={{ id: 'code', type: 'agentMessage', text: '```typescript\nconst whale = true;\n```' }}
        approvals={[]}
        onRespondApproval={() => undefined}
      />,
    );
    expect(screen.getByText('const whale = true;')).toBeInTheDocument();
    expect(container.querySelector('pre pre')).toBeNull();
    await waitFor(() => expect(container.querySelector('.shiki')).not.toBeNull());
    expect(container.querySelector('pre pre')).toBeNull();
  });

  it('uses a safe fallback card for unknown protocol item types', () => {
    render(
      <ItemCard
        item={{ id: 'future', type: 'futureAmazingTool', newField: '<unsafe>' }}
        approvals={[]}
        onRespondApproval={() => undefined}
      />,
    );
    expect(screen.getByText('工具活动')).toBeInTheDocument();
    expect(screen.queryByText('futureAmazingTool')).not.toBeInTheDocument();
  });

  it('renders reasoning, plans, and file changes without flattening tool state', () => {
    const { rerender } = render(
      <ItemCard
        item={{ id: 'r', type: 'reasoning', summary: ['先检查协议，再执行测试'], content: [] }}
        approvals={[]}
        onRespondApproval={() => undefined}
      />,
    );
    expect(screen.getByText('先检查协议，再执行测试')).toBeInTheDocument();

    rerender(
      <ItemCard
        item={{ id: 'raw-r', type: 'reasoning', summary: [], content: ['仅有原始推理内容'] }}
        approvals={[]}
        onRespondApproval={() => undefined}
      />,
    );
    expect(screen.getByText('仅有原始推理内容')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /思考过程/ }));
    expect(screen.getAllByText('仅有原始推理内容')).toHaveLength(2);

    rerender(
      <ItemCard
        item={{ id: 'p', type: 'plan', text: '- [x] 完成握手' }}
        approvals={[]}
        onRespondApproval={() => undefined}
      />,
    );
    expect(screen.getByText('完成握手')).toBeInTheDocument();

    rerender(
      <ItemCard
        item={{
          id: 'f',
          type: 'fileChange',
          status: 'completed',
          changes: [{ path: 'src/main.ts', kind: 'update', diff: '@@ -1 +1 @@\n-old\n+new' }],
        }}
        approvals={[]}
        onRespondApproval={() => undefined}
      />,
    );
    expect(screen.getByText('src/main.ts')).toBeInTheDocument();
    expect(screen.getByText('+new')).toHaveClass('line-add');
  });
});
