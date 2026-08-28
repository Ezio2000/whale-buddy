import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScheduledTasksPage } from '../../src/renderer/components/ScheduledTasksPage';
import { useAppStore } from '../../src/renderer/state/store';
import type { ScheduledTask, WhaleApi, WhaleEvent } from '../../src/shared/types';

const originalState = useAppStore.getState();
const originalWhale = window.whale;
let scheduleListener: ((event: WhaleEvent) => void) | null = null;
const list = vi.fn().mockResolvedValue([]);
const history = vi.fn().mockResolvedValue([]);
const create = vi.fn(async (input: Parameters<WhaleApi['schedules']['create']>[0]): Promise<ScheduledTask> => {
  const task: ScheduledTask = {
    ...input,
    threadId: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    nextRunAt: Date.now() + 60_000,
    lastRunAt: null,
    healthError: null,
  };
  scheduleListener?.({
    kind: 'runtime',
    generation: 1,
    sequence: 1,
    event: { type: 'scheduledTasksChanged', tasks: [task] },
  });
  return task;
});

beforeEach(() => {
  list.mockClear();
  history.mockClear();
  create.mockClear();
  scheduleListener = null;
  Object.defineProperty(window, 'whale', {
    configurable: true,
    value: {
      schedules: {
        list,
        history,
        create,
        update: vi.fn(),
        remove: vi.fn(),
        runNow: vi.fn(),
      },
      events: { subscribe: vi.fn((listener) => {
        scheduleListener = listener;
        return () => { scheduleListener = null; };
      }) },
    } as unknown as WhaleApi,
  });
  useAppStore.setState({
    ...originalState,
    runtime: {
      phase: 'ready', generation: 1, pid: 1, codexVersion: 'fixture', protocolVersion: 'fixture',
      sidecarHome: '/whale', codexHome: '/whale/codex', diagnosticLog: '/whale/log',
      restartAttempt: 0, message: null,
    },
    projects: [{ id: 'project-1', name: '演示项目', path: '/workspace/demo', lastOpenedAt: 0 }],
    models: [{ id: 'model-1', model: 'fixture-model', displayName: 'Fixture Model', description: '', isDefault: true }],
    preferences: {
      theme: 'system', model: 'fixture-model', effort: 'medium',
      approvalPolicy: 'untrusted', sandboxMode: 'workspace-write',
    },
    notice: null,
  }, true);
});

afterEach(() => {
  Object.defineProperty(window, 'whale', { configurable: true, value: originalWhale });
  useAppStore.setState(originalState, true);
});

describe('ScheduledTasksPage', () => {
  it('creates an app-only scheduled task from the dedicated page', async () => {
    render(<ScheduledTasksPage />);
    expect(await screen.findByText('还没有定时任务')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: '新建任务' })[0]);

    fireEvent.change(screen.getByLabelText('任务名称'), { target: { value: '每日汇总' } });
    fireEvent.change(screen.getByLabelText('任务说明'), { target: { value: '汇总项目进度并列出风险' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      name: '每日汇总',
      projectId: 'project-1',
      cwd: '/workspace/demo',
      cron: '0 9 * * *',
      timezone: expect.any(String),
      prompt: '汇总项目进度并列出风险',
    }));
    expect(await screen.findByText('每日汇总')).toBeInTheDocument();
    expect(screen.getAllByText('每日汇总')).toHaveLength(1);
  });
});
