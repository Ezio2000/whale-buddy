import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Markdown, MarkdownTurnContext } from '../../src/renderer/components/Markdown';
const original = window.whale;
afterEach(() => { cleanup(); window.whale = original; });
it('routes relative links to the originating turn instead of renderer URLs', async () => {
  const preview = vi.fn().mockResolvedValue('# 正确报告');
  window.whale = { turns: { filePreview: preview } } as unknown as typeof window.whale;
  render(<MarkdownTurnContext.Provider value="turn-a"><Markdown>{'[报告](./report%20a.md)'}</Markdown></MarkdownTurnContext.Provider>);
  fireEvent.click(screen.getByRole('link', { name: '报告' }));
  expect(preview).toHaveBeenCalledWith({ turnId: 'turn-a', path: './report a.md' });
  expect(await screen.findByText('# 正确报告')).toBeVisible();
});
it('shows missing file errors without opening an app-relative target', async () => {
  window.whale = { turns: { filePreview: vi.fn().mockRejectedValue(new Error('找不到文件')) } } as unknown as typeof window.whale;
  render(<MarkdownTurnContext.Provider value="turn-a"><Markdown>{'[文件](missing.md)'}</Markdown></MarkdownTurnContext.Provider>);
  fireEvent.click(screen.getByRole('link')); expect(await screen.findByRole('alert')).toHaveTextContent('找不到文件');
});
