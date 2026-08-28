import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CronExpressionParser } from 'cron-parser';
import type {
  ScheduledRun,
  ScheduledTask,
  ScheduledTaskInput,
} from '../shared/types';

interface ScheduledTaskState {
  version: 1;
  tasks: ScheduledTask[];
  runs: ScheduledRun[];
}

export interface ScheduledTaskExecution {
  threadId: string;
  turnId: string;
}

export interface ScheduledTaskExecutor {
  isReady(): boolean;
  execute(task: ScheduledTask): Promise<ScheduledTaskExecution>;
}

interface ActiveRun {
  taskId: string;
  runId: string;
  turnId: string | null;
  approvalCount: number;
}

const MAX_RUNS_PER_TASK = 100;
const MAX_TIMER_DELAY = 2_147_000_000;
const MISSED_GRACE_MS = 60_000;

export class ScheduledTaskStore {
  private readonly filePath: string;
  private state: ScheduledTaskState;

  constructor(uiStateRoot: string) {
    mkdirSync(uiStateRoot, { recursive: true });
    this.filePath = path.join(uiStateRoot, 'scheduled-tasks.json');
    this.state = this.read();
    let repaired = false;
    for (const run of this.state.runs) {
      if (run.status !== 'running' && run.status !== 'waitingApproval') continue;
      run.status = 'failed';
      run.completedAt = Date.now();
      run.error = '应用在任务完成前退出';
      repaired = true;
    }
    if (repaired) this.write();
  }

  list(): ScheduledTask[] {
    return this.state.tasks.map((task) => structuredClone(task));
  }

  get(taskId: string): ScheduledTask | null {
    const task = this.state.tasks.find((candidate) => candidate.id === taskId);
    return task ? structuredClone(task) : null;
  }

  create(input: ScheduledTaskInput & { id: string }, now = Date.now()): ScheduledTask {
    if (this.state.tasks.some((task) => task.id === input.id)) throw new Error('定时任务 ID 已存在');
    validateSchedule(input.cron, input.timezone);
    const task: ScheduledTask = {
      ...structuredClone(input),
      threadId: null,
      createdAt: now,
      updatedAt: now,
      nextRunAt: input.enabled ? nextScheduledTime(input.cron, input.timezone, now) : null,
      lastRunAt: null,
      healthError: null,
    };
    this.state.tasks.push(task);
    this.write();
    return structuredClone(task);
  }

  update(input: ScheduledTaskInput & { id: string }, now = Date.now()): ScheduledTask {
    validateSchedule(input.cron, input.timezone);
    const index = this.state.tasks.findIndex((task) => task.id === input.id);
    if (index < 0) throw new Error('定时任务不存在');
    const previous = this.state.tasks[index];
    const task: ScheduledTask = {
      ...structuredClone(input),
      threadId: previous.threadId,
      createdAt: previous.createdAt,
      updatedAt: now,
      nextRunAt: input.enabled ? nextScheduledTime(input.cron, input.timezone, now) : null,
      lastRunAt: previous.lastRunAt,
      healthError: null,
    };
    this.state.tasks[index] = task;
    this.write();
    return structuredClone(task);
  }

  remove(taskId: string): void {
    this.state.tasks = this.state.tasks.filter((task) => task.id !== taskId);
    this.state.runs = this.state.runs.filter((run) => run.taskId !== taskId);
    this.write();
  }

  setNextRun(taskId: string, nextRunAt: number | null): void {
    const task = this.requireTask(taskId);
    task.nextRunAt = nextRunAt;
    task.updatedAt = Date.now();
    this.write();
  }

  resetSchedules(now = Date.now()): void {
    for (const task of this.state.tasks) {
      task.nextRunAt = task.enabled ? nextScheduledTime(task.cron, task.timezone, now) : null;
    }
    this.write();
  }

  setThread(taskId: string, threadId: string): void {
    const task = this.requireTask(taskId);
    task.threadId = threadId;
    task.updatedAt = Date.now();
    this.write();
  }

  pause(taskId: string, error: string): void {
    const task = this.requireTask(taskId);
    task.enabled = false;
    task.nextRunAt = null;
    task.healthError = error;
    task.updatedAt = Date.now();
    this.write();
  }

  addRun(run: ScheduledRun): ScheduledRun {
    this.state.runs.push(structuredClone(run));
    const task = this.requireTask(run.taskId);
    task.lastRunAt = run.startedAt ?? run.scheduledAt;
    this.pruneRuns(run.taskId);
    this.write();
    return structuredClone(run);
  }

  updateRun(runId: string, patch: Partial<ScheduledRun>): ScheduledRun {
    const run = this.state.runs.find((candidate) => candidate.id === runId);
    if (!run) throw new Error('定时任务运行记录不存在');
    Object.assign(run, structuredClone(patch), { id: run.id, taskId: run.taskId });
    this.write();
    return structuredClone(run);
  }

