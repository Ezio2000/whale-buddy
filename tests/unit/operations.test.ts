import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { approvalEffect, OperationStore } from '../../src/main/operations';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('operation boundary', () => {
  it('persists identity, policy decisions, and lifecycle events by turn id', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'whale-operations-'));
    temporaryRoots.push(root);
    const store = new OperationStore(root);
    const operationId = store.start({
      identity: {
        userId: 'user-1',
        username: 'alice',
        displayName: 'Alice',
        sessionId: 'session-1',
      },
      action: 'turn.execute',
      resource: { source: 'composer', sandboxMode: 'workspace-write' },
      threadId: 'thread-1',
    });

    store.addDecisionByOperation(operationId, {
      source: 'execution-policy',
      action: 'turn.execute',
      effect: 'allow',
      reason: '执行预设已通过校验',
      requestId: null,
    });
    store.attachTurn(operationId, 'thread-1', 'turn-1');
    store.addDecisionByTurn('turn-1', {
      source: 'tool-approval',
      action: 'command.execute',
      effect: 'confirm',
      reason: '需要用户确认',
      requestId: 'number:1',
    });
    store.addDecisionByTurn('turn-1', {
      source: 'user-approval',
      action: 'command.execute',
      effect: 'allow',
      reason: '用户已允许该操作',
      requestId: 'number:1',
    });
    store.completeTurn('turn-1', 'completed', null);

    const [record] = new OperationStore(root).find(['turn-1']);
    expect(record).toMatchObject({
      operationId,
      identity: { userId: 'user-1', sessionId: 'session-1' },
      threadId: 'thread-1',
      turnId: 'turn-1',
    });
    expect(record.decisions.map((decision) => decision.effect)).toEqual(['allow', 'confirm', 'allow']);
    expect(record.events.map((event) => event.outcome)).toEqual([
      'started', 'allowed', 'confirmation-required', 'allowed', 'succeeded',
    ]);
  });

  it('normalizes current approval response shapes', () => {
    expect(approvalEffect({ decision: 'accept' })).toBe('allow');
    expect(approvalEffect({ decision: 'acceptForSession' })).toBe('allow');
    expect(approvalEffect({ decision: 'decline' })).toBe('deny');
    expect(approvalEffect({ decision: { denied: { rejection: 'no' } } })).toBe('deny');
    expect(approvalEffect({ action: 'decline', content: null, _meta: null })).toBe('deny');
    expect(approvalEffect({ permissions: {}, scope: 'turn' })).toBe('deny');
  });

  it('keeps an early completion event until the turn response is attached', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'whale-operations-'));
    temporaryRoots.push(root);
    const store = new OperationStore(root);
    const operationId = store.start({ identity: null, action: 'turn.execute', threadId: 'thread-1' });

    store.completeTurn('turn-early', 'completed', null);
    store.attachTurn(operationId, 'thread-1', 'turn-early');

    expect(store.find(['turn-early'])[0].events.at(-1)?.outcome).toBe('succeeded');
  });
});
