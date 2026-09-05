import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { PluginContext } from '../../packages/plugin-sdk/src/core';
const host = vi.hoisted(() => ({ artifacts: [] as any[], listArtifacts: vi.fn(), createArtifact: vi.fn() }));
vi.mock('@whale-buddy/plugin-sdk/ui', () => ({
  listArtifacts: host.listArtifacts, createArtifact: host.createArtifact,
  openArtifact: vi.fn(), saveArtifactAs: vi.fn(), usePluginEvents: vi.fn(),
}));
import { ResultCard } from '../../marketplaces/office/plugins/whale-office-assistant/ui-src/src/result-card';
afterEach(() => { cleanup(); vi.clearAllMocks(); host.artifacts = []; });
it('keeps repeated task IDs and old/new cards independent through confirmation and remount', async () => {
  host.listArtifacts.mockImplementation(async () => host.artifacts);
  host.createArtifact.mockImplementation(async (input) => { const artifact = { ...input, id: 'artifact-' + input.taskId }; host.artifacts.push(artifact); return artifact; });
  const makeContext = (id: string, title: string, content: string) => ({ threadId: 'same-thread',
    message: { itemId: id, status: 'completed', data: { arguments: { taskId: 'same-task', title, content, summary: title, format: 'html' } } },
  }) as unknown as PluginContext;
  const first = makeContext('call1', '原成果', '30行');
  const second = makeContext('call2', '新成果', '2行');
  const renderArtifact = vi.fn(async (draft) => draft.content);
  const renderPreview = (draft: any) => <p>{draft.content}</p>;
  const Cards = () => <><ResultCard context={first} renderArtifact={renderArtifact} renderPreview={renderPreview} /><ResultCard context={second} renderArtifact={renderArtifact} renderPreview={renderPreview} /></>;
  const mounted = render(<Cards />);
  await waitFor(() => expect(host.listArtifacts).toHaveBeenCalledTimes(2));
  const cards = screen.getAllByRole('article');
  expect(within(cards[0]).getByText('30行')).toBeVisible();
  expect(within(cards[1]).getByText('2行')).toBeVisible();
  fireEvent.click(within(cards[1]).getByRole('button', { name: '确认并生成 HTML' }));
  await waitFor(() => expect(within(cards[1]).getByText('打开成果')).toBeVisible());
  expect(within(cards[0]).getByText('确认并生成 HTML')).toBeVisible();
  expect(host.createArtifact).toHaveBeenCalledWith(expect.objectContaining({ taskId: 'office-call:call2', dataBase64: '2行' }));
  mounted.unmount(); render(<Cards />);
  await waitFor(() => expect(screen.getAllByText('打开成果')).toHaveLength(1));
  expect(screen.getByText('确认并生成 HTML')).toBeVisible();
  expect(screen.getByText('30行')).toBeVisible();
});
