import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { RenameThreadDialog } from '../../src/renderer/components/RenameThreadDialog';
import { useAppStore } from '../../src/renderer/state/store';
const original = useAppStore.getState();
afterEach(() => { cleanup(); useAppStore.setState(original, true); });
it('keeps errors visible and saves the chosen thread after correction', async () => {
  const rename = vi.fn().mockRejectedValueOnce(new Error('保存失败')).mockResolvedValue(undefined);
  useAppStore.setState({ renameThread: rename });
  const close = vi.fn();
  render(<RenameThreadDialog thread={{ id: 'old-thread', title: '旧名' }} onClose={close} />);
  fireEvent.change(screen.getByLabelText('对话名称'), { target: { value: ' 新名 ' } });
  fireEvent.click(screen.getByText('保存'));
  expect(await screen.findByRole('alert')).toHaveTextContent('保存失败');
  expect(close).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('保存'));
  await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
  expect(rename).toHaveBeenLastCalledWith('新名', 'old-thread');
});
it('cancels without renaming', () => {
  const rename = vi.fn(); useAppStore.setState({ renameThread: rename });
  const close = vi.fn(); render(<RenameThreadDialog thread={{ id: 'a', title: '旧名' }} onClose={close} />);
  fireEvent.click(screen.getByText('取消')); expect(close).toHaveBeenCalled(); expect(rename).not.toHaveBeenCalled();
});
