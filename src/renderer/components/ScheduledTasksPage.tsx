import * as Dialog from '@radix-ui/react-dialog';
import {
  CalendarClock,
  CheckCircle2,
  CircleAlert,
  Clock3,
  History,
  LoaderCircle,
  Pencil,
  Play,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type {
  LocalProject,
  ScheduledPluginContext,
  ScheduledRun,
  ScheduledTask,
  ScheduledTaskInput,
  ScheduledTaskPreset,
  WhaleEvent,
} from '../../shared/types';
import { composerContextFor, PluginUiFrame } from '../plugin-ui/PluginUiFrame';
import { usePluginHost } from '../plugin-ui/PluginHostProvider';
import { useAppStore, type Preferences } from '../state/store';
import {
  executionPresetFor,
  executionPresetPreferences,
  type ExecutionPreset,
} from './SettingsDialog';

type TaskDraft = ScheduledTaskInput & {
  id: string;
  time: string;
  minute: number;
  weekday: number;
};

const COMMON_TIMEZONES = [
  'Asia/Shanghai',
  'UTC',
  'Asia/Tokyo',
  'Asia/Singapore',
  'Europe/London',
  'America/New_York',
  'America/Los_Angeles',
];

export function ScheduledTasksPage() {
  const projects = useAppStore((state) => state.projects);
  const models = useAppStore((state) => state.models);
  const preferences = useAppStore((state) => state.preferences);
  const brandName = useAppStore((state) => state.branding.name);
  const runtime = useAppStore((state) => state.runtime);
  const setNotice = useAppStore((state) => state.setNotice);
  const selectProject = useAppStore((state) => state.selectProject);
  const selectThread = useAppStore((state) => state.selectThread);
  const setWorkspaceView = useAppStore((state) => state.setWorkspaceView);
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [runs, setRuns] = useState<Record<string, ScheduledRun[]>>({});
  const [loading, setLoading] = useState(true);
  const [editor, setEditor] = useState<TaskDraft | null>(null);
  const [historyTaskId, setHistoryTaskId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void window.whale.schedules.list().then(async (result) => {
      if (cancelled) return;
      setTasks(result);
      const histories = await Promise.all(result.map(async (task) => [
        task.id,
        await window.whale.schedules.history(task.id),
      ] as const));
      if (!cancelled) setRuns(Object.fromEntries(histories));
    }).catch((error) => {
      if (!cancelled) setNotice(`读取定时任务失败：${errorMessage(error)}`);
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    const unsubscribe = window.whale.events.subscribe((event) => {
      applyScheduleEvent(event, setTasks, setRuns);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [setNotice]);

  const openNew = () => {
    if (projects.length === 0) {
      setNotice('请先打开一个项目，再创建定时任务。');
      return;
    }
    setEditor(newDraft(projects[0], preferences));
  };

  const save = async (draft: TaskDraft, pluginContexts: ScheduledPluginContext[]) => {
    const input = taskInputFromDraft(draft, pluginContexts);
    const exists = tasks.some((task) => task.id === draft.id);
    const task = exists
      ? await window.whale.schedules.update({ id: draft.id, ...input })
      : await window.whale.schedules.create({ id: draft.id, ...input });
    setTasks((current) => current.some((candidate) => candidate.id === task.id)
      ? current.map((candidate) => candidate.id === task.id ? task : candidate)
      : [...current, task]);
    setRuns((current) => ({ ...current, [task.id]: current[task.id] ?? [] }));
    setEditor(null);
    setNotice(exists ? '定时任务已保存。' : '定时任务已创建。');
  };

  const toggleTask = async (task: ScheduledTask) => {
    try {
      const updated = await window.whale.schedules.update({
        ...taskInput(task),
        id: task.id,
        enabled: !task.enabled,
      });
      setTasks((current) => current.map((entry) => entry.id === updated.id ? updated : entry));
    } catch (error) {
      setNotice(`更新定时任务失败：${errorMessage(error)}`);
    }
  };

  const runNow = async (task: ScheduledTask) => {
    try {
      const run = await window.whale.schedules.runNow(task.id);
      mergeRun(setRuns, run);
      if (run.status === 'skipped') {
        setNotice(run.skippedReason === 'runtimeUnavailable'
          ? `${brandName} 服务当前不可用，任务没有执行。`
          : '任务正在运行，本次触发已跳过。');
      } else {
        setNotice('任务已开始运行。');
      }
    } catch (error) {
      setNotice(`运行任务失败：${errorMessage(error)}`);
    }
  };

  const remove = async (task: ScheduledTask) => {
    if (!window.confirm(`删除定时任务“${task.name}”？固定对话线程会保留。`)) return;
    try {
      await window.whale.schedules.remove(task.id);
      setTasks((current) => current.filter((entry) => entry.id !== task.id));
      setRuns((current) => {
        const next = { ...current };
        delete next[task.id];
        return next;
      });
      if (historyTaskId === task.id) setHistoryTaskId(null);
    } catch (error) {
      setNotice(`删除定时任务失败：${errorMessage(error)}`);
    }
  };

  const openThread = async (task: ScheduledTask) => {
    if (!task.threadId) return;
    selectProject(task.projectId);
    setWorkspaceView('conversation');
    await selectThread(task.threadId);
  };

  const historyTask = tasks.find((task) => task.id === historyTaskId) ?? null;

  return (
    <section className="scheduled-page">
      <header className="scheduled-page-header">
        <div>
          <div className="scheduled-page-title"><CalendarClock size={21} /><h1>定时任务</h1></div>
          <p>只在 AI小鲸打开时执行；关闭或休眠期间错过的任务不会补跑。</p>
        </div>
        <button className="primary-button" onClick={openNew}><Plus size={15} /> 新建任务</button>
      </header>

      {loading ? (
        <div className="scheduled-empty"><LoaderCircle className="spin" size={20} /> 正在读取任务…</div>
      ) : tasks.length === 0 ? (
        <div className="scheduled-empty">
          <CalendarClock size={32} />
          <strong>还没有定时任务</strong>
          <span>按固定时间让 AI小鲸在指定项目和专属对话中执行任务。</span>
          <button className="primary-button" onClick={openNew}><Plus size={15} /> 新建任务</button>
        </div>
      ) : (
        <div className="scheduled-layout">
          <div className="scheduled-list">
            {tasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                project={projects.find((project) => project.id === task.projectId)}
                latestRun={runs[task.id]?.[0]}
                activeRun={runs[task.id]?.find(isActive)}
                runtimeReady={runtime?.phase === 'ready'}
                onToggle={() => void toggleTask(task)}
                onEdit={() => setEditor(draftFromTask(task))}
                onRun={() => void runNow(task)}
                onHistory={() => setHistoryTaskId(task.id)}
                onOpenThread={() => void openThread(task)}
                onDelete={() => void remove(task)}
              />
            ))}
          </div>
          {historyTask && (
            <RunHistory
              task={historyTask}
              runs={runs[historyTask.id] ?? []}
              onClose={() => setHistoryTaskId(null)}
              onOpenThread={() => void openThread(historyTask)}
            />
          )}
        </div>
      )}

      {editor && (
        <TaskEditor
          key={editor.id}
          draft={editor}
          projects={projects}
          models={models}
          onClose={() => setEditor(null)}
          onSave={save}
        />
      )}
    </section>
  );
}

function TaskCard({
  task,
  project,
  latestRun,
  activeRun,
  runtimeReady,
  onToggle,
  onEdit,
  onRun,
  onHistory,
  onOpenThread,
  onDelete,
}: {
  task: ScheduledTask;
  project?: LocalProject;
  latestRun?: ScheduledRun;
  activeRun?: ScheduledRun;
  runtimeReady: boolean;
  onToggle(): void;
  onEdit(): void;
  onRun(): void;
  onHistory(): void;
  onOpenThread(): void;
  onDelete(): void;
}) {
  return (
    <article className={`scheduled-card ${task.enabled ? '' : 'disabled'}`}>
      <div className="scheduled-card-main">
        <button
          type="button"
          className={`switch-control ${task.enabled ? 'on' : ''}`}
          role="switch"
          aria-checked={task.enabled}
          aria-label={`${task.enabled ? '停用' : '启用'} ${task.name}`}
          onClick={onToggle}
        ><span /></button>
        <div className="scheduled-card-copy">
          <div className="scheduled-card-name">
            <strong>{task.name}</strong>
            {(activeRun ?? latestRun) && <RunBadge run={(activeRun ?? latestRun)!} />}
          </div>
          <p>{task.prompt}</p>
          <div className="scheduled-card-meta">
            <span>{project?.name ?? task.cwd}</span>
            <span>{scheduleLabel(task)}</span>
            <span>{task.timezone}</span>
          </div>
          {task.healthError && <div className="scheduled-health-error"><CircleAlert size={13} />{task.healthError}</div>}
          <div className="scheduled-next">
            <Clock3 size={13} />
            {task.enabled && task.nextRunAt
              ? `下次 ${formatDateTime(task.nextRunAt, task.timezone)}`
              : '已停用'}
          </div>
        </div>
      </div>
      <div className="scheduled-card-actions">
        <button onClick={onRun} disabled={!runtimeReady || Boolean(activeRun)}><Play size={14} /> 立即运行</button>
        <button onClick={onEdit}><Pencil size={14} /> 编辑</button>
        <button onClick={onHistory}><History size={14} /> 记录</button>
        {task.threadId && <button onClick={onOpenThread}>打开对话</button>}
        <button className="danger" onClick={onDelete} disabled={Boolean(activeRun)} aria-label="删除任务"><Trash2 size={14} /></button>
      </div>
    </article>
  );
}

function RunHistory({
  task,
  runs,
  onClose,
  onOpenThread,
}: {
  task: ScheduledTask;
  runs: ScheduledRun[];
  onClose(): void;
  onOpenThread(): void;
}) {
  const brandName = useAppStore((state) => state.branding.name);
  return (
    <aside className="scheduled-history">
      <header>
        <div><strong>运行记录</strong><span>{task.name}</span></div>
        <button className="icon-button" onClick={onClose} aria-label="关闭运行记录"><X size={16} /></button>
      </header>
      {task.threadId && <button className="history-thread-button" onClick={onOpenThread}>打开固定对话</button>}
      <div className="scheduled-history-list">
        {runs.length === 0 ? <div className="scheduled-history-empty">尚未运行</div> : runs.map((run) => (
          <div className="scheduled-run" key={run.id}>
            <div><RunBadge run={run} /><span>{run.trigger === 'manual' ? '手动' : '定时'}</span></div>
            <time>{formatDateTime(run.scheduledAt, task.timezone)}</time>
            {run.error && <p>{run.error}</p>}
            {run.status === 'skipped' && <p>{skippedReasonLabel(run.skippedReason, brandName)}</p>}
          </div>
        ))}
      </div>
    </aside>
  );
}

function TaskEditor({
  draft: initialDraft,
  projects,
  models,
  onClose,
  onSave,
}: {
  draft: TaskDraft;
  projects: LocalProject[];
  models: ReturnType<typeof useAppStore.getState>['models'];
  onClose(): void;
  onSave(draft: TaskDraft, pluginContexts: ScheduledPluginContext[]): Promise<void>;
}) {
  const [draft, setDraft] = useState(initialDraft);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { descriptors, composerContexts, setComposerContext } = usePluginHost();
  const contextId = `schedule:${draft.id}`;
  const widgets = useMemo(() => descriptors.flatMap((descriptor) => descriptor.uiContributions
    .filter((contribution) => contribution.type === 'widget' && contribution.placement === 'composer')
    .map((contribution) => ({ descriptor, contribution }))), [descriptors]);

  useEffect(() => {
    for (const context of initialDraft.pluginContexts ?? []) {
      setComposerContext(context.pluginId, context.contributionId, contextId, {
        label: context.label,
        value: context.value,
        ...(context.toolHints?.length ? { explicitTools: context.toolHints } : {}),
      });
    }
  }, []);

  const preset = executionPresetFor(draft);
  const setExecutionPreset = (value: ExecutionPreset) => {
    const execution = executionPresetPreferences(value);
    if (execution) setDraft((current) => ({ ...current, ...execution }));
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const pluginContexts = widgets.flatMap(({ descriptor, contribution }) => {
        const value = composerContextFor(composerContexts, descriptor, contribution, contextId);
        return value ? [{
          pluginId: descriptor.pluginId,
          contributionId: contribution.id,
          label: value.label,
          value: value.value,
          ...(value.explicitTools?.length ? { toolHints: value.explicitTools } : {}),
        }] : [];
      });
      await onSave(draft, pluginContexts);
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content scheduled-editor">
          <div className="scheduled-editor-header">
            <div><Dialog.Title>{initialDraft.id === draft.id && initialDraft.name ? '编辑定时任务' : '新建定时任务'}</Dialog.Title><Dialog.Description>每个任务使用一条固定对话，运行记录不会混入其他线程。</Dialog.Description></div>
            <Dialog.Close asChild><button className="icon-button" aria-label="关闭"><X size={17} /></button></Dialog.Close>
          </div>
          <form onSubmit={(event) => void submit(event)}>
            <div className="scheduled-form-grid">
              <label className="span-2"><span>任务名称</span><input required value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="例如：每日整理项目进展" /></label>
              <label className="span-2"><span>项目</span><select value={draft.projectId} onChange={(event) => {
                const project = projects.find((entry) => entry.id === event.target.value);
                if (project) setDraft({ ...draft, projectId: project.id, cwd: project.path });
              }}>{projects.map((project) => <option key={project.id} value={project.id}>{project.name} · {project.path}</option>)}</select></label>
              <label className="span-2"><span>任务说明</span><textarea required rows={5} value={draft.prompt} onChange={(event) => setDraft({ ...draft, prompt: event.target.value })} placeholder="描述每次触发时要完成的工作" /></label>

              <label><span>运行频率</span><select value={draft.preset} onChange={(event) => setDraft({ ...draft, preset: event.target.value as ScheduledTaskPreset })}>
                <option value="hourly">每小时</option><option value="daily">每天</option><option value="weekdays">工作日</option><option value="weekly">每周</option><option value="custom">高级 Cron</option>
              </select></label>
              {draft.preset === 'hourly' ? (
                <label><span>每小时第几分钟</span><input type="number" min={0} max={59} value={draft.minute} onChange={(event) => setDraft({ ...draft, minute: Number(event.target.value) })} /></label>
              ) : draft.preset === 'custom' ? (
                <label><span>5 段 Cron</span><input value={draft.cron} onChange={(event) => setDraft({ ...draft, cron: event.target.value })} placeholder="0 9 * * 1-5" /></label>
              ) : (
                <label><span>时间</span><input type="time" value={draft.time} onChange={(event) => setDraft({ ...draft, time: event.target.value })} /></label>
              )}
              {draft.preset === 'weekly' && <label><span>星期</span><select value={draft.weekday} onChange={(event) => setDraft({ ...draft, weekday: Number(event.target.value) })}>{['日','一','二','三','四','五','六'].map((name, index) => <option key={name} value={index}>星期{name}</option>)}</select></label>}
              <label className={draft.preset === 'weekly' ? '' : 'span-1'}><span>时区</span><input list="scheduled-timezones" required value={draft.timezone} onChange={(event) => setDraft({ ...draft, timezone: event.target.value })} /><datalist id="scheduled-timezones">{timezones().map((zone) => <option key={zone} value={zone} />)}</datalist></label>

              <label><span>模型</span><select value={draft.model ?? ''} onChange={(event) => setDraft({ ...draft, model: event.target.value || undefined })}><option value="">使用默认模型</option>{models.map((model) => <option key={model.model} value={model.model}>{model.displayName}</option>)}</select></label>
              <label><span>推理强度</span><select value={draft.effort} onChange={(event) => setDraft({ ...draft, effort: event.target.value })}><option value="low">低</option><option value="medium">中</option><option value="high">高</option><option value="xhigh">超高</option></select></label>
              <label className="span-2"><span>执行权限</span><select value={preset} onChange={(event) => setExecutionPreset(event.target.value as ExecutionPreset)}><option value="safe">安全只读</option><option value="recommended">标准代理（推荐）</option><option value="model-request">模型按需申请</option><option value="yolo">YOLO（完全访问且不审批）</option>{preset === 'custom' && <option value="custom">自定义组合</option>}</select></label>
              {preset === 'yolo' && <div className="scheduled-yolo-warning span-2"><CircleAlert size={15} />任务可在没有确认的情况下读写任意路径并执行命令。</div>}
            </div>

            {widgets.length > 0 && <section className="scheduled-plugin-contexts"><div><strong>插件输入</strong><span>可选。配置会随每次任务运行发送。</span></div><div className="scheduled-plugin-widgets">{widgets.map(({ descriptor, contribution }) => <div className="scheduled-plugin-widget" key={`${descriptor.pluginId}:${contribution.id}`}><span>{descriptor.displayName}</span><PluginUiFrame descriptor={descriptor} contribution={contribution} threadId={contextId} fallback={<small>插件输入暂不可用</small>} /></div>)}</div></section>}

            {error && <div className="scheduled-form-error"><CircleAlert size={14} />{error}</div>}
            <div className="scheduled-editor-actions">
              <label className="scheduled-enabled"><input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} /> 启用任务</label>
              <div><button type="button" onClick={onClose}>取消</button><button className="primary-button" type="submit" disabled={saving}>{saving ? <LoaderCircle className="spin" size={15} /> : <CheckCircle2 size={15} />} 保存</button></div>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function applyScheduleEvent(
  event: WhaleEvent,
  setTasks: React.Dispatch<React.SetStateAction<ScheduledTask[]>>,
  setRuns: React.Dispatch<React.SetStateAction<Record<string, ScheduledRun[]>>>,
) {
  if (event.kind !== 'runtime') return;
  if (event.event.type === 'scheduledTasksChanged') setTasks(event.event.tasks);
  if (event.event.type === 'scheduledRunUpdated') mergeRun(setRuns, event.event.run);
}

function mergeRun(
  setRuns: React.Dispatch<React.SetStateAction<Record<string, ScheduledRun[]>>>,
  run: ScheduledRun,
) {
  setRuns((current) => {
    const existing = current[run.taskId] ?? [];
    const next = [run, ...existing.filter((entry) => entry.id !== run.id)]
      .sort((left, right) => right.scheduledAt - left.scheduledAt)
      .slice(0, 100);
    return { ...current, [run.taskId]: next };
  });
}

function newDraft(project: LocalProject, preferences: Preferences): TaskDraft {
  return {
    id: crypto.randomUUID(),
    name: '',
    projectId: project.id,
    cwd: project.path,
    prompt: '',
    enabled: true,
    preset: 'daily',
    cron: '0 9 * * *',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai',
    model: preferences.model || undefined,
    effort: preferences.effort,
    approvalPolicy: preferences.approvalPolicy,
    sandboxMode: preferences.sandboxMode,
    pluginContexts: [],
    time: '09:00',
    minute: 0,
    weekday: 1,
  };
}

function draftFromTask(task: ScheduledTask): TaskDraft {
  const fields = task.cron.trim().split(/\s+/);
  const hour = Number(fields[1]);
  return {
    ...taskInput(task),
    id: task.id,
    time: `${String(Number.isFinite(hour) ? hour : 9).padStart(2, '0')}:${String(Number(fields[0]) || 0).padStart(2, '0')}`,
    minute: Number(fields[0]) || 0,
    weekday: Number(fields[4]) || 1,
  };
}

function taskInputFromDraft(draft: TaskDraft, pluginContexts: ScheduledPluginContext[]): ScheduledTaskInput {
  let cron = draft.cron.trim();
  const [hour, minute] = draft.time.split(':').map(Number);
  if (draft.preset === 'hourly') cron = `${Math.min(59, Math.max(0, draft.minute))} * * * *`;
  if (draft.preset === 'daily') cron = `${minute} ${hour} * * *`;
  if (draft.preset === 'weekdays') cron = `${minute} ${hour} * * 1-5`;
  if (draft.preset === 'weekly') cron = `${minute} ${hour} * * ${draft.weekday}`;
  return { ...taskInput(draft), name: draft.name.trim(), prompt: draft.prompt.trim(), cron, pluginContexts };
}

function taskInput(task: ScheduledTaskInput): ScheduledTaskInput {
  return {
    name: task.name,
    projectId: task.projectId,
    cwd: task.cwd,
    prompt: task.prompt,
    enabled: task.enabled,
    preset: task.preset,
    cron: task.cron,
    timezone: task.timezone,
    ...(task.model ? { model: task.model } : {}),
    effort: task.effort,
    approvalPolicy: task.approvalPolicy,
    sandboxMode: task.sandboxMode,
    ...(task.pluginContexts ? { pluginContexts: task.pluginContexts } : {}),
  };
}

function timezones(): string[] {
  try {
    return Intl.supportedValuesOf('timeZone');
  } catch {
    return COMMON_TIMEZONES;
  }
}

function scheduleLabel(task: ScheduledTask): string {
  const fields = task.cron.split(/\s+/);
  const time = `${String(Number(fields[1]) || 0).padStart(2, '0')}:${String(Number(fields[0]) || 0).padStart(2, '0')}`;
  if (task.preset === 'hourly') return `每小时 ${fields[0]} 分`;
  if (task.preset === 'daily') return `每天 ${time}`;
  if (task.preset === 'weekdays') return `工作日 ${time}`;
  if (task.preset === 'weekly') return `每周${['日','一','二','三','四','五','六'][Number(fields[4])] ?? ''} ${time}`;
  return `Cron ${task.cron}`;
}

function RunBadge({ run }: { run: ScheduledRun }) {
  const labels: Record<ScheduledRun['status'], string> = {
    running: '运行中', waitingApproval: '等待审批', completed: '完成', failed: '失败', skipped: '已跳过',
  };
  return <span className={`scheduled-run-badge ${run.status}`}>{run.status === 'running' && <LoaderCircle className="spin" size={11} />}{labels[run.status]}</span>;
}

function isActive(run?: ScheduledRun): boolean {
  return run?.status === 'running' || run?.status === 'waitingApproval';
}

function skippedReasonLabel(reason: ScheduledRun['skippedReason'], brandName: string): string {
  if (reason === 'missed') return '应用未运行或休眠期间已错过';
  if (reason === 'conflict') return '上一次运行尚未结束';
  if (reason === 'runtimeUnavailable') return `${brandName} 服务不可用`;
  return '本次运行已跳过';
}

function formatDateTime(value: number, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: timezone,
      month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    }).format(value);
  } catch {
    return new Date(value).toLocaleString('zh-CN');
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
