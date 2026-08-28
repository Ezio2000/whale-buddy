import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApprovalCard } from '../../src/renderer/components/ApprovalCard';
import type { PendingApproval } from '../../src/renderer/state/store';

function approval(method: string, params: Record<string, unknown> = {}): PendingApproval {
  return {
    id: 1,
    method,
    params,
    threadId: 'thread',
    turnId: 'turn',
    itemId: 'item',
    receivedAt: 1,
  };
}

describe('ApprovalCard', () => {
  it('allows only the current v2 command approval', () => {
    const respond = vi.fn();
    render(
      <ApprovalCard
        approval={approval('item/commandExecution/requestApproval', { command: 'pnpm test' })}
        onRespond={respond}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '仅允许此项' }));
    expect(respond).toHaveBeenCalledWith({ decision: 'accept' });
  });

  it('keeps the conversation-wide option without merging approval requests', () => {
    const firstRespond = vi.fn();
    const secondRespond = vi.fn();
    const { rerender } = render(
      <ApprovalCard
        approval={approval('item/commandExecution/requestApproval', { command: 'first' })}
        onRespond={firstRespond}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '本次对话允许' }));
    expect(firstRespond).toHaveBeenCalledWith({ decision: 'acceptForSession' });
    expect(secondRespond).not.toHaveBeenCalled();

    rerender(
      <ApprovalCard
        approval={{ ...approval('item/commandExecution/requestApproval', { command: 'second' }), id: 2 }}
        onRespond={secondRespond}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '仅允许此项' }));
    expect(secondRespond).toHaveBeenCalledWith({ decision: 'accept' });
  });

  it('adapts decisions for legacy app-server approval requests', () => {
    const respond = vi.fn();
    render(<ApprovalCard approval={approval('execCommandApproval')} onRespond={respond} />);

    fireEvent.click(screen.getByRole('button', { name: '仅允许此项' }));
    expect(respond).toHaveBeenCalledWith({ decision: 'approved' });
    fireEvent.click(screen.getByRole('button', { name: '拒绝' }));
    expect(respond).toHaveBeenLastCalledWith({
      decision: { denied: { rejection: '用户拒绝了该操作' } },
    });
  });

  it('maps request_user_input answers by question id', () => {
    const respond = vi.fn();
    render(
      <ApprovalCard
        approval={approval('item/tool/requestUserInput', {
          questions: [
            {
              id: 'theme',
              header: '主题',
              question: '选择主题',
              options: [{ label: '深色', description: '使用深色界面' }],
            },
          ],
        })}
        onRespond={respond}
      />,
    );

    fireEvent.change(screen.getByRole('combobox'), { target: { value: '深色' } });
    fireEvent.click(screen.getByRole('button', { name: '仅允许此项' }));
    expect(respond).toHaveBeenCalledWith({ answers: { theme: { answers: ['深色'] } } });
  });

  it('keeps later commands under individual review after granting permissions', () => {
    const respond = vi.fn();
    render(
      <ApprovalCard
        approval={approval('item/permissions/requestApproval', {
          permissions: { network: { enabled: true } },
        })}
        onRespond={respond}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '仅允许此项' }));
    expect(respond).toHaveBeenCalledWith({
      permissions: { network: { enabled: true } },
      scope: 'turn',
      strictAutoReview: true,
    });
  });
});
