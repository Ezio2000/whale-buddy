import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ScheduledTaskInput } from '../../src/shared/types';
import {
  nextScheduledTime,
  ScheduledTaskScheduler,
  ScheduledTaskStore,
  validateSchedule,
} from '../../src/main/scheduled-tasks';

const temporaryRoots: string[] = [];

afterEach(() => {
  vi.useRealTimers();
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function createStore(): ScheduledTaskStore {
  const root = mkdtempSync(path.join(tmpdir(), 'whale-schedules-'));
  temporaryRoots.push(root);
  return new ScheduledTaskStore(root);
}

function taskInput(cwd: string, patch: Partial<ScheduledTaskInput> = {}): ScheduledTaskInput {
  return {
    name: '每日检查',
    projectId: 'project-1',
    cwd,
    prompt: '检查项目并总结进度',
    enabled: true,
    preset: 'daily',
    cron: '0 9 * * *',
    timezone: 'Asia/Shanghai',
    effort: 'medium',
    approvalPolicy: 'untrusted',
    sandboxMode: 'workspace-write',
    ...patch,
  };
}

describe('scheduled task persistence', () => {
  it('persists task settings and retains the fixed thread across updates', () => {
    const store = createStore();
    const cwd = temporaryRoots[0];
    const created = store.create({ id: 'task-1', ...taskInput(cwd) }, Date.UTC(2026, 7, 27));
    store.setThread(created.id, 'thread-fixed');
    store.update({ id: created.id, ...taskInput(cwd, { name: '更新后的任务' }) });

    const reloaded = new ScheduledTaskStore(temporaryRoots[0]);
    expect(reloaded.get(created.id)).toMatchObject({
      name: '更新后的任务',
      threadId: 'thread-fixed',
      timezone: 'Asia/Shanghai',
    });
  });

  it('validates five-field cron and calculates in the selected timezone', () => {
    expect(() => validateSchedule('0 9 * * *', 'Asia/Shanghai')).not.toThrow();
    expect(() => validateSchedule('0 0 9 * * *', 'Asia/Shanghai')).toThrow('5 段');
    expect(() => validateSchedule('0 9 * * *', 'Not/AZone')).toThrow();

    const next = nextScheduledTime('0 9 * * *', 'Asia/Shanghai', Date.parse('2026-08-27T00:30:00Z'));
    expect(new Date(next).toISOString()).toBe('2026-08-27T01:00:00.000Z');
  });
});

describe('ScheduledTaskScheduler', () => {
  it('lets different tasks run together but skips a second trigger of the same active task', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-27T00:00:00Z'));
    const store = createStore();
    const cwd = temporaryRoots[0];
    store.create({ id: 'task-a', ...taskInput(cwd, { cron: '* * * * *', preset: 'custom' }) });
    store.create({ id: 'task-b', ...taskInput(cwd, { cron: '* * * * *', preset: 'custom' }) });
    const execute = vi.fn(async (task: { id: string }) => ({
      threadId: `thread-${task.id}`,
      turnId: `turn-${task.id}`,
    }));
    const scheduler = new ScheduledTaskScheduler(
      store,
      { isReady: () => true, execute },
      () => undefined,
      () => undefined,
    );
    scheduler.start();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls.map(([task]) => task.id).sort()).toEqual(['task-a', 'task-b']);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(scheduler.history('task-a')[0]).toMatchObject({ status: 'skipped', skippedReason: 'conflict' });
    expect(scheduler.history('task-b')[0]).toMatchObject({ status: 'skipped', skippedReason: 'conflict' });

    scheduler.handleTurnCompleted('turn-task-a', 'completed', null);
    scheduler.handleTurnCompleted('turn-task-b', 'completed', null);
    expect(scheduler.history('task-a').some((run) => run.status === 'completed')).toBe(true);
    scheduler.stop();
  });

  it('does not catch up triggers that occurred while the scheduler was stopped', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-27T00:00:00Z'));
    const store = createStore();
    const cwd = temporaryRoots[0];
    store.create({ id: 'task-a', ...taskInput(cwd, { cron: '* * * * *', preset: 'custom' }) });
    vi.setSystemTime(new Date('2026-08-27T03:00:00Z'));
    const execute = vi.fn(async () => ({ threadId: 'thread-a', turnId: 'turn-a' }));
    const scheduler = new ScheduledTaskScheduler(
      store,
      { isReady: () => true, execute },
      () => undefined,
      () => undefined,
    );

    scheduler.start();
    expect(execute).not.toHaveBeenCalled();
    expect(scheduler.history('task-a')).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(execute).toHaveBeenCalledTimes(1);
    scheduler.stop();
  });

  it('records a manual run as skipped when the app-server is unavailable', () => {
    const store = createStore();
    const cwd = temporaryRoots[0];
    store.create({ id: 'task-a', ...taskInput(cwd) });
    const scheduler = new ScheduledTaskScheduler(
      store,
      { isReady: () => false, execute: vi.fn() },
      () => undefined,
      () => undefined,
    );
    const run = scheduler.runNow('task-a');
    expect(run).toMatchObject({ status: 'skipped', skippedReason: 'runtimeUnavailable' });
  });
});
