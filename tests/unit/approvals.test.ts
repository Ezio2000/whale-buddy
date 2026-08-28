import { describe, expect, it } from 'vitest';
import type { WhaleEvent } from '../../src/shared/types';
import { pruneApprovalsForEvent } from '../../src/renderer/state/approvals';
import type { PendingApproval } from '../../src/renderer/state/store';

const approvals: PendingApproval[] = [
  {
    id: 1,
    method: 'item/commandExecution/requestApproval',
    params: {},
    threadId: 'thread',
    turnId: 'turn-1',
    itemId: 'item-1',
    receivedAt: 1,
  },
  {
    id: '1',
    method: 'item/fileChange/requestApproval',
    params: {},
    threadId: 'thread',
    turnId: 'turn-2',
    itemId: 'item-2',
    receivedAt: 1,
  },
];

describe('approval expiry', () => {
  it('uses typed request ids so numeric and string ids do not collide', () => {
    const event: WhaleEvent = {
      kind: 'notification',
      generation: 1,
      sequence: 1,
      message: { method: 'serverRequest/resolved', params: { requestId: 1 } },
    };
    expect(pruneApprovalsForEvent(approvals, event).map((item) => item.id)).toEqual(['1']);
  });

  it('clears every stale request belonging to a completed turn', () => {
    const event: WhaleEvent = {
      kind: 'notification',
      generation: 1,
      sequence: 2,
      message: { method: 'turn/completed', params: { turn: { id: 'turn-1' } } },
    };
    expect(pruneApprovalsForEvent(approvals, event).map((item) => item.turnId)).toEqual(['turn-2']);
  });
});
