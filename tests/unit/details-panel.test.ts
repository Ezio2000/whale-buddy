import { afterEach, describe, expect, it } from 'vitest';
import { useAppStore } from '../../src/renderer/state/store';
import type { WhaleEvent } from '../../src/shared/types';

const originalState = useAppStore.getState();
afterEach(() => useAppStore.setState(originalState, true));

const events: WhaleEvent[] = [
  { kind: 'notification', generation: 1, sequence: 1, message: {
    method: 'turn/plan/updated', params: { threadId: 'thread-1', turnId: 'turn-1', plan: [{ step: 'Verify changes', status: 'inProgress' }] },
  } },
  { kind: 'notification', generation: 1, sequence: 2, message: {
    method: 'turn/diff/updated', params: { threadId: 'thread-1', turnId: 'turn-1', diff: '+changed' },
  } },
  { kind: 'runtime', generation: 1, sequence: 3, event: {
    type: 'turnChanges', threadId: 'thread-1', snapshot: { turnId: 'turn-1', cwd: '/workspace', files: [], diff: '+changed', updatedAt: 1 },
  } },
];

describe('details panel visibility', () => {
  it('starts closed', () => {
    expect(originalState.rightPanelOpen).toBe(false);
  });

  it.each([false, true])('preserves the user-selected visibility (%s) while receiving updates', (open) => {
    useAppStore.getState().setRightPanel(open);
    for (const event of events) {
      useAppStore.getState().handleEvent(event);
      expect(useAppStore.getState().rightPanelOpen).toBe(open);
    }
    expect(useAppStore.getState().conversation.threads['thread-1']).toBeDefined();
  });

  it('does not reopen after the user closes it', () => {
    useAppStore.getState().setRightPanel(true);
    useAppStore.getState().setRightPanel(false);
    for (const event of events) useAppStore.getState().handleEvent(event);
    expect(useAppStore.getState().rightPanelOpen).toBe(false);
  });
});
