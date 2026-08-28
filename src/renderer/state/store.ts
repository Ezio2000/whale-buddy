import { create } from 'zustand';
import type {
  HistoryPage,
  LocalAttachment,
  LocalProject,
  ModelSummary,
  RuntimeBrandingSettings,
  RuntimeBrandingSettingsInput,
  RuntimeConnectionSettings,
  RuntimeConnectionSettingsInput,
  RuntimeStatus,
  StartTurnInput,
  ThreadSummary,
  WhaleEvent,
} from '../../shared/types';
import { parseComposerInput, type SlashCommandName } from './commands';
import { codexFailureNotice } from './errors';
import { pruneApprovalsForEvent } from './approvals';
import {
  activeTurnForThread,
  applyTurnChanges,
  emptyConversationState,
  hydrateHistory,
  reduceConversation,
  type ConversationState,
} from './conversation';

export interface Preferences {
  theme: 'system' | 'light' | 'dark';
  model: string;
  effort: string;
  approvalPolicy: 'untrusted' | 'on-request' | 'never';
  sandboxMode: 'read-only' | 'workspace-write' | 'danger-full-access';
}

export interface PendingApproval {
  id: string | number;
  method: string;
  params: Record<string, unknown>;
  threadId: string | null;
  turnId: string | null;
  itemId: string | null;
  receivedAt: number;
}

export interface ThreadHistoryLoadState {
  loaded: boolean;
  loadingOlder: boolean;
  turnsCursor: string | null;
  itemsCursor: string | null;
}

interface AppState {
  runtime: RuntimeStatus | null;
  projects: LocalProject[];
  threads: ThreadSummary[];
  models: ModelSummary[];
  connectionSettings: RuntimeConnectionSettings | null;
  branding: RuntimeBrandingSettings;
  selectedProjectId: string | null;
  selectedThreadId: string | null;
  conversation: ConversationState;
  historyByThread: Record<string, ThreadHistoryLoadState>;
  approvals: PendingApproval[];
  preferences: Preferences;
  rightPanelOpen: boolean;
  settingsOpen: boolean;
  pluginMarketplaceOpen: boolean;
  commandPaletteOpen: boolean;
  busy: boolean;
  notice: string | null;
  workspaceView: 'conversation' | 'schedules';
  initialize(): Promise<void>;
  recover(): Promise<void>;
  handleEvent(event: WhaleEvent): void;
  openProject(): Promise<void>;
  removeProject(projectId: string): Promise<void>;
  selectProject(projectId: string): void;
  refreshThreads(): Promise<void>;
  newThread(): Promise<void>;
  selectThread(threadId: string): Promise<void>;
  loadOlderHistory(threadId?: string): Promise<void>;
  forkThread(threadId?: string): Promise<void>;
  renameThread(name: string, threadId?: string): Promise<void>;
  archiveThread(threadId?: string): Promise<void>;
  deleteThread(threadId?: string): Promise<void>;
  sendComposer(
    text: string,
    attachments?: LocalAttachment[],
    mentions?: Array<{ name: string; path: string }>,
    explicitSkills?: StartTurnInput['explicitSkills'],
    explicitTools?: StartTurnInput['explicitTools'],
    pluginContexts?: StartTurnInput['pluginContexts'],
  ): Promise<boolean>;
  interrupt(): Promise<void>;
  respondApproval(approval: PendingApproval, response: unknown): Promise<void>;
  updatePreferences(patch: Partial<Preferences>, syncCodex?: boolean): Promise<void>;
  applyRuntimeSettings(input: RuntimeConnectionSettingsInput): Promise<RuntimeConnectionSettings>;
  applyBrandingSettings(input: RuntimeBrandingSettingsInput): Promise<RuntimeBrandingSettings>;
  setRightPanel(open: boolean): void;
  setSettingsOpen(open: boolean): void;
  setPluginMarketplaceOpen(open: boolean): void;
  setCommandPaletteOpen(open: boolean): void;
  setNotice(notice: string | null): void;
  setWorkspaceView(view: 'conversation' | 'schedules'): void;
}

