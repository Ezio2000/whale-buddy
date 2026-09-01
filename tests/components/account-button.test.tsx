import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountButton } from '../../src/renderer/components/AccountButton';
import { useAppStore } from '../../src/renderer/state/store';
import type { WhaleApi } from '../../src/shared/types';

const originalState = useAppStore.getState();
const originalWhale = window.whale;
const login = vi.fn();
const logout = vi.fn();

beforeAll(() => {
  Object.defineProperty(window, 'PointerEvent', { configurable: true, value: MouseEvent });
});

beforeEach(() => {
  login.mockReset().mockResolvedValue({ status: 'waiting', user: null, message: null });
  logout.mockReset().mockResolvedValue({ status: 'logged-out', user: null, message: null });
  Object.defineProperty(window, 'whale', {
    configurable: true,
    value: { auth: { status: vi.fn(), login, logout } } as unknown as WhaleApi,
  });
  useAppStore.setState({
    ...originalState,
    auth: { status: 'logged-out', user: null, message: null },
    notice: null,
  }, true);
});

afterEach(() => {
  Object.defineProperty(window, 'whale', { configurable: true, value: originalWhale });
  useAppStore.setState(originalState, true);
});

describe('AccountButton', () => {
  it('starts browser login and renders the waiting state', async () => {
    render(<AccountButton />);
    fireEvent.click(screen.getByRole('button', { name: '登录 Whale' }));
    await waitFor(() => expect(login).toHaveBeenCalledOnce());
    expect(screen.getByRole('button', { name: '等待浏览器登录…' })).toBeDisabled();
  });

  it('shows the Casdoor user and logs out from the account menu', async () => {
    useAppStore.setState({
      auth: {
        status: 'logged-in',
        user: {
          id: 'built-in/alice', username: 'alice', displayName: 'Alice',
          email: 'alice@mock.wecom.local', avatar: null,
        },
        message: null,
      },
    });
    render(<AccountButton />);
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Alice，账户菜单' }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(await screen.findByText('退出登录'));
    await waitFor(() => expect(logout).toHaveBeenCalledOnce());
  });
});
