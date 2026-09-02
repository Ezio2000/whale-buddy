import { BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron';
import path from 'node:path';
import { copyFile, readFile, realpath } from 'node:fs/promises';
import type { ZodType } from 'zod';
import { IPC } from '../shared/ipc';
import type {
  PluginContributionDetails,
  PluginLocationInput,
  RuntimeBrandingSettings,
  ScheduledTask,
  StartTurnInput,
} from '../shared/types';
import {
  approvalResponseSchema,
  attachmentReadSchema,
  artifactCreateSchema,
  artifactIdSchema,
  artifactListSchema,
  authSettingsSchema,
  clipboardAttachmentSchema,
  configReadSchema,
  configWriteSchema,
  fileSearchSchema,
  historySchema,
  hookListSchema,
  hookSetEnabledSchema,
  interruptSchema,
  marketplaceAddSchema,
  marketplaceNameSchema,
  marketplaceUpgradeSchema,
  marketplaceSourceEnabledSchema,
  mcpListSchema,
  mcpLoginSchema,
  mcpSetEnabledSchema,
  pluginListSchema,
  pluginCredentialConfigureSchema,
  pluginLocationSchema,
  pluginUninstallSchema,
  pluginSetEnabledSchema,
  pluginMcpCallSchema,
  projectRemoveSchema,
  runtimeConnectionInputSchema,
  runtimeBrandingInputSchema,
  scheduledTaskCreateSchema,
  scheduledTaskIdSchema,
  scheduledTaskUpdateSchema,
  startTurnSchema,
  steerTurnSchema,
  skillSetEnabledSchema,
  skillsListSchema,
  threadIdSchema,
  threadListSchema,
  threadRenameSchema,
  threadStartSchema,
} from '../shared/validation';
import type { AppServerClient, AppServerWireEvent } from './app-server-client';
import { searchProjectFiles } from './file-search';
import { importAttachmentFromPath, saveClipboardAttachment } from './clipboard-attachments';
import type { ExtensionPolicyStore } from './extension-policy';
import type { ProjectStore } from './projects';
import type { RuntimeSettingsStore } from './runtime-settings';
import type { PluginCredentialStore } from './plugin-credential-store';
import type { TurnPlanStore } from './turn-plans';
import type { TurnChangesStore } from './turn-changes';
import type { WhaleAuthManager } from './auth';
import type { ArtifactStore } from './artifacts';
import { approvalEffect, type OperationStore } from './operations';
import {
  ScheduledTaskScheduler,
  type ScheduledTaskStore,
} from './scheduled-tasks';
import type { MarketplaceUpgradeResponse } from '../generated/protocol/typescript/v2/MarketplaceUpgradeResponse';
import type { PluginListResponse } from '../generated/protocol/typescript/v2/PluginListResponse';
import type { PluginReadResponse } from '../generated/protocol/typescript/v2/PluginReadResponse';
import type { SkillsListResponse } from '../generated/protocol/typescript/v2/SkillsListResponse';
import type { ListMcpServerStatusResponse } from '../generated/protocol/typescript/v2/ListMcpServerStatusResponse';
import type { HooksListResponse } from '../generated/protocol/typescript/v2/HooksListResponse';
import {
  isRetiredPresetSourceName,
  normalizeExtensionName,
  pluginConfigKey,
  pluginMcpConfigKey,
} from '../shared/extension-policy';
import {
  assertPluginMcpPermission,
  pluginDynamicTools,
  pluginMcpHttpConnection,
  pluginRoot,
  readPluginDescriptor,
  replacePluginRegistry,
} from './plugin-host';
import { callPluginMcpTool } from './plugin-mcp-client';
import { readPluginCredentials } from './plugin-credential-manifest';
import { readTextInside, resolvePluginRoot } from './plugin-manifest';
import { hookStateKeyPath, previewPluginHooks } from './plugin-hooks';

interface RegisterIpcOptions {
  auth: WhaleAuthManager;
  appServer: AppServerClient;
  extensionPolicy: ExtensionPolicyStore;
  projects: ProjectStore;
  runtimeSettings: RuntimeSettingsStore;
  pluginCredentials: PluginCredentialStore;
  turnPlans: TurnPlanStore;
  turnChanges: TurnChangesStore;
  operations: OperationStore;
  artifacts: ArtifactStore;
  scheduledTasks: ScheduledTaskStore;
  attachmentsRoot: string;
  window: BrowserWindow;
  updateBranding: (branding: RuntimeBrandingSettings) => void;
  quit: () => void;
}

interface OutstandingRequest {
  id: string | number;
  method: string;
  threadId: string | null;
  turnId: string | null;
}

const EXPOSED_SERVER_REQUESTS = new Set([
  'item/commandExecution/requestApproval',
  'item/fileChange/requestApproval',
  'item/permissions/requestApproval',
  'item/tool/requestUserInput',
  'item/tool/call',
  'mcpServer/elicitation/request',
  'applyPatchApproval',
  'execCommandApproval',
]);

export function registerIpc(options: RegisterIpcOptions): () => void {
  const {
    auth,
    appServer,
    extensionPolicy,
    projects,
    runtimeSettings,
    pluginCredentials,
    turnPlans,
    turnChanges,
    operations,
    artifacts,
    scheduledTasks,
    attachmentsRoot,
    window,
  } = options;
  const channels: string[] = [];
  const outstanding = new Map<string, OutstandingRequest>();
  let eventSequence = 0;
  let eventGeneration = appServer.status().generation;
  let scheduler: ScheduledTaskScheduler | null = null;
  let lastAuthStatus: string | null = null;

  const broadcast = (event: unknown) => {
    if (!window.isDestroyed()) window.webContents.send(IPC.event, event);
  };

  const unsubscribeAuth = auth.subscribe((state) => {
    if (state.status !== lastAuthStatus && state.status !== 'waiting') {
      lastAuthStatus = state.status;
      void auth.identityContext().then((identity) => operations.record({
        identity,
        action: state.status === 'logged-out' ? 'identity.logout' : 'identity.login',
        resource: state.status === 'logged-in' ? { userId: state.user.id } : {},
        outcome: state.status === 'error' ? 'failed' : 'succeeded',
        reason: state.status === 'error' ? state.message : null,
      }));
    }
    eventSequence += 1;
    broadcast({
      kind: 'runtime',
      generation: eventGeneration,
      sequence: eventSequence,
      event: { type: 'authChanged', state },
    });
  });

  const onWire = (wire: AppServerWireEvent) => {
    if (wire.generation !== eventGeneration) {
      eventGeneration = wire.generation;
      eventSequence = 0;
    }
    eventSequence += 1;
    const method = String(wire.message.method ?? '');
    if (wire.kind === 'serverRequest') {
      const id = wire.message.id;
      if ((typeof id !== 'string' && typeof id !== 'number') || !EXPOSED_SERVER_REQUESTS.has(method)) {
        if (typeof id === 'string' || typeof id === 'number') {
          appServer.reject(id, -32601, `此应用不支持服务端请求 ${method}`);
        }
        return;
      }
      const params = asRecord(wire.message.params);
      outstanding.set(requestKey(id), {
        id,
        method,
        threadId: stringValue(params?.threadId),
        turnId: stringValue(params?.turnId),
      });
      const outstandingRequest = outstanding.get(requestKey(id));
      if (
        outstandingRequest?.turnId
        && method !== 'item/tool/requestUserInput'
        && method !== 'item/tool/call'
      ) {
        const requestId = requestKey(id);
        operations.addDecisionByTurn(outstandingRequest.turnId, {
          source: 'tool-approval',
          action: approvalAction(method),
          effect: 'confirm',
          reason: '现有工具或沙箱策略要求用户确认',
          requestId,
        });
      }
      const scheduledTurnId = stringValue(params?.turnId);
      if (scheduledTurnId && method !== 'item/tool/call') {
        scheduler?.handleApprovalStarted(scheduledTurnId);
      }
      broadcast({
        kind: 'serverRequest',
        generation: eventGeneration,
        sequence: eventSequence,
        message: wire.message,
      });
      return;
    }

    const params = asRecord(wire.message.params);
    if (method === 'turn/plan/updated') {
      const turnId = stringValue(params?.turnId);
      const plan = Array.isArray(params?.plan)
        ? params.plan.flatMap((entry) => {
            const step = asRecord(entry);
            const label = stringValue(step?.step);
            const status = stringValue(step?.status);
            return label && status ? [{ step: label, status }] : [];
          })
        : [];
      if (turnId) {
        turnPlans.save({
          turnId,
          explanation: params?.explanation === null ? null : stringValue(params?.explanation),
          plan,
          updatedAt: Date.now(),
        });
      }
    }
    if (method === 'turn/diff/updated') {
      const turnId = stringValue(params?.turnId);
      const diff = stringValue(params?.diff);
      if (turnId && diff !== null) turnChanges.saveDiff(turnId, diff);
    }
    if (method === 'item/started' || method === 'item/completed') {
      const item = asRecord(params?.item);
      const turnId = stringValue(params?.turnId) ?? stringValue(item?.turnId);
      const action = auditItemAction(stringValue(item?.type));
      if (turnId && action) {
        operations.addActivityByTurn(turnId, action, method === 'item/completed' ? 'succeeded' : 'started');
      }
    }
    if (method === 'serverRequest/resolved') {
      const requestId = params?.requestId;
      if (typeof requestId === 'string' || typeof requestId === 'number') {
        const request = outstanding.get(requestKey(requestId));
        if (request?.turnId && request.method !== 'item/tool/call') {
          scheduler?.handleApprovalResolved(request.turnId);
        }
        outstanding.delete(requestKey(requestId));
      }
    }
    if (method === 'turn/completed') {
      const turn = asRecord(params?.turn);
      const turnId = stringValue(turn?.id) ?? stringValue(params?.turnId);
      const threadId = stringValue(params?.threadId);
      if (turnId) {
        const status = stringValue(turn?.status) ?? 'completed';
        operations.completeTurn(turnId, status, auditError(turn?.error));
        scheduler?.handleTurnCompleted(
          turnId,
          status,
          turn?.error,
        );
        for (const [key, request] of outstanding) {
          if (request.turnId === turnId) outstanding.delete(key);
        }
        if (threadId) {
          void turnChanges.complete(turnId).then((snapshot) => {
            if (!snapshot) return;
            eventSequence += 1;
            broadcast({
              kind: 'runtime',
              generation: eventGeneration,
              sequence: eventSequence,
              event: { type: 'turnChanges', threadId, snapshot },
            });
          });
        }
      }
    }
    broadcast({
      kind: 'notification',
      generation: eventGeneration,
      sequence: eventSequence,
      message: wire.message,
    });
  };

  const onStatus = (status: ReturnType<AppServerClient['status']>) => {
    if (status.generation !== eventGeneration) {
      eventGeneration = status.generation;
      eventSequence = 0;
      outstanding.clear();
    }
    eventSequence += 1;
    if (status.phase !== 'ready') {
      scheduler?.handleRuntimeUnavailable(status.message ?? 'Codex app-server 当前不可用');
    }
    broadcast({
      kind: 'runtime',
      generation: eventGeneration,
      sequence: eventSequence,
      event: { type: 'status', status },
    });
  };

  const onDiagnostic = (diagnostic: { level: 'info' | 'warning' | 'error'; message: string }) => {
    eventSequence += 1;
    broadcast({
      kind: 'runtime',
      generation: eventGeneration,
      sequence: eventSequence,
      event: { type: 'diagnostic', ...diagnostic },
    });
  };

  appServer.on('wire', onWire);
  appServer.on('status', onStatus);
  appServer.on('diagnostic', onDiagnostic);

  const handle = <T>(channel: string, schema: ZodType<T> | null, callback: (value: T) => unknown) => {
    channels.push(channel);
    ipcMain.handle(channel, async (event: IpcMainInvokeEvent, raw: unknown) => {
      assertTrustedSender(event, window);
      const value = schema ? schema.parse(raw ?? {}) : (undefined as T);
      return callback(value);
    });
  };

  const writeConfigValue = (keyPath: string, value: unknown) =>
    appServer.request('config/value/write', {
      keyPath,
      value,
      mergeStrategy: 'replace',
      expectedVersion: null,
    });

  const writeHookStates = (
    entries: Array<{ key: string; enabled: boolean; trustedHash?: string | null }>,
  ) => {
    if (entries.length === 0) return Promise.resolve();
    return appServer.request('config/batchWrite', {
      edits: entries.map((entry) => ({
        keyPath: hookStateKeyPath(entry.key),
        value: {
          enabled: entry.enabled,
          ...(entry.trustedHash !== undefined ? { trusted_hash: entry.trustedHash } : {}),
        },
        mergeStrategy: 'upsert',
      })),
      filePath: null,
      expectedVersion: null,
      reloadUserConfig: true,
    });
  };

  const listHooks = (cwd?: string) => appServer.request('hooks/list', {
    cwds: cwd ? [cwd] : [],
  }) as Promise<HooksListResponse>;

  const loadAndReconcileSkills = async (input: {
    cwd?: string;
    forceReload?: boolean;
  }): Promise<SkillsListResponse> => {
    const requestSkills = (forceReload: boolean) =>
      appServer.request('skills/list', {
        cwds: input.cwd ? [input.cwd] : [],
        forceReload,
      }) as Promise<SkillsListResponse>;
    let response = await requestSkills(input.forceReload ?? false);
    let changed = false;
    for (const entry of response.data) {
      for (const skill of entry.skills) {
        const allowed = skill.scope === 'system'
          ? false
          : skill.pluginId
            ? extensionPolicy.isPluginEnabled(skill.pluginId)
            : false;
        if (!allowed && skill.enabled) {
          await appServer.request('skills/config/write', {
            path: skill.path,
            name: null,
            enabled: false,
          });
          changed = true;
        }
      }
    }
    if (changed) response = await requestSkills(true);
    return {
      ...response,
      data: response.data.map((entry) => ({
        ...entry,
        skills: entry.skills.filter((skill) => skill.pluginId !== null),
      })),
    };
  };

  const executeScheduledTask = async (task: ScheduledTask) => {
    await loadAndReconcileSkills({ cwd: task.cwd });
    let threadId = task.threadId;
    if (threadId) {
      try {
        await appServer.request('thread/resume', { threadId, excludeTurns: true });
      } catch (error) {
        if (!isThreadMissingError(error)) throw error;
        threadId = null;
      }
    }
    if (!threadId) {
      await loadPluginDescriptors();
      const response = asRecord(await appServer.request('thread/start', {
        cwd: task.cwd,
        model: task.model ?? null,
        approvalPolicy: task.approvalPolicy,
        sandbox: task.sandboxMode,
        ephemeral: false,
        dynamicTools: pluginDynamicTools(),
      }));
      threadId = stringValue(asRecord(response?.thread)?.id);
      if (!threadId) throw new Error('创建定时任务线程失败');
      scheduledTasks.setThread(task.id, threadId);
      await appServer.request('thread/name/set', { threadId, name: `定时任务 · ${task.name}` });
    }
    const before = await turnChanges.capture(task.cwd);
    const input: StartTurnInput = {
      threadId,
      text: task.prompt,
      pluginContexts: task.pluginContexts,
      cwd: task.cwd,
      ...(task.model ? { model: task.model } : {}),
      ...(runtimeSettings.read().provider.capabilities.supportsReasoning
        ? { effort: task.effort }
        : {}),
      approvalPolicy: task.approvalPolicy,
      sandboxMode: task.sandboxMode,
    };
    const operationId = operations.start({
      identity: await auth.identityContext(),
      action: 'turn.execute',
      resource: {
        source: 'schedule',
        taskId: task.id,
        sandboxMode: task.sandboxMode,
        approvalPolicy: task.approvalPolicy,
      },
      threadId,
    });
    operations.addDecisionByOperation(operationId, {
      source: 'execution-policy',
      action: 'turn.execute',
      effect: 'allow',
      reason: '定时任务执行预设已通过现有校验',
      requestId: null,
    });
    let response: Record<string, unknown> | null;
    try {
      response = asRecord(await appServer.request('turn/start', buildTurnParams(input)));
    } catch (error) {
      operations.fail(operationId, errorMessage(error));
      throw error;
    }
    const turnId = stringValue(asRecord(response?.turn)?.id);
    if (!turnId) {
      operations.fail(operationId, 'app-server 未返回定时任务回合 ID');
      throw new Error('启动定时任务回合失败');
    }
    operations.attachTurn(operationId, threadId, turnId);
    turnChanges.begin(turnId, task.cwd, before);
    return { threadId, turnId };
  };

  const broadcastScheduledTasks = (tasks: ScheduledTask[]) => {
    eventSequence += 1;
    broadcast({
      kind: 'runtime', generation: eventGeneration, sequence: eventSequence,
      event: { type: 'scheduledTasksChanged', tasks },
    });
  };
  scheduler = new ScheduledTaskScheduler(
    scheduledTasks,
    {
      isReady: () => appServer.status().phase === 'ready',
      execute: executeScheduledTask,
    },
    broadcastScheduledTasks,
    (run) => {
      eventSequence += 1;
      broadcast({
        kind: 'runtime', generation: eventGeneration, sequence: eventSequence,
        event: { type: 'scheduledRunUpdated', run },
      });
    },
  );
  scheduler.start();

  const loadVisiblePluginCatalog = async (forceRefetch = false): Promise<PluginListResponse> => {
    const enabledNames = new Set(extensionPolicy.enabledMarketplaceNames());
    if (enabledNames.size === 0) {
      return { marketplaces: [], marketplaceLoadErrors: [], featuredPluginIds: [] };
    }
    const response = await appServer.request('plugin/list', {
      cwds: null,
      marketplaceKinds: ['local'],
      forceRefetch,
    }) as PluginListResponse;
    const marketplaces = response.marketplaces.filter((marketplace) =>
      enabledNames.has(normalizeExtensionName(marketplace.name))
    );
    const pluginIds = new Set(
      marketplaces.flatMap((marketplace) => marketplace.plugins.map((plugin) => plugin.id)),
    );
    return {
      ...response,
      marketplaces,
      featuredPluginIds: response.featuredPluginIds.filter((id) => pluginIds.has(id)),
    };
  };

  const readPluginDetail = async (input: PluginLocationInput): Promise<PluginReadResponse> => {
    assertSourceEnabled(extensionPolicy, input.marketplaceName);
    const response = await appServer.request(
      'plugin/read',
      pluginLocationParams(input),
    ) as PluginReadResponse;
    if (response.plugin.summary.id !== input.pluginId) {
      throw new Error('插件详情与请求不匹配');
    }
    return response;
  };

  const loadPluginDescriptors = async () => {
    const catalog = await loadVisiblePluginCatalog(false);
    const entries = [];
    const registeredToolNames = new Set<string>();
    for (const marketplace of catalog.marketplaces) {
      for (const summary of marketplace.plugins) {
        if (!summary.installed || !extensionPolicy.isPluginEnabled(summary.id)) continue;
        try {
          const response = await appServer.request('plugin/read', {
            marketplacePath: marketplace.path,
            remoteMarketplaceName: marketplace.path ? null : marketplace.name,
            pluginName: summary.name,
          }) as PluginReadResponse;
          if (response.plugin.summary.id !== summary.id) continue;
          const descriptor = readPluginDescriptor(response);
          const root = pluginRoot(response);
          if (descriptor && root) {
            const toolNames = descriptor.webMcp?.tools.map((tool) => tool.name) ?? [];
            if (toolNames.some((name) => registeredToolNames.has(name))) continue;
            for (const name of toolNames) registeredToolNames.add(name);
            descriptor.credentials = pluginCredentials.values(
              marketplace.name,
              readPluginCredentials(response),
            );
            entries.push({ descriptor, root });
          }
        } catch {
          // Invalid host declarations do not hide or disable the base plugin.
        }
      }
    }
    return replacePluginRegistry(entries);
  };

  const broadcastPluginsChanged = (clearPluginId?: string) => {
    eventSequence += 1;
    broadcast({
      kind: 'runtime', generation: eventGeneration, sequence: eventSequence,
      event: { type: 'pluginsChanged', ...(clearPluginId ? { clearPluginId } : {}) },
    });
  };

  handle(IPC.authStatus, null, () => auth.status());
  handle(IPC.authSettings, null, () => auth.settings());
  handle(IPC.authConfigure, authSettingsSchema, async (input) => {
    const previous = auth.settings().issuer;
    const result = await auth.configure(input);
    operations.record({
      identity: null,
      action: 'identity.configure',
      resource: { previousIssuer: previous, issuer: result.issuer },
      outcome: 'succeeded',
    });
    return result;
  });
  handle(IPC.authLogin, null, () => auth.login());
  handle(IPC.authLogout, null, () => auth.logout());
  handle(IPC.runtimeStatus, null, () => appServer.status());
  handle(IPC.runtimeRestart, null, async () => {
    await appServer.restart();
    return appServer.status();
  });
  handle(IPC.runtimeSettings, null, () => runtimeSettings.read());
  handle(IPC.runtimeRevealProviderApiKey, null, () =>
    runtimeSettings.revealProviderApiKey(),
  );
  handle(IPC.runtimeConfigure, runtimeConnectionInputSchema, async (input) => {
    const settings = runtimeSettings.configure(input);
    await appServer.restart();
    return settings;
  });
  handle(IPC.runtimeBranding, null, () => runtimeSettings.readBranding());
  handle(IPC.runtimePickBrandIcon, null, async () => {
    const result = await dialog.showOpenDialog(window, {
      title: '选择应用图标',
      buttonLabel: '使用此图标',
      properties: ['openFile'],
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
  handle(IPC.runtimeConfigureBranding, runtimeBrandingInputSchema, (input) => {
    const branding = runtimeSettings.configureBranding(input);
    options.updateBranding(branding);
    return branding;
  });
  handle(IPC.runtimeQuit, null, () => options.quit());

  handle(IPC.projectsList, null, () => projects.list());
  handle(IPC.projectsOpen, null, async () => {
    const result = await dialog.showOpenDialog(window, {
      title: '打开本地项目',
      buttonLabel: '打开项目',
      properties: ['openDirectory', 'createDirectory'],
    });
    const selected = result.filePaths[0];
    return result.canceled || !selected ? null : projects.add(selected);
  });
  handle(IPC.projectsRemove, projectRemoveSchema, ({ projectId }) => projects.remove(projectId));

  handle(IPC.threadsList, threadListSchema, (input) =>
    appServer.request('thread/list', {
      cursor: input.cursor ?? null,
      limit: 100,
      sortKey: 'updated_at',
      sortDirection: 'desc',
      // app-server defaults an omitted provider filter to the currently active
      // provider. Whale supports switching providers, so omitting this would
      // make older conversations appear to have been deleted after a switch.
      // An explicit empty list means "all providers".
      modelProviders: [],
      archived: input.archived ?? false,
      ...(input.cwd ? { cwd: input.cwd } : {}),
    }),
  );
  handle(IPC.threadsStart, threadStartSchema, async (input) => {
    await loadPluginDescriptors();
    return appServer.request('thread/start', {
      cwd: input.cwd,
      model: input.model ?? null,
      approvalPolicy: input.approvalPolicy ?? 'untrusted',
      sandbox: input.sandboxMode ?? 'workspace-write',
      ephemeral: false,
      dynamicTools: pluginDynamicTools(),
    });
  });
  handle(IPC.threadsResume, threadIdSchema, ({ threadId }) =>
    appServer.request('thread/resume', { threadId, excludeTurns: true }),
  );
  handle(IPC.threadsFork, threadIdSchema, ({ threadId }) =>
    appServer.request('thread/fork', { threadId, excludeTurns: true, ephemeral: false }),
  );
  handle(IPC.threadsRename, threadRenameSchema, ({ threadId, name }) =>
    appServer.request('thread/name/set', { threadId, name }),
  );
  handle(IPC.threadsArchive, threadIdSchema, ({ threadId }) =>
    appServer.request('thread/archive', { threadId }),
  );
  handle(IPC.threadsDelete, threadIdSchema, ({ threadId }) =>
    appServer.request('thread/delete', { threadId }),
  );
  handle(IPC.threadsReadHistory, historySchema, async (input) => {
    const [turnsResult, itemsResult] = await Promise.all([
      input.turnsCursor === null
        ? Promise.resolve({ data: [], nextCursor: null })
        : appServer.request('thread/turns/list', {
          threadId: input.threadId,
          cursor: input.turnsCursor ?? null,
          limit: input.turnsLimit,
          sortDirection: input.sortDirection,
          itemsView: 'summary',
          }),
      input.itemsCursor === null
        ? Promise.resolve({ data: [], nextCursor: null })
        : appServer.request('thread/items/list', {
          threadId: input.threadId,
          cursor: input.itemsCursor ?? null,
          limit: input.itemsLimit,
          sortDirection: input.sortDirection,
          }),
    ]);
    const turns = asRecord(turnsResult);
    const items = asRecord(itemsResult);
    const turnData = Array.isArray(turns?.data) ? turns.data : [];
    const itemData = Array.isArray(items?.data) ? items.data : [];
    const turnIds = [
      ...turnData.flatMap((entry) => {
        const turn = asRecord(entry);
        const turnId = stringValue(turn?.id);
        return turnId ? [turnId] : [];
      }),
      ...itemData.flatMap((entry) => {
        const item = asRecord(entry);
        const turnId = stringValue(item?.turnId);
        return turnId ? [turnId] : [];
      }),
    ];
    return {
      turns: turnData,
      items: itemData,
      plans: turnPlans.find(turnIds),
      changes: turnChanges.find(turnIds),
      operations: operations.find(turnIds),
      turnsNextCursor: stringValue(turns?.nextCursor),
      itemsNextCursor: stringValue(items?.nextCursor),
    };
  });
  handle(IPC.threadsCompact, threadIdSchema, ({ threadId }) =>
    appServer.request('thread/compact/start', { threadId }),
  );

  handle(IPC.turnsStart, startTurnSchema, async (input) => {
    await loadAndReconcileSkills(input.cwd ? { cwd: input.cwd } : {});
    const before = input.cwd ? await turnChanges.capture(input.cwd) : null;
    const operationId = operations.start({
      identity: await auth.identityContext(),
      action: 'turn.execute',
      resource: {
        source: 'composer',
        prompt: input.text,
        attachments: (input.attachments ?? []).map((attachment) => ({ name: attachment.name, path: attachment.path })),
        cwd: input.cwd ?? '',
        model: input.model ?? '',
        effort: input.effort ?? '',
        sandboxMode: input.sandboxMode ?? 'workspace-write',
        approvalPolicy: input.approvalPolicy ?? 'untrusted',
      },
      threadId: input.threadId,
    });
    operations.addDecisionByOperation(operationId, {
      source: 'execution-policy',
      action: 'turn.execute',
      effect: 'allow',
      reason: '执行预设已通过现有 IPC 和沙箱配置校验',
      requestId: null,
    });
    let response: unknown;
    try {
      response = await appServer.request('turn/start', buildTurnParams(input));
    } catch (error) {
      operations.fail(operationId, errorMessage(error));
      throw error;
    }
    const turn = asRecord(asRecord(response)?.turn);
    const turnId = stringValue(turn?.id);
    if (turnId) {
      operations.attachTurn(operationId, input.threadId, turnId);
      if (input.resumeOperationId) operations.resume(input.resumeOperationId, operationId);
      if (before && input.cwd) turnChanges.begin(turnId, input.cwd, before);
    } else {
      operations.fail(operationId, 'app-server 未返回回合 ID');
    }
    return response;
  });
  handle(IPC.turnsSteer, steerTurnSchema, async (input) => {
    await loadAndReconcileSkills(input.cwd ? { cwd: input.cwd } : {});
    const response = await appServer.request('turn/steer', {
      threadId: input.threadId,
      expectedTurnId: input.turnId,
      input: buildUserInput(input),
    });
    operations.addEventByTurn(input.turnId, 'operation.steered', 'started');
    return response;
  });
  handle(IPC.turnsInterrupt, interruptSchema, async ({ threadId, turnId }) => {
    const response = await appServer.request('turn/interrupt', { threadId, turnId });
    operations.addEventByTurn(turnId, 'operation.interrupt-requested', 'started');
    return response;
  });
  handle(IPC.turnsPause, interruptSchema, async ({ threadId, turnId }) => {
    const response = await appServer.request('turn/interrupt', { threadId, turnId });
    operations.pause(turnId);
    return response;
  });
  handle(IPC.turnsReview, threadIdSchema, async ({ threadId }) => {
    const response = await appServer.request('thread/read', {
      threadId,
      includeTurns: false,
    }) as { thread: { cwd?: string } };
    await loadAndReconcileSkills(response.thread.cwd ? { cwd: response.thread.cwd } : {});
    return appServer.request('review/start', {
      threadId,
      target: { type: 'uncommittedChanges' },
      delivery: 'inline',
    });
  });

  handle(IPC.approvalsRespond, approvalResponseSchema, (input) => {
    const key = requestKey(input.requestId);
    const request = outstanding.get(key);
    if (!request || request.method !== input.method) throw new Error('审批请求已过期或不匹配');
    outstanding.delete(key);
    if (
      request.turnId
      && input.method !== 'item/tool/requestUserInput'
      && input.method !== 'item/tool/call'
    ) {
      const effect = approvalEffect(input.response);
      operations.addDecisionByTurn(request.turnId, {
        source: 'user-approval',
        action: approvalAction(input.method),
        effect,
        reason: effect === 'allow' ? '用户已允许该操作' : '用户已拒绝该操作',
        requestId: key,
      });
    }
    appServer.respond(input.requestId, input.response);
  });

  handle(IPC.modelsList, null, () =>
    appServer.request('model/list', { limit: 100, includeHidden: false }),
  );
  handle(IPC.modelsCapabilities, null, () =>
    appServer.request('modelProvider/capabilities/read', {}),
  );
  handle(IPC.configRead, configReadSchema, ({ cwd }) =>
    appServer.request('config/read', { includeLayers: true, cwd: cwd ?? null }),
  );
  handle(IPC.configWrite, configWriteSchema, (input) =>
    appServer.request('config/value/write', {
      keyPath: input.keyPath,
      value: input.value,
      mergeStrategy: 'replace',
      expectedVersion: input.expectedVersion ?? null,
    }),
  );

  handle(IPC.pluginsList, pluginListSchema, (input) =>
    loadVisiblePluginCatalog(input.forceRefetch ?? false),
  );
  handle(IPC.pluginsRead, pluginLocationSchema, readPluginDetail);
  handle(IPC.pluginsContributions, pluginLocationSchema, async (input) => {
    const response = await readPluginDetail(input);
    return readPluginContributionDetails(response);
  });
  handle(IPC.pluginsCredentials, pluginLocationSchema, async (input) => {
    const response = await readPluginDetail(input);
    return {
      pluginId: input.pluginId,
      credentials: pluginCredentials.values(
        input.marketplaceName,
        readPluginCredentials(response),
      ),
    };
  });
  handle(IPC.pluginsConfigureCredential, pluginCredentialConfigureSchema, async (input) => {
    const plugin = extensionPolicy.snapshot().plugins.find(
      (entry) => entry.pluginId === input.pluginId,
    );
    if (!plugin) throw new Error('请先下载插件，再配置凭据');
    if (plugin.marketplaceName !== normalizeExtensionName(input.marketplaceName)) {
      throw new Error('插件与商城来源不匹配');
    }
    const response = await readPluginDetail(input);
    const credentials = readPluginCredentials(response);
    const credential = credentials.find((entry) => entry.id === input.credentialId);
    if (!credential) throw new Error('插件未声明此凭据');
    if (
      input.value === null
      && (
        extensionPolicy.isCredentialRequiredByEnabledPlugin(input.marketplaceName, credential.key)
        || (
          extensionPolicy.isPluginEnabled(input.pluginId)
          && credential.required
          && credential.mcpServers.some((server) => plugin.enabledMcpServers.includes(server))
        )
      )
    ) {
      throw new Error('该凭据正在被已启用插件使用，请先停用相关插件');
    }
    pluginCredentials.configure(input.marketplaceName, credential.key, input.value);
    extensionPolicy.updatePluginCredentials(input.pluginId, credentials);
    if (extensionPolicy.isCredentialActive(input.marketplaceName, credential.key)) {
      await appServer.restart();
    }
    replacePluginRegistry([]);
    broadcastPluginsChanged();
    return {
      pluginId: input.pluginId,
      credentials: pluginCredentials.values(input.marketplaceName, credentials),
    };
  });
  handle(IPC.pluginsDescriptors, null, loadPluginDescriptors);
  handle(IPC.pluginsCallMcp, pluginMcpCallSchema, async (input) => {
    assertPluginMcpPermission(
      input.pluginId,
      input.principal,
      input.server,
      input.tool,
    );
    if (!extensionPolicy.isPluginEnabled(input.pluginId)) {
      throw new Error('插件已停用');
    }
    if (!extensionPolicy.isMcpEnabled(input.pluginId, input.server)) {
      throw new Error(`MCP 服务 ${input.server} 尚未启用`);
    }
    return callPluginMcpTool(
      pluginMcpHttpConnection(
        input.pluginId,
        input.server,
        pluginCredentials.launchEnvironment(
          extensionPolicy.activeCredentialsForMcp(input.pluginId, input.server),
        ),
      ),
      input.tool,
      input.arguments ?? {},
    );
  });
  handle(IPC.pluginsInstall, pluginLocationSchema, async (input) => {
    assertSourceEnabled(extensionPolicy, input.marketplaceName);
    const detailResponse = await appServer.request(
      'plugin/read',
      pluginLocationParams(input),
    ) as PluginReadResponse;
    if (detailResponse.plugin.summary.id !== input.pluginId) {
      throw new Error('插件详情与安装请求不匹配');
    }
    const hookKeys = detailResponse.plugin.hooks.map((hook) => hook.key);
    // Download and activation are separate operations. Seed a disabled config
    // before installation so the upstream installer cannot start contributed
    // MCP servers as a side effect of merely downloading a plugin.
    await writeConfigValue(`${pluginConfigKey(input.pluginId)}.enabled`, false);
    for (const serverName of detailResponse.plugin.mcpServers) {
      await writeConfigValue(
        `${pluginMcpConfigKey(input.pluginId, serverName)}.enabled`,
        false,
      );
    }
    await writeHookStates(hookKeys.map((key) => ({ key, enabled: false })));
    const response = await appServer.request('plugin/install', pluginLocationParams(input));
    // Upstream install enables the plugin. Reassert Whale's download-only state
    // before the runtime is restarted or the extension is exposed to the UI.
    await writeConfigValue(`${pluginConfigKey(input.pluginId)}.enabled`, false);
    await writeHookStates(hookKeys.map((key) => ({ key, enabled: false })));
    extensionPolicy.registerPlugin(
      input.pluginId,
      input.marketplaceName,
      detailResponse.plugin.mcpServers,
      readPluginCredentials(detailResponse),
    );
    broadcastPluginsChanged();
    await appServer.restart();
    return response;
  });
  handle(IPC.pluginsUninstall, pluginUninstallSchema, async (input) => {
    const { pluginId } = input;
    const detailResponse = await readPluginDetail(input);
    await writeHookStates(detailResponse.plugin.hooks.map((hook) => ({
      key: hook.key,
      enabled: false,
    })));
    await appServer.request('plugin/uninstall', { pluginId });
    if (detailResponse.plugin.hooks.length > 0) {
      await appServer.request('config/batchWrite', {
        edits: detailResponse.plugin.hooks.map((hook) => ({
          keyPath: hookStateKeyPath(hook.key),
          value: null,
          mergeStrategy: 'replace',
        })),
        filePath: null,
        expectedVersion: null,
        reloadUserConfig: true,
      });
    }
    extensionPolicy.removePlugin(pluginId);
    pluginCredentials.prune(extensionPolicy.allCredentialReferences());
    replacePluginRegistry([]);
    broadcastPluginsChanged(pluginId);
    await appServer.restart();
  });
  handle(IPC.pluginsSetEnabled, pluginSetEnabledSchema, async (input) => {
    const { pluginId, enabled } = input;
    const plugin = extensionPolicy.snapshot().plugins.find((entry) => entry.pluginId === pluginId);
    if (!plugin) throw new Error(`未知插件：${pluginId}`);
    assertSourceEnabled(extensionPolicy, plugin.marketplaceName);
    if (plugin.marketplaceName !== input.marketplaceName) {
      throw new Error('插件与商城来源不匹配');
    }

    let declaredMcpServers = plugin.mcpServers;
    let credentials = plugin.credentials;
    let hookKeys: string[] = [];
    if (enabled) {
      const detailResponse = await appServer.request(
        'plugin/read',
        pluginLocationParams(input),
      ) as PluginReadResponse;
      if (detailResponse.plugin.summary.id !== pluginId) {
        throw new Error('插件详情与启用请求不匹配');
      }
      declaredMcpServers = detailResponse.plugin.mcpServers;
      hookKeys = detailResponse.plugin.hooks.map((hook) => hook.key);
      const preview = previewPluginHooks(detailResponse);
      if (!preview.supported) throw new Error(preview.errors.join('\n'));
      if (preview.hooks.length > 0 && input.approvedHookDigest !== preview.digest) {
        throw new Error('Hook 定义已变化，请重新检查命令并确认信任');
      }
      credentials = readPluginCredentials(detailResponse);
      const missingCredentials = pluginCredentials.missingRequired(
        input.marketplaceName,
        credentials,
      );
      if (missingCredentials.length > 0) {
        throw new Error(
          `请先配置插件凭据：${missingCredentials.map((credential) => credential.label).join('、')}`,
        );
      }
      for (const skill of detailResponse.plugin.skills) {
        if (!skill.path) continue;
        await appServer.request('skills/config/write', {
          path: skill.path,
          name: null,
          enabled: true,
        });
      }
      for (const serverName of declaredMcpServers) {
        await writeConfigValue(
          `${pluginMcpConfigKey(pluginId, serverName)}.enabled`,
          true,
        );
      }
      await writeHookStates(hookKeys.map((key) => ({ key, enabled: false })));
      try {
        await writeConfigValue(`${pluginConfigKey(pluginId)}.enabled`, true);
        await appServer.restart();
        if (hookKeys.length > 0) {
          const hookList = await listHooks(input.cwd);
          const liveHooks = hookList.data.flatMap((entry) => entry.hooks).filter((hook) =>
            hook.pluginId === pluginId
            && hook.source === 'plugin'
            && hook.eventName === 'stop'
            && hook.handlerType === 'command'
            && hookKeys.includes(hook.key));
          if (liveHooks.length !== hookKeys.length) {
            throw new Error('Hook 加载结果与插件声明不一致');
          }
          await writeHookStates(liveHooks.map((hook) => ({
            key: hook.key,
            enabled: true,
            trustedHash: hook.currentHash,
          })));
        }
      } catch (error) {
        await writeHookStates(hookKeys.map((key) => ({ key, enabled: false })));
        await writeConfigValue(`${pluginConfigKey(pluginId)}.enabled`, false);
        await appServer.restart();
        throw error;
      }
    } else {
      const detailResponse = await readPluginDetail(input);
      hookKeys = detailResponse.plugin.hooks.map((hook) => hook.key);
      await writeHookStates(hookKeys.map((key) => ({ key, enabled: false })));
      await writeConfigValue(`${pluginConfigKey(pluginId)}.enabled`, false);
      await appServer.restart();
    }
    const snapshot = extensionPolicy.setPluginEnabled(
      pluginId,
      enabled,
      declaredMcpServers,
      credentials,
    );
    replacePluginRegistry([]);
    broadcastPluginsChanged();
    return snapshot;
  });

  handle(IPC.hooksPreviewPlugin, pluginLocationSchema, async (input) =>
    previewPluginHooks(await readPluginDetail(input)),
  );
  handle(IPC.hooksList, hookListSchema, async ({ cwd }) => pluginHooksOnly(await listHooks(cwd)));
  handle(IPC.hooksSetEnabled, hookSetEnabledSchema, async (input) => {
    const response = await listHooks(input.cwd);
    const hook = response.data.flatMap((entry) => entry.hooks).find((entry) => entry.key === input.key);
    if (!hook) throw new Error('Hook 不存在或所属插件尚未启用');
    if (hook.source !== 'plugin' || hook.pluginId === null) throw new Error('这里只能管理插件 Hook');
    if (!extensionPolicy.isPluginEnabled(hook.pluginId)) throw new Error('Hook 所属插件尚未启用');
    if (hook.eventName !== 'stop' || hook.handlerType !== 'command') {
      throw new Error('当前仅支持 Stop command Hook');
    }
    if (hook.isManaged) throw new Error('此 Hook 由管理员策略管理，不能修改');
    if (input.enabled && hook.trustStatus !== 'trusted') {
      if (!input.trustCurrentDefinition || input.expectedCurrentHash !== hook.currentHash) {
        throw new Error('Hook 定义未受信任或已变化，请重新检查命令');
      }
    }
    await writeHookStates([{
      key: hook.key,
      enabled: input.enabled,
      ...(input.enabled && input.trustCurrentDefinition
        ? { trustedHash: hook.currentHash }
        : {}),
    }]);
    return pluginHooksOnly(await listHooks(input.cwd));
  });

  handle(IPC.marketplacesAdd, marketplaceAddSchema, async (input) => {
    const response = await appServer.request('marketplace/add', {
      source: input.source,
      refName: input.refName ?? null,
      sparsePaths: null,
    }) as { marketplaceName: string; installedRoot: string; alreadyAdded: boolean };
    if (isRetiredPresetSourceName(response.marketplaceName)) {
      await appServer.request('marketplace/remove', {
        marketplaceName: response.marketplaceName,
      });
      throw new Error('此应用不支持 Codex 预设扩展来源');
    }
    extensionPolicy.addMarketplace(
      response.marketplaceName,
      input.source,
      input.refName ?? null,
    );
    await appServer.restart();
    return response;
  });
  handle(IPC.marketplacesRemove, marketplaceNameSchema, async ({ marketplaceName }) => {
    const source = extensionPolicy.source(marketplaceName);
    if (!source || source.kind !== 'marketplace') throw new Error('只能移除用户添加的商城源');
    const response = source.enabled
      ? await appServer.request('marketplace/remove', { marketplaceName })
      : { marketplaceName, installedRoot: null };
    extensionPolicy.removeMarketplace(marketplaceName);
    await appServer.restart();
    return response;
  });
  handle(IPC.marketplacesUpgrade, marketplaceUpgradeSchema, async ({ marketplaceName }) => {
    const visibleGitMarketplaces = extensionPolicy.enabledGitMarketplaceNames();
    const selected = marketplaceName
      ? visibleGitMarketplaces.filter((name) => name === marketplaceName)
      : visibleGitMarketplaces;
    const combined: MarketplaceUpgradeResponse = {
      selectedMarketplaces: [],
      upgradedRoots: [],
      errors: [],
    };
    for (const name of selected) {
      const response = (await appServer.request('marketplace/upgrade', {
        marketplaceName: name,
      })) as MarketplaceUpgradeResponse;
      combined.selectedMarketplaces.push(...response.selectedMarketplaces);
      combined.upgradedRoots.push(...response.upgradedRoots);
      combined.errors.push(...response.errors);
    }
    return combined;
  });
  handle(IPC.marketplacesSources, null, () => extensionPolicy.snapshot());
  handle(
    IPC.marketplacesSetEnabled,
    marketplaceSourceEnabledSchema,
    async ({ marketplaceName, enabled }) => {
      const source = extensionPolicy.source(marketplaceName);
      if (!source) throw new Error(`未知扩展源：${marketplaceName}`);
      if (source.kind === 'marketplace') {
        if (enabled && !source.enabled) {
          await appServer.request('marketplace/add', {
            source: source.source,
            refName: source.refName,
            sparsePaths: null,
          });
        } else if (!enabled && source.enabled) {
          await appServer.request('marketplace/remove', { marketplaceName: source.name });
        }
      }
      const snapshot = extensionPolicy.setSourceEnabled(marketplaceName, enabled);
      await appServer.restart();
      return snapshot;
    },
  );

  handle(IPC.skillsList, skillsListSchema, loadAndReconcileSkills);
  handle(IPC.skillsSetEnabled, skillSetEnabledSchema, async (input) => {
    if (!input.pluginId) {
      throw new Error('此应用只允许通过插件启用 Skill');
    }
    if (input.scope === 'system') {
      throw new Error('此应用不加载 Codex 内置 Skills');
    }
    if (input.pluginId && !extensionPolicy.isPluginEnabled(input.pluginId)) {
      throw new Error('请先启用提供此 Skill 的插件');
    }
    const response = await appServer.request('skills/config/write', {
      path: input.path,
      name: null,
      enabled: input.enabled,
    });
    await appServer.restart();
    return response;
  });

  handle(IPC.mcpList, mcpListSchema, async () => {
    const response = await appServer.request('mcpServerStatus/list', {
      cursor: null,
      limit: 100,
      detail: 'full',
      threadId: null,
    }) as ListMcpServerStatusResponse;
    return {
      ...response,
      data: response.data.filter((server) =>
        server.pluginId ? extensionPolicy.isPluginEnabled(server.pluginId) : false,
      ),
    };
  });
  handle(IPC.mcpLogin, mcpLoginSchema, async ({ name }) => {
    const responseStatus = await appServer.request('mcpServerStatus/list', {
      cursor: null,
      limit: 100,
      detail: 'summary',
      threadId: null,
    }) as ListMcpServerStatusResponse;
    const server = responseStatus.data.find((entry) => entry.name === name);
    const enabled = server?.pluginId
      ? extensionPolicy.isMcpEnabled(server.pluginId, name)
      : false;
    if (!enabled) throw new Error(`MCP 服务 ${name} 尚未启用`);
    const response = await appServer.request('mcpServer/oauth/login', {
      name,
      threadId: null,
      clientRegistration: null,
      scopes: null,
      timeoutSecs: null,
    });
    const authorizationUrl = stringValue(asRecord(response)?.authorizationUrl);
    if (!authorizationUrl || !isHttpUrl(authorizationUrl)) {
      throw new Error('app-server 返回了无效的 MCP 登录地址');
    }
    await shell.openExternal(authorizationUrl);
    return { started: true as const };
  });
  handle(IPC.mcpSetEnabled, mcpSetEnabledSchema, async ({ name, pluginId, enabled }) => {
    if (!extensionPolicy.isPluginEnabled(pluginId)) throw new Error('请先启用提供此 MCP 的插件');
    await writeConfigValue(`${pluginMcpConfigKey(pluginId, name)}.enabled`, enabled);
    const snapshot = extensionPolicy.setMcpEnabled(pluginId, name, enabled);
    await appServer.restart();
    return snapshot;
  });
  handle(IPC.mcpReload, null, async () => {
    await appServer.request('config/mcpServer/reload');
  });

  handle(IPC.filesPickAttachments, null, async () => {
    const result = await dialog.showOpenDialog(window, {
      title: '添加文件',
      buttonLabel: '添加',
      properties: ['openFile', 'multiSelections'],
    });
    const attachments = result.canceled
      ? []
      : Promise.all(result.filePaths.map((filePath) => importAttachmentFromPath(attachmentsRoot, filePath)));
    const resolved = await attachments;
    const identity = await auth.identityContext();
    for (const attachment of resolved) operations.record({
      identity, action: 'file.import',
      resource: { attachmentId: attachment.id, name: attachment.name, sha256: attachment.sha256 },
      outcome: 'succeeded',
    });
    return resolved;
  });
  handle(IPC.filesSaveClipboardAttachment, clipboardAttachmentSchema, async (input) => {
    const attachment = await saveClipboardAttachment(attachmentsRoot, input);
    operations.record({
      identity: await auth.identityContext(), action: 'file.import',
      resource: { attachmentId: attachment.id, name: attachment.name, sha256: attachment.sha256, source: 'clipboard' },
      outcome: 'succeeded',
    });
    return attachment;
  });
  handle(IPC.filesSearch, fileSearchSchema, ({ projectPath, query }) =>
    searchProjectFiles(projectPath, query),
  );
  handle(IPC.filesReadAttachment, attachmentReadSchema, async ({ path: attachmentPath }) => {
    const [root, candidate] = await Promise.all([realpath(attachmentsRoot), realpath(attachmentPath)]);
    const relative = path.relative(root, candidate);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('附件不属于 Whale 附件库');
    const contents = await readFile(candidate);
    operations.record({
      identity: await auth.identityContext(), action: 'file.read',
      resource: { path: candidate, size: contents.length }, outcome: 'succeeded',
    });
    return { dataBase64: contents.toString('base64') };
  });
  handle(IPC.auditList, null, () => operations.list());
  handle(IPC.auditClear, null, () => operations.clear());
  handle(IPC.artifactsCreate, artifactCreateSchema, async (input) => {
    const artifact = artifacts.create(input);
    operations.record({
      identity: await auth.identityContext(), action: 'artifact.generate',
      resource: {
        artifactId: artifact.id, name: artifact.name, format: artifact.format, sha256: artifact.sha256,
        pluginId: artifact.pluginId, turnId: artifact.turnId,
      },
      threadId: artifact.threadId, turnId: artifact.turnId, outcome: 'succeeded',
    });
    return artifact;
  });
  handle(IPC.artifactsList, artifactListSchema, ({ threadId }) => artifacts.list(threadId));
  handle(IPC.artifactsOpen, artifactIdSchema, async ({ id }) => {
    const artifact = artifacts.require(id);
    const error = await shell.openPath(artifact.path);
    operations.record({
      identity: await auth.identityContext(), action: 'artifact.open',
      resource: { artifactId: artifact.id, name: artifact.name }, threadId: artifact.threadId,
      outcome: error ? 'failed' : 'succeeded', reason: error || null,
    });
    if (error) throw new Error(error);
  });
  handle(IPC.artifactsSaveAs, artifactIdSchema, async ({ id }) => {
    const artifact = artifacts.require(id);
    const result = await dialog.showSaveDialog(window, { defaultPath: artifact.name });
    if (result.canceled || !result.filePath) return null;
    await copyFile(artifact.path, result.filePath);
    operations.record({
      identity: await auth.identityContext(), action: 'artifact.export',
      resource: { artifactId: artifact.id, name: artifact.name, destination: result.filePath },
      threadId: artifact.threadId, outcome: 'succeeded',
    });
    return result.filePath;
  });
  handle(IPC.schedulesList, null, () => scheduler?.list() ?? []);
  handle(IPC.schedulesCreate, scheduledTaskCreateSchema, (input) => {
    if (!projects.list().some((project) => project.id === input.projectId && project.path === input.cwd)) {
      throw new Error('定时任务项目不存在或路径已变化');
    }
    return scheduler?.create(input);
  });
  handle(IPC.schedulesUpdate, scheduledTaskUpdateSchema, (input) => {
    if (!projects.list().some((project) => project.id === input.projectId && project.path === input.cwd)) {
      throw new Error('定时任务项目不存在或路径已变化');
    }
    return scheduler?.update(input);
  });
  handle(IPC.schedulesRemove, scheduledTaskIdSchema, ({ taskId }) => scheduler?.remove(taskId));
  handle(IPC.schedulesRunNow, scheduledTaskIdSchema, ({ taskId }) => scheduler?.runNow(taskId));
  handle(IPC.schedulesHistory, scheduledTaskIdSchema, ({ taskId }) => scheduler?.history(taskId) ?? []);
  return () => {
    unsubscribeAuth();
    scheduler?.stop();
    scheduler = null;
    for (const channel of channels) ipcMain.removeHandler(channel);
    appServer.off('wire', onWire);
    appServer.off('status', onStatus);
    appServer.off('diagnostic', onDiagnostic);
  };
}

function buildUserInput(input: StartTurnInput): unknown[] {
  const result: unknown[] = [];
  const fileAttachments = (input.attachments ?? []).filter((attachment) => attachment.kind === 'file');
  const attachmentContext = fileAttachments.length > 0
    ? `\n<whale_file_attachments>\n${fileAttachments.map((attachment) => JSON.stringify({
      name: attachment.name,
      path: attachment.path,
    })).join('\n')}\n</whale_file_attachments>`
    : '';
  const toolContext = (input.explicitTools?.length ?? 0) > 0
    ? `\n<whale_explicit_tools>\n用户已明确指定本轮使用以下 MCP 工具。必须优先调用这些精确工具完成请求；不要用 MCP Resource 列表判断工具是否存在，也不要静默替换成其他工具。若工具不可用，请直接说明。\n${input.explicitTools?.map((tool) => JSON.stringify(tool)).join('\n')}\n</whale_explicit_tools>`
    : '';
  const dynamicToolContext = (input.explicitDynamicTools?.length ?? 0) > 0
    ? `\n<whale_explicit_dynamic_tools>\n用户已明确指定本轮使用以下插件动作（Codex dynamic tools）。必须优先调用这些精确工具完成请求，不要静默替换成其他工具。若工具不可用，请直接说明。\n${input.explicitDynamicTools?.map((tool) => JSON.stringify(tool)).join('\n')}\n</whale_explicit_dynamic_tools>`
    : '';
  const pluginContext = (input.pluginContexts?.length ?? 0) > 0
    ? `\n<whale_plugin_context>\n以下 JSON 是用户通过已启用插件 UI 选择的本轮上下文。toolHints 表示该上下文适用的插件工具；请求与此上下文相关时应使用对应工具，并遵守 value 中的范围选择。toolHints 只是插件路由提示，不代表用户通过 $ 显式调用，也不是工具结果。\n${input.pluginContexts?.map((entry) => JSON.stringify(entry)).join('\n')}\n</whale_plugin_context>`
    : '';
  const text = `${input.text}${attachmentContext}${toolContext}${dynamicToolContext}${pluginContext}`;
  if (text.trim()) result.push({ type: 'text', text, text_elements: [] });
  for (const attachment of input.attachments ?? []) {
    if (attachment.kind === 'image') result.push({ type: 'localImage', path: attachment.path });
    else result.push({ type: 'mention', name: attachment.name, path: attachment.path });
  }
  for (const mention of input.mentions ?? []) {
    result.push({ type: 'mention', name: mention.name, path: mention.path });
  }
  for (const skill of input.explicitSkills ?? []) {
    result.push({ type: 'skill', name: skill.name, path: skill.path });
  }
  for (const tool of input.explicitTools ?? []) {
    result.push({
      type: 'mention',
      name: `${tool.server}.${tool.name}`,
      path: `mcp://${tool.server}`,
    });
  }
  return result;
}

function buildTurnParams(input: StartTurnInput): Record<string, unknown> {
  return {
    threadId: input.threadId,
    input: buildUserInput(input),
    ...(input.model ? { model: input.model } : {}),
    ...(input.effort ? { effort: input.effort } : {}),
    ...(input.cwd ? { cwd: input.cwd } : {}),
    ...(input.approvalPolicy ? { approvalPolicy: input.approvalPolicy } : {}),
    ...(input.sandboxMode
      ? { sandboxPolicy: sandboxPolicy(input.sandboxMode, input.cwd) }
      : {}),
  };
}

function sandboxPolicy(mode: StartTurnInput['sandboxMode'], cwd?: string): unknown {
  if (mode === 'danger-full-access') return { type: 'dangerFullAccess' };
  if (mode === 'read-only') return { type: 'readOnly', networkAccess: false };
  return {
    type: 'workspaceWrite',
    writableRoots: cwd ? [cwd] : [],
    networkAccess: true,
    excludeTmpdirEnvVar: false,
    excludeSlashTmp: false,
  };
}

function assertTrustedSender(event: IpcMainInvokeEvent, window: BrowserWindow): void {
  if (event.sender !== window.webContents) throw new Error('拒绝来自未知 renderer 的 IPC 请求');
  const url = event.senderFrame?.url ?? '';
  if (!url.startsWith('file://') && !url.startsWith('http://localhost:') && !url.startsWith('http://127.0.0.1:')) {
    throw new Error('拒绝来自非应用页面的 IPC 请求');
  }
}

function isHttpUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function isThreadMissingError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /thread (?:not found|does not exist)|unknown thread/i.test(message);
}

function requestKey(value: string | number): string {
  return `${typeof value}:${String(value)}`;
}

function approvalAction(method: string): string {
  if (method.includes('command') || method === 'execCommandApproval') return 'command.execute';
  if (method.includes('fileChange') || method === 'applyPatchApproval') return 'file.write';
  if (method.includes('permissions')) return 'permission.grant';
  if (method.includes('elicitation')) return 'mcp.elicit';
  if (method === 'item/tool/call') return 'tool.execute';
  return method;
}

function auditError(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Error) return value.message;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function auditItemAction(type: string | null): string | null {
  if (!type) return null;
  if (type === 'commandExecution') return 'command.execute';
  if (type === 'fileChange') return 'file.write';
  if (type === 'webSearch') return 'network.web-search';
  if (type === 'mcpToolCall') return 'network.mcp-tool';
  return null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function pluginHooksOnly(response: HooksListResponse): HooksListResponse {
  return {
    data: response.data.map((entry) => ({
      ...entry,
      hooks: entry.hooks.filter((hook) =>
        hook.source === 'plugin'
        && hook.eventName === 'stop'
        && hook.handlerType === 'command'),
      warnings: [],
      errors: [],
    })),
  };
}

function pluginLocationParams(input: {
  pluginId: string;
  marketplaceName: string;
  marketplacePath: string | null;
  pluginName: string;
}): Record<string, unknown> {
  return {
    marketplacePath: input.marketplacePath,
    remoteMarketplaceName: input.marketplacePath ? null : input.marketplaceName,
    pluginName: input.pluginName,
  };
}

function assertSourceEnabled(policy: ExtensionPolicyStore, marketplaceName: string): void {
  const enabled = policy.isSourceEnabled(marketplaceName);
  if (!enabled) throw new Error(`扩展源 ${marketplaceName} 尚未启用`);
}

function readPluginContributionDetails(
  response: PluginReadResponse,
): PluginContributionDetails {
  const { plugin } = response;
  const root = resolvePluginRoot(plugin);
  const skills = root
    ? plugin.skills.flatMap((skill) => {
      if (!skill.path) return [];
      const contents = readTextInside(root, skill.path);
      return contents === null ? [] : [{ name: skill.name, path: skill.path, contents }];
    })
    : [];
  const descriptor = readPluginDescriptor(response);
  return {
    skills,
    mcp: root ? readPluginMcpConfig(root) : null,
    uiContributions: descriptor?.uiContributions ?? [],
    webMcp: descriptor?.webMcp ? { tools: descriptor.webMcp.tools } : null,
  };
}

function readPluginMcpConfig(root: string): PluginContributionDetails['mcp'] {
  const manifestPath = path.join(root, '.codex-plugin', 'plugin.json');
  const manifestContents = readTextInside(root, manifestPath);
  if (manifestContents === null) return null;
  const manifest = parseJsonRecord(manifestContents);
  const declaration = manifest?.mcpServers;
  if (typeof declaration === 'string') {
    const configPath = path.resolve(root, declaration);
    const contents = readTextInside(root, configPath);
    if (contents === null) return null;
    const config = parseJsonRecord(contents);
    return {
      path: configPath,
      contents,
      servers: recordEntries(asRecord(config?.mcpServers)),
    };
  }
  const inline = asRecord(declaration);
  if (!inline) return null;
  return {
    path: manifestPath,
    contents: JSON.stringify(inline, null, 2),
    servers: recordEntries(inline),
  };
}

function parseJsonRecord(contents: string): Record<string, unknown> | null {
  try {
    return asRecord(JSON.parse(contents));
  } catch {
    return null;
  }
}

function recordEntries(
  record: Record<string, unknown> | null,
): Array<{ name: string; config: Record<string, unknown> }> {
  if (!record) return [];
  return Object.entries(record).flatMap(([name, value]) => {
    const config = asRecord(value);
    return config ? [{ name, config }] : [];
  });
}