const defaultPreferences: Preferences = {
  theme: 'system',
  model: '',
  effort: 'medium',
  approvalPolicy: 'untrusted',
  sandboxMode: 'workspace-write',
};

const defaultBranding: RuntimeBrandingSettings = {
  name: 'AI小鲸',
  iconPath: '',
  iconUrl: null,
};

const APPROVAL_BEHAVIOR_VERSION = 2;
const HISTORY_TURNS_PAGE_SIZE = 20;
const HISTORY_ITEMS_PAGE_SIZE = 50;

export const useAppStore = create<AppState>((set, get) => ({
  runtime: null,
  projects: [],
  threads: [],
  models: [],
  connectionSettings: null,
  branding: defaultBranding,
  selectedProjectId: null,
  selectedThreadId: readSessionValue('selectedThreadId'),
  conversation: emptyConversationState(),
  historyByThread: {},
  approvals: [],
  preferences: readPreferences(),
  rightPanelOpen: false,
  settingsOpen: false,
  pluginMarketplaceOpen: false,
  commandPaletteOpen: false,
  busy: false,
  notice: null,
  workspaceView: 'conversation',

  async initialize() {
    set({ busy: true, notice: null });
    try {
      const [runtime, projects, connectionSettings, branding] = await Promise.all([
        window.whale.runtime.status(),
        window.whale.projects.list(),
        window.whale.runtime.settings(),
        window.whale.runtime.branding(),
      ]);
      const selectedProjectId =
        readSessionValue('selectedProjectId') ?? projects[0]?.id ?? null;
      document.title = branding.name;
      set({ runtime, projects, connectionSettings, branding, selectedProjectId });
      if (runtime.phase === 'ready') await get().recover();
    } catch (error) {
      set({ notice: errorMessage(error) });
    } finally {
      set({ busy: false });
    }
  },

  async recover() {
    const [modelsResult, projectsResult, threadsResult] = await Promise.allSettled([
      window.whale.models.list(),
      window.whale.projects.list(),
      loadAllThreadsFromServer(),
    ] as const);
    if (modelsResult.status === 'fulfilled') set({ models: extractModels(modelsResult.value) });
    if (projectsResult.status === 'fulfilled') {
      const selectedProjectId = projectsResult.value.some(
        (project) => project.id === get().selectedProjectId,
      )
        ? get().selectedProjectId
        : projectsResult.value[0]?.id ?? null;
      set({ projects: projectsResult.value, selectedProjectId });
      writeSessionValue('selectedProjectId', selectedProjectId);
    }
    if (threadsResult.status === 'fulfilled') set({ threads: threadsResult.value });

    const state = get();
    const selectedThread = state.threads.find((thread) => thread.id === state.selectedThreadId);
    const selectedThreadId =
      selectedThread && ownerProjectId(selectedThread, state.projects) === state.selectedProjectId
        ? selectedThread.id
        : firstThreadForProject(state.threads, state.projects, state.selectedProjectId)?.id ?? null;
    writeSessionValue('selectedThreadId', selectedThreadId);
    set({ selectedThreadId });

    if (selectedThreadId) {
      try {
        await restoreThread(selectedThreadId, set, get);
      } catch (error) {
        set({ notice: `恢复线程失败：${errorMessage(error)}` });
      }
    }
  },

  handleEvent(event) {
    if (event.kind === 'runtime') {
      if (event.event.type === 'status') {
        const previousRuntime = get().runtime;
        const previousPhase = previousRuntime?.phase;
        const connectionChanged =
          previousRuntime != null && previousRuntime.generation !== event.event.status.generation;
        set({
          runtime: event.event.status,
          ...(connectionChanged || event.event.status.phase !== 'ready' ? { approvals: [] } : {}),
        });
        if (event.event.status.phase === 'ready' && previousPhase !== 'ready') {
          void get().recover();
        }
      } else if (event.event.type === 'diagnostic') {
        set({ notice: event.event.message });
      } else if (event.event.type === 'menu') {
        switch (event.event.command) {
          case 'open-project':
            void get().openProject();
            break;
          case 'new-thread':
            void get().newThread();
            break;
          case 'command-palette':
            set({ commandPaletteOpen: true });
            break;
          case 'toggle-diff':
            set((state) => ({ rightPanelOpen: !state.rightPanelOpen }));
            break;
        }
      } else if (event.event.type === 'turnChanges') {
        const { threadId, snapshot } = event.event;
        set((state) => ({
          conversation: applyTurnChanges(
            state.conversation,
            threadId,
            snapshot,
          ),
          rightPanelOpen: true,
        }));
      }
      return;
    }

    if (event.kind === 'serverRequest') {
      const params = record(event.message.params) ?? {};
      const approval: PendingApproval = {
        id: event.message.id,
        method: event.message.method,
        params,
        threadId: string(params.threadId),
        turnId: string(params.turnId),
        itemId: string(params.itemId),
        receivedAt: Date.now(),
      };
      set((state) => ({
        approvals: [
          ...state.approvals.filter((candidate) => requestKey(candidate.id) !== requestKey(approval.id)),
          approval,
        ],
      }));
      return;
    }

    const revealsDetails = event.message.method === 'turn/plan/updated'
      || event.message.method === 'turn/diff/updated';
    set((state) => ({
      conversation: reduceConversation(state.conversation, event),
      approvals: pruneApprovalsForEvent(state.approvals, event),
      ...(revealsDetails ? { rightPanelOpen: true } : {}),
    }));
    const params = record(event.message.params);
    switch (event.message.method) {
      case 'serverRequest/resolved': {
        break;
      }
      case 'turn/completed': {
        void get().refreshThreads();
        const turn = record(params?.turn);
        if (string(turn?.status) === 'failed') {
          set({ notice: codexFailureNotice(turn?.error, '本回合执行失败') });
        }
        break;
      }
      case 'thread/name/updated':
      case 'thread/archived':
      case 'thread/deleted':
        void get().refreshThreads();
        break;
      case 'error':
      case 'warning':
        set({ notice: codexFailureNotice(params?.error ?? params, 'Codex 返回了错误') });
        break;
    }
  },

  async openProject() {
    try {
      const project = await window.whale.projects.open();
      if (!project) return;
      const projects = await window.whale.projects.list();
      writeSessionValue('selectedProjectId', project.id);
      set({ projects, selectedProjectId: project.id, selectedThreadId: null });
      writeSessionValue('selectedThreadId', null);
      await get().refreshThreads();
      const thread = firstThreadForProject(get().threads, projects, project.id);
      if (thread) await get().selectThread(thread.id);
    } catch (error) {
      set({ notice: errorMessage(error) });
    }
  },

  async removeProject(projectId) {
    await window.whale.projects.remove(projectId);
    const projects = await window.whale.projects.list();
    const selectedProjectId =
      get().selectedProjectId === projectId ? projects[0]?.id ?? null : get().selectedProjectId;
    const selectedThreadId =
      selectedProjectId === get().selectedProjectId ? get().selectedThreadId : null;
    set({ projects, selectedProjectId, selectedThreadId });
    writeSessionValue('selectedProjectId', selectedProjectId);
    writeSessionValue('selectedThreadId', selectedThreadId);
    if (selectedProjectId && selectedThreadId === null) get().selectProject(selectedProjectId);
  },

  selectProject(projectId) {
    writeSessionValue('selectedProjectId', projectId);
    const previousThreadId = get().selectedThreadId;
    const currentThread = get().threads.find((thread) => thread.id === previousThreadId);
    const thread =
      currentThread && ownerProjectId(currentThread, get().projects) === projectId
        ? currentThread
        : firstThreadForProject(get().threads, get().projects, projectId);
    const selectedThreadId = thread?.id ?? null;
    writeSessionValue('selectedThreadId', selectedThreadId);
    set({ selectedProjectId: projectId, selectedThreadId });
    if (thread && thread.id !== previousThreadId) void get().selectThread(thread.id);
  },

  async refreshThreads() {
    try {
      set({ threads: await loadAllThreadsFromServer() });
    } catch (error) {
      set({ notice: errorMessage(error) });
    }
  },

  async newThread() {
    const project = selectedProject(get());
    if (!project) {
      set({ notice: '请先打开一个本地项目' });
      return;
    }
    set({ busy: true });
    try {
      const { preferences } = get();
      const result = await window.whale.threads.start({
        cwd: project.path,
        ...(preferences.model ? { model: preferences.model } : {}),
        approvalPolicy: preferences.approvalPolicy,
        sandboxMode: preferences.sandboxMode,
      });
      const thread = record(result)?.thread;
      const threadId = string(record(thread)?.id);
      await get().refreshThreads();
      if (threadId) {
        writeSessionValue('selectedThreadId', threadId);
        set((state) => ({
          selectedThreadId: threadId,
          historyByThread: {
            ...state.historyByThread,
            [threadId]: {
              loaded: true,
              loadingOlder: false,
              turnsCursor: null,
              itemsCursor: null,
            },
          },
        }));
      }
    } catch (error) {
      set({ notice: errorMessage(error) });
    } finally {
      set({ busy: false });
    }
  },

  async selectThread(threadId) {
    writeSessionValue('selectedThreadId', threadId);
    set({ selectedThreadId: threadId, busy: true, notice: null });
    try {
      await restoreThread(threadId, set, get);
    } catch (error) {
      set({ notice: errorMessage(error) });
    } finally {
      set({ busy: false });
    }
  },

  async loadOlderHistory(requestedThreadId) {
    const threadId = requestedThreadId ?? get().selectedThreadId;
    if (!threadId) return;
    const history = get().historyByThread[threadId];
    if (!history?.loaded || history.loadingOlder) return;
    if (history.turnsCursor === null && history.itemsCursor === null) return;
    set((state) => ({
      historyByThread: {
        ...state.historyByThread,
        [threadId]: { ...history, loadingOlder: true },
      },
    }));
    try {
      const page = normalizeDescendingHistoryPage(await window.whale.threads.readHistory({
        threadId,
        turnsCursor: history.turnsCursor,
        itemsCursor: history.itemsCursor,
        turnsLimit: HISTORY_TURNS_PAGE_SIZE,
        itemsLimit: HISTORY_ITEMS_PAGE_SIZE,
        sortDirection: 'desc',
      }));
      set((state) => ({
        conversation: hydrateHistory(state.conversation, threadId, page, 'prepend'),
        historyByThread: {
          ...state.historyByThread,
          [threadId]: {
            loaded: true,
            loadingOlder: false,
            turnsCursor: page.turnsNextCursor,
            itemsCursor: page.itemsNextCursor,
          },
        },
      }));
    } catch (error) {
      set((state) => ({
        notice: `加载更早记录失败：${errorMessage(error)}`,
        historyByThread: {
          ...state.historyByThread,
          [threadId]: { ...history, loadingOlder: false },
        },
      }));
    }
  },

  async forkThread(requestedThreadId) {
    const threadId = requestedThreadId ?? get().selectedThreadId;
    if (!threadId) return;
    try {
      const result = await window.whale.threads.fork(threadId);
      const newId = string(record(record(result)?.thread)?.id);
      await get().refreshThreads();
      if (newId) await get().selectThread(newId);
    } catch (error) {
      set({ notice: errorMessage(error) });
    }
  },

  async renameThread(name, requestedThreadId) {
    const threadId = requestedThreadId ?? get().selectedThreadId;
    if (!threadId) return;
    await window.whale.threads.rename(threadId, name);
    await get().refreshThreads();
  },

  async archiveThread(requestedThreadId) {
    const threadId = requestedThreadId ?? get().selectedThreadId;
    if (!threadId) return;
    await window.whale.threads.archive(threadId);
    if (get().selectedThreadId === threadId) {
      writeSessionValue('selectedThreadId', null);
      set({ selectedThreadId: null });
    }
    await get().refreshThreads();
  },

  async deleteThread(requestedThreadId) {
    const threadId = requestedThreadId ?? get().selectedThreadId;
    if (!threadId) return;
    await window.whale.threads.delete(threadId);
    const nextHistory = { ...get().historyByThread };
    delete nextHistory[threadId];
    if (get().selectedThreadId === threadId) writeSessionValue('selectedThreadId', null);
    set({
      historyByThread: nextHistory,
      ...(get().selectedThreadId === threadId ? { selectedThreadId: null } : {}),
    });
    await get().refreshThreads();
  },

  async sendComposer(
    text,
    attachments = [],
    mentions = [],
    explicitSkills = [],
    explicitTools = [],
    pluginContexts = [],
  ) {
    const parsed = parseComposerInput(text);
    if (parsed.kind === 'unknown') {
      set({ notice: `未知命令：/${parsed.command}` });
      return false;
    }
    if (parsed.kind === 'command') {
      await executeCommand(parsed.name, parsed.argument, get, set);
      return true;
    }
    const threadId = get().selectedThreadId;
    const project = selectedProject(get());
    if (!threadId || !project) {
      set({ notice: '请先选择项目并新建或恢复线程' });
      return false;
    }
    const { preferences, conversation } = get();
    const input: StartTurnInput = {
      threadId,
      text: parsed.text,
      attachments,
      mentions,
      explicitSkills,
      explicitTools,
      pluginContexts,
      cwd: project.path,
      ...(preferences.model ? { model: preferences.model } : {}),
      effort: preferences.effort,
      approvalPolicy: preferences.approvalPolicy,
      sandboxMode: preferences.sandboxMode,
    };
    try {
      const activeTurn = activeTurnForThread(conversation, threadId);
      if (activeTurn) await window.whale.turns.steer({ ...input, turnId: activeTurn.id });
      else await window.whale.turns.start(input);
      return true;
    } catch (error) {
      set({ notice: errorMessage(error) });
      return false;
    }
  },

  async interrupt() {
    const threadId = get().selectedThreadId;
    const turn = activeTurnForThread(get().conversation, threadId);
    if (!threadId || !turn) return;
    try {
      await window.whale.turns.interrupt(threadId, turn.id);
    } catch (error) {
      set({ notice: errorMessage(error) });
    }
  },

  async respondApproval(approval, response) {
    try {
      await window.whale.approvals.respond({
        requestId: approval.id,
        method: approval.method,
        response: response as never,
      });
      set((state) => ({
        approvals: state.approvals.filter(
          (candidate) => requestKey(candidate.id) !== requestKey(approval.id),
        ),
      }));
    } catch (error) {
      set({ notice: errorMessage(error) });
    }
  },

  async updatePreferences(patch, syncCodex = true) {
    const preferences = { ...get().preferences, ...patch };
    set({ preferences });
    persistPreferences(preferences);
    if (!syncCodex || get().runtime?.phase !== 'ready') return;
    const writes: Array<Promise<unknown>> = [];
    if (patch.model !== undefined) {
      writes.push(window.whale.config.write({ keyPath: 'model', value: patch.model || null }));
    }
    if (patch.effort !== undefined) {
      writes.push(
        window.whale.config.write({ keyPath: 'model_reasoning_effort', value: patch.effort }),
      );
    }
    if (patch.approvalPolicy !== undefined) {
      writes.push(
        window.whale.config.write({ keyPath: 'approval_policy', value: patch.approvalPolicy }),
      );
    }
    if (patch.sandboxMode !== undefined) {
      writes.push(
        window.whale.config.write({ keyPath: 'sandbox_mode', value: patch.sandboxMode }),
      );
    }
    try {
      await Promise.all(writes);
    } catch (error) {
      set({ notice: `设置已保存在界面，但写入 Codex 配置失败：${errorMessage(error)}` });
    }
  },

  async applyRuntimeSettings(input) {
    try {
      const connectionSettings = await window.whale.runtime.configure(input);
      const preferences = {
        ...get().preferences,
        model: connectionSettings.provider.model,
      };
      persistPreferences(preferences);
      set({
        connectionSettings,
        preferences,
        notice: '网络与 Provider 设置已保存，Codex sidecar 已重新连接。',
      });
      return connectionSettings;
    } catch (error) {
      set({ notice: `保存连接设置失败：${errorMessage(error)}` });
      throw error;
    }
  },

  async applyBrandingSettings(input) {
    try {
      const branding = await window.whale.runtime.configureBranding(input);
      document.title = branding.name;
      set({ branding, notice: '品牌名称与图标已更新。' });
      return branding;
    } catch (error) {
      set({ notice: `保存品牌设置失败：${errorMessage(error)}` });
      throw error;
    }
  },

  setRightPanel: (rightPanelOpen) => set({ rightPanelOpen }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setPluginMarketplaceOpen: (pluginMarketplaceOpen) => set({ pluginMarketplaceOpen }),
  setCommandPaletteOpen: (commandPaletteOpen) => set({ commandPaletteOpen }),
  setNotice: (notice) => set({ notice }),
  setWorkspaceView: (workspaceView) => set({ workspaceView }),
}));

async function executeCommand(
  command: SlashCommandName,
  argument: string,
  get: () => AppState,
  set: (patch: Partial<AppState> | ((state: AppState) => Partial<AppState>)) => void,
): Promise<void> {
  const threadId = get().selectedThreadId;
  switch (command) {
    case 'new':
      return get().newThread();
    case 'resume':
      if (argument) return get().selectThread(argument);
      set({ commandPaletteOpen: true, notice: '请选择要恢复的线程' });
      return;
    case 'fork':
      return get().forkThread();
    case 'rename':
      if (!argument) {
        set({ notice: '用法：/rename 新名称' });
        return;
      }
      return get().renameThread(argument);
    case 'archive':
      return get().archiveThread();
    case 'delete':
      if (!window.confirm('确定永久删除当前线程吗？此操作无法撤销。')) return;
      return get().deleteThread();
    case 'model':
    case 'permissions':
      set({ settingsOpen: true });
      return;
    case 'review':
      if (threadId) await window.whale.turns.review(threadId);
      return;
    case 'compact':
      if (threadId) await window.whale.threads.compact(threadId);
      return;
    case 'diff':
      set((state) => ({ rightPanelOpen: !state.rightPanelOpen }));
      return;
    case 'status': {
      const status = await window.whale.runtime.status();
      set({ notice: `app-server：${status.phase} · ${status.codexVersion ?? '版本未知'}` });
      return;
    }
    case 'quit':
      await window.whale.runtime.quit();
  }
}

async function loadInitialHistory(
  threadId: string,
  set: (patch: Partial<AppState> | ((state: AppState) => Partial<AppState>)) => void,
  get: () => AppState,
): Promise<void> {
  if (get().historyByThread[threadId]?.loaded) return;
  const page = normalizeDescendingHistoryPage(await window.whale.threads.readHistory({
    threadId,
    turnsLimit: HISTORY_TURNS_PAGE_SIZE,
    itemsLimit: HISTORY_ITEMS_PAGE_SIZE,
    sortDirection: 'desc',
  }));
  set((state) => ({
    conversation: hydrateHistory(state.conversation, threadId, page, 'replace'),
    historyByThread: {
      ...state.historyByThread,
      [threadId]: {
        loaded: true,
        loadingOlder: false,
        turnsCursor: page.turnsNextCursor,
        itemsCursor: page.itemsNextCursor,
      },
    },
  }));
}

async function restoreThread(
  threadId: string,
  set: (patch: Partial<AppState> | ((state: AppState) => Partial<AppState>)) => void,
  get: () => AppState,
): Promise<void> {
  // Render persisted history first. Resuming can initialize models, Skills and
  // MCP servers, so it must not hold the first visible history page hostage.
  await loadInitialHistory(threadId, set, get);
  try {
    await window.whale.threads.resume(threadId);
  } catch (error) {
    set({
      notice: `会话记录已加载，但当前无法继续该线程：${errorMessage(error)}`,
    });
  }
}

function normalizeDescendingHistoryPage(page: HistoryPage): HistoryPage {
  return {
    ...page,
    turns: [...page.turns].reverse(),
    items: [...page.items].reverse(),
  };
}

function extractThreads(value: unknown): ThreadSummary[] {
  const data = record(value)?.data;
  if (!Array.isArray(data)) return [];
  return data.flatMap((entry) => {
    const item = record(entry);
    const id = string(item?.id);
    const cwd = string(item?.cwd);
    if (!item || !id || !cwd) return [];
    return [
      {
        ...item,
        id,
        cwd,
        preview: string(item.preview) ?? '',
        name: nullableString(item.name),
        createdAt: number(item.createdAt) ?? 0,
        updatedAt: number(item.updatedAt) ?? 0,
        status: item.status,
      } satisfies ThreadSummary,
    ];
  });
}

async function loadAllThreadsFromServer(): Promise<ThreadSummary[]> {
  const byId = new Map<string, ThreadSummary>();
  let cursor: string | null | undefined = undefined;
  for (let pageNumber = 0; pageNumber < 100; pageNumber += 1) {
    const response = await window.whale.threads.list({ archived: false, cursor });
    for (const thread of extractThreads(response)) byId.set(thread.id, thread);
    cursor = nullableString(record(response)?.nextCursor);
    if (cursor === null) {
      return [...byId.values()].sort((left, right) => right.updatedAt - left.updatedAt);
    }
  }
  throw new Error('线程列表分页超过安全上限');
}

function extractModels(value: unknown): ModelSummary[] {
  const data = record(value)?.data;
  if (!Array.isArray(data)) return [];
  return data.flatMap((entry) => {
    const item = record(entry);
    const id = string(item?.id);
    const model = string(item?.model);
    if (!item || !id || !model) return [];
    return [
      {
        ...item,
        id,
        model,
        displayName: string(item.displayName) ?? model,
        description: string(item.description) ?? '',
        isDefault: item.isDefault === true,
      } satisfies ModelSummary,
    ];
  });
}

function selectedProject(state: AppState): LocalProject | null {
  return state.projects.find((project) => project.id === state.selectedProjectId) ?? null;
}

function firstThreadForProject(
  threads: ThreadSummary[],
  projects: LocalProject[],
  projectId: string | null,
): ThreadSummary | null {
  if (!projectId) return null;
  return threads.find((thread) => ownerProjectId(thread, projects) === projectId) ?? null;
}

function ownerProjectId(thread: ThreadSummary, projects: LocalProject[]): string | null {
  const cwd = normalizePath(thread.cwd);
  return (
    projects
      .filter((project) => {
        const root = normalizePath(project.path);
        return root === '/' ? cwd.startsWith('/') : cwd === root || cwd.startsWith(`${root}/`);
      })
      .sort((left, right) => right.path.length - left.path.length)[0]?.id ?? null
  );
}

function normalizePath(value: string): string {
  return value.replace(/\/+$/, '') || '/';
}

function readPreferences(): Preferences {
  const storage = browserStorage();
  if (!storage) return defaultPreferences;
  try {
    const value = JSON.parse(storage.getItem('whale.preferences.v1') ?? '{}') as Record<string, unknown>;
    const preferences = { ...defaultPreferences, ...value } as Preferences;
    if (
      value.approvalBehaviorVersion !== APPROVAL_BEHAVIOR_VERSION
      && value.approvalPolicy === 'on-request'
    ) {
      preferences.approvalPolicy = 'untrusted';
      storage.setItem('whale.preferences.v1', JSON.stringify({
        ...preferences,
        approvalBehaviorVersion: APPROVAL_BEHAVIOR_VERSION,
      }));
    }
    return preferences;
  } catch {
    return defaultPreferences;
  }
}

function persistPreferences(preferences: Preferences): void {
  browserStorage()?.setItem('whale.preferences.v1', JSON.stringify({
    ...preferences,
    approvalBehaviorVersion: APPROVAL_BEHAVIOR_VERSION,
  }));
}

function readSessionValue(key: string): string | null {
  return browserStorage()?.getItem(`whale.${key}`) ?? null;
}

function writeSessionValue(key: string, value: string | null): void {
  const storage = browserStorage();
  if (!storage) return;
  if (value === null) storage.removeItem(`whale.${key}`);
  else storage.setItem(`whale.${key}`, value);
}

function browserStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    const storage = window.localStorage;
    return typeof storage?.getItem === 'function' ? storage : null;
  } catch {
    return null;
  }
}

function requestKey(value: string | number): string {
  return `${typeof value}:${String(value)}`;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function string(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function nullableString(value: unknown): string | null {
  return value === null ? null : string(value);
}

function number(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
