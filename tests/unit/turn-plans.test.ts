import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { TurnPlanStore } from '../../src/main/turn-plans';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('turn plan persistence', () => {
  it('persists the latest snapshot and reloads it by turn id', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'whale-turn-plans-'));
    temporaryRoots.push(root);
    const first = new TurnPlanStore(root);

    first.save({
      turnId: 'turn-1',
      explanation: '初始计划',
      plan: [{ step: '检索', status: 'inProgress' }],
      updatedAt: 1_000,
    });
    first.save({
      turnId: 'turn-1',
      explanation: '已经完成',
      plan: [{ step: '检索', status: 'completed' }],
      updatedAt: 2_000,
    });

    const restored = new TurnPlanStore(root);
    expect(restored.find(['turn-1', 'missing'])).toEqual([{
      turnId: 'turn-1',
      explanation: '已经完成',
      plan: [{ step: '检索', status: 'completed' }],
      updatedAt: 2_000,
    }]);
  });
});