  history(taskId: string): ScheduledRun[] {
    return this.state.runs
      .filter((run) => run.taskId === taskId)
      .sort((left, right) => right.scheduledAt - left.scheduledAt)
      .map((run) => structuredClone(run));
  }

  private requireTask(taskId: string): ScheduledTask {
    const task = this.state.tasks.find((candidate) => candidate.id === taskId);
    if (!task) throw new Error('定时任务不存在');
    return task;
  }

  private pruneRuns(taskId: string): void {
    const taskRuns = this.state.runs.filter((run) => run.taskId === taskId);
    if (taskRuns.length <= MAX_RUNS_PER_TASK) return;
    const keep = new Set(taskRuns.slice(-MAX_RUNS_PER_TASK).map((run) => run.id));
    this.state.runs = this.state.runs.filter((run) => run.taskId !== taskId || keep.has(run.id));
  }

  private read(): ScheduledTaskState {
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as ScheduledTaskState;
      if (parsed.version !== 1 || !Array.isArray(parsed.tasks) || !Array.isArray(parsed.runs)) {
        throw new Error('invalid scheduled task state');
      }
      return parsed;
    } catch {
      return { version: 1, tasks: [], runs: [] };
    }
  }

  private write(): void {
    const temporaryPath = `${this.filePath}.tmp`;
    writeFileSync(temporaryPath, `${JSON.stringify(this.state, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    renameSync(temporaryPath, this.filePath);
  }
}

export class ScheduledTaskScheduler {
  private timer: NodeJS.Timeout | null = null;
  private readonly activeByTask = new Map<string, ActiveRun>();
  private readonly activeByTurn = new Map<string, ActiveRun>();

  constructor(
    private readonly store: ScheduledTaskStore,
    private readonly executor: ScheduledTaskExecutor,
    private readonly onTasksChanged: (tasks: ScheduledTask[]) => void,
    private readonly onRunUpdated: (run: ScheduledRun) => void,
    private readonly now: () => number = Date.now,
  ) {}

  start(): void {
    this.store.resetSchedules(this.now());
    this.arm();
    this.onTasksChanged(this.store.list());
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  list(): ScheduledTask[] {
    return this.store.list();
  }

  create(input: ScheduledTaskInput & { id: string }): ScheduledTask {
    const task = this.store.create(input, this.now());
    this.changed();
    return task;
  }

  update(input: ScheduledTaskInput & { id: string }): ScheduledTask {
    const task = this.store.update(input, this.now());
    this.changed();
    return task;
  }

  remove(taskId: string): void {
    if (this.activeByTask.has(taskId)) throw new Error('任务正在运行，无法删除');
    this.store.remove(taskId);
    this.changed();
  }

  history(taskId: string): ScheduledRun[] {
    return this.store.history(taskId);
  }

  runNow(taskId: string): ScheduledRun {
    const task = this.requireTask(taskId);
    if (this.activeByTask.has(taskId)) throw new Error('该任务正在运行');
    return this.beginRun(task, 'manual', this.now());
  }

  handleApprovalStarted(turnId: string): void {
    const active = this.activeByTurn.get(turnId);
    if (!active) return;
    active.approvalCount += 1;
    const run = this.store.updateRun(active.runId, { status: 'waitingApproval' });
    this.onRunUpdated(run);
  }

  handleApprovalResolved(turnId: string): void {
    const active = this.activeByTurn.get(turnId);
    if (!active) return;
    active.approvalCount = Math.max(0, active.approvalCount - 1);
    if (active.approvalCount > 0) return;
    const run = this.store.updateRun(active.runId, { status: 'running' });
    this.onRunUpdated(run);
  }

  handleTurnCompleted(turnId: string, status: string, error: unknown): void {
    const active = this.activeByTurn.get(turnId);
    if (!active) return;
    this.activeByTurn.delete(turnId);
    this.activeByTask.delete(active.taskId);
    const failed = status !== 'completed';
    const run = this.store.updateRun(active.runId, {
      status: failed ? 'failed' : 'completed',
      completedAt: this.now(),
      error: failed
        ? error === null || error === undefined
          ? `任务回合结束：${status}`
          : errorMessage(error)
        : null,
    });
    this.onRunUpdated(run);
    this.onTasksChanged(this.store.list());
  }

  handleRuntimeUnavailable(message: string): void {
    for (const active of [...this.activeByTask.values()]) {
      if (active.turnId) this.activeByTurn.delete(active.turnId);
      const run = this.store.updateRun(active.runId, {
        status: 'failed',
        completedAt: this.now(),
        error: message,
      });
      this.onRunUpdated(run);
    }
    this.activeByTask.clear();
  }

  private tick(): void {
    this.timer = null;
    const now = this.now();
    for (const task of this.store.list()) {
      if (!task.enabled || task.nextRunAt === null || task.nextRunAt > now) continue;
      const scheduledAt = task.nextRunAt;
      this.store.setNextRun(task.id, nextScheduledTime(task.cron, task.timezone, now));
      if (now - scheduledAt > MISSED_GRACE_MS) {
        this.recordSkipped(task, scheduledAt, 'missed');
      } else if (this.activeByTask.has(task.id)) {
        this.recordSkipped(task, scheduledAt, 'conflict');
      } else {
        this.beginRun(task, 'schedule', scheduledAt);
      }
    }
    this.onTasksChanged(this.store.list());
    this.arm();
  }

  private beginRun(
    task: ScheduledTask,
    trigger: ScheduledRun['trigger'],
    scheduledAt: number,
  ): ScheduledRun {
    if (!this.executor.isReady()) return this.recordSkipped(task, scheduledAt, 'runtimeUnavailable', trigger);
    if (!isDirectory(task.cwd)) {
      const message = `项目目录不存在：${task.cwd}`;
      this.store.pause(task.id, message);
      const run = this.failedBeforeStart(task, trigger, scheduledAt, message);
      this.changed();
      return run;
    }
    const run = this.store.addRun({
      id: randomUUID(),
      taskId: task.id,
      trigger,
      scheduledAt,
      startedAt: this.now(),
      completedAt: null,
      status: 'running',
      threadId: task.threadId,
      turnId: null,
      error: null,
      skippedReason: null,
    });
    const active: ActiveRun = { taskId: task.id, runId: run.id, turnId: null, approvalCount: 0 };
    this.activeByTask.set(task.id, active);
    this.onRunUpdated(run);
    void this.executor.execute(task).then((execution) => {
      active.turnId = execution.turnId;
      this.activeByTurn.set(execution.turnId, active);
      const updated = this.store.updateRun(run.id, {
        threadId: execution.threadId,
        turnId: execution.turnId,
      });
      this.onRunUpdated(updated);
      this.onTasksChanged(this.store.list());
    }).catch((error) => {
      this.activeByTask.delete(task.id);
      const updated = this.store.updateRun(run.id, {
        status: 'failed',
        completedAt: this.now(),
        error: errorMessage(error),
      });
      this.onRunUpdated(updated);
    });
    return run;
  }

  private recordSkipped(
    task: ScheduledTask,
    scheduledAt: number,
    reason: NonNullable<ScheduledRun['skippedReason']>,
    trigger: ScheduledRun['trigger'] = 'schedule',
  ): ScheduledRun {
    const run = this.store.addRun({
      id: randomUUID(),
      taskId: task.id,
      trigger,
      scheduledAt,
      startedAt: null,
      completedAt: this.now(),
      status: 'skipped',
      threadId: task.threadId,
      turnId: null,
      error: null,
      skippedReason: reason,
    });
    this.onRunUpdated(run);
    return run;
  }

  private failedBeforeStart(
    task: ScheduledTask,
    trigger: ScheduledRun['trigger'],
    scheduledAt: number,
    message: string,
  ): ScheduledRun {
    const run = this.store.addRun({
      id: randomUUID(), taskId: task.id, trigger, scheduledAt,
      startedAt: null, completedAt: this.now(), status: 'failed',
      threadId: task.threadId, turnId: null, error: message, skippedReason: null,
    });
    this.onRunUpdated(run);
    return run;
  }

  private requireTask(taskId: string): ScheduledTask {
    const task = this.store.get(taskId);
    if (!task) throw new Error('定时任务不存在');
    return task;
  }

  private changed(): void {
    this.arm();
    this.onTasksChanged(this.store.list());
  }

  private arm(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const next = this.store.list()
      .flatMap((task) => task.enabled && task.nextRunAt !== null ? [task.nextRunAt] : [])
      .sort((left, right) => left - right)[0];
    if (next === undefined) return;
    const delay = Math.max(50, Math.min(MAX_TIMER_DELAY, next - this.now()));
    this.timer = setTimeout(() => this.tick(), delay);
  }
}

export function validateSchedule(expression: string, timezone: string): void {
  if (expression.trim().split(/\s+/).length !== 5) throw new Error('Cron 必须是 5 段表达式');
  CronExpressionParser.parse(expression, { currentDate: new Date(), tz: timezone });
}

export function nextScheduledTime(expression: string, timezone: string, after: number): number {
  validateSchedule(expression, timezone);
  return CronExpressionParser.parse(expression, {
    currentDate: new Date(after),
    tz: timezone,
  }).next().getTime();
}

function isDirectory(candidate: string): boolean {
  try {
    return existsSync(candidate) && statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}
