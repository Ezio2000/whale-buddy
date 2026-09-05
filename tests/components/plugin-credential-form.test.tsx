import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PluginCredentialForm } from '../../src/renderer/components/PluginMarketplaceDialog';
import type { PluginCredentialValue } from '../../src/shared/plugin-credentials';
afterEach(cleanup);
it('masks saved values by default and re-masks after saving', async () => {
  const credential = { id: 'test', label: '测试 Key', value: 'fixture-only-key', required: true } as PluginCredentialValue;
  const save = vi.fn().mockResolvedValue(undefined);
  render(<PluginCredentialForm credential={credential} installed busy={false} disabled={false} onConfigure={save} />);
  const input = screen.getByLabelText('测试 Key 凭据'); expect(input).toHaveAttribute('type', 'password');
  fireEvent.click(screen.getByRole('button', { name: '显示凭据' })); expect(input).toHaveAttribute('type', 'text');
  fireEvent.click(screen.getByText('保存')); await waitFor(() => expect(input).toHaveAttribute('type', 'password'));
});
