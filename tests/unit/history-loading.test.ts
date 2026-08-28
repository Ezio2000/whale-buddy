import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../../src/renderer/state/store';
import type { HistoryPage, WhaleApi } from '../../src/shared/types';

const originalState = useAppStore.getState();
const originalWhale = window.whale;
const resume = vi.fn().mockResolvedValue({});
const readHistory = vi.fn();

const latestPage: HistoryPage = {
  turns: [
    { id: 'turn-new', status: 'completed', itemsView: 'summary', items: [] },
    { id: 'turn-old', status: 'completed', itemsView: 'summary', items: [] },
  ],
  items: [
    { turnId: 'turn-new', item: { id: 'item-new', type: 'agentMessage', text: 'new' } },
    { turnId: 'turn-old', item: { id: 'item-old', type: 'agentMessage', text: 'old' } },
  ],
  plans: [],
  changes: [],
  turnsNextCursor: 'older-turns',
  itemsNextCursor: 'older-items',
};

beforeEach(() => {
  resume.mockClear();
  readHistory.mockReset().mockResolvedValue(latestPage);
  Object.defineProperty(window, 'whale', {
    configurable: true,
    value: {
      threads: { readHistory, resume },
    } as unknown as WhaleApi,
  });
  useAppStore.setState({
    ...originalState,
    selectedThreadId: null,
    conversation: { generation: 0, lastSequence: 0, threads: {} },
    historyByThread: {},
    busy: false,
    notice: null,
  }, true);
});

afterEach(() => {
  Object.defineProperty(window, 'whale', { configurable: true, value: originalWhale });
  useAppStore.setState(originalState, true);
});

describe('thread history loading', () => {
  it('loads the newest page once, normalizes it to chronological order, and reuses the cache', async () => {
    await useAppStore.getState().selectThread('thread-1');
    expect(readHistory).toHaveBeenCalledWith({
      threadId: 'thread-1',
      turnsLimit: 20,
      itemsLimit: 50,
      sortDirection: 'desc',
    });
    expect(useAppStore.getState().conversation.threads['thread-1'].turnOrder)
      .toEqual(['turn-old', 'turn-new']);

    await useAppStore.getState().selectThread('thread-1');
    expect(readHistory).toHaveBeenCalledTimes(1);
    expect(resume).toHaveBeenCalledTimes(2);
  });

  it('loads an older page with stored cursors and prepends it to the cache', async () => {
    readHistory
      .mockResolvedValueOnce(latestPage)
      .mockResolvedValueOnce({
        turns: [{ id: 'turn-earliest', status: 'completed', itemsView: 'summary', items: [] }],
        items: [{
          turnId: 'turn-earliest',
          item: { id: 'item-earliest', type: 'userMessage', content: [] },
        }],
        plans: [], changes: [], turnsNextCursor: null, itemsNextCursor: null,
      } satisfies HistoryPage);

    await useAppStore.getState().selectThread('thread-1');
    await useAppStore.getState().loadOlderHistory('thread-1');

    expect(readHistory).toHaveBeenLastCalledWith({
      threadId: 'thread-1',
      turnsCursor: 'older-turns',
      itemsCursor: 'older-items',
      turnsLimit: 20,
      itemsLimit: 50,
      sortDirection: 'desc',
    });
    expect(useAppStore.getState().conversation.threads['thread-1'].turnOrder)
      .toEqual(['turn-earliest', 'turn-old', 'turn-new']);
    expect(useAppStore.getState().historyByThread['thread-1']).toMatchObject({
      turnsCursor: null,
      itemsCursor: null,
      loadingOlder: false,
    });
  });
});
