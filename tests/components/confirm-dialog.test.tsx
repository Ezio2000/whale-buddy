import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { ConfirmDialog } from '../../src/renderer/components/ConfirmDialog';
import { answerConfirmation, confirmAction } from '../../src/renderer/state/confirmation';

afterEach(() => { act(() => answerConfirmation(false)); cleanup(); });

it('focuses cancel and does not authorize a destructive action on Escape', async () => {
  render(<ConfirmDialog />);
  let result!: Promise<boolean>;
  act(() => { result = confirmAction('此操作无法撤销。', { title: '删除测试项', confirmLabel: '永久删除', danger: true }); });
  expect(screen.getByRole('dialog')).toHaveAccessibleName('删除测试项');
  expect(screen.getByRole('button', { name: '取消' })).toHaveFocus();
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  await expect(result).resolves.toBe(false);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('requires an explicit click and refuses a duplicate concurrent request', async () => {
  render(<ConfirmDialog />);
  let first!: Promise<boolean>;
  act(() => { first = confirmAction('启用测试插件？', { confirmLabel: '启用插件' }); });
  await expect(confirmAction('重复请求')).resolves.toBe(false);
  expect(screen.getByText('启用测试插件？')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '启用插件' }));
  await expect(first).resolves.toBe(true);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('cancels by button and lets the next confirmation open independently', async () => {
  render(<ConfirmDialog />);
  let first!: Promise<boolean>;
  act(() => { first = confirmAction('第一个操作'); });
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  await expect(first).resolves.toBe(false);
  let second!: Promise<boolean>;
  act(() => { second = confirmAction('第二个操作'); });
  fireEvent.click(screen.getByRole('button', { name: '确认' }));
  await expect(second).resolves.toBe(true);
});
