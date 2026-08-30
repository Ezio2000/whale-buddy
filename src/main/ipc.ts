import { BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron';
import path from 'node:path';
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
  clipboardAttachmentSchema,
  configReadSchema,
  configWriteSchema,
  fileSearchSchema,
  historySchema,
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
  pluginUiCallToolSchema,
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
import { attachmentFromPath, saveClipboardAttachment } from './clipboard-attachments';
import type { ExtensionPolicyStore } from './extension-policy';
import type { ProjectStore } from './projects';
import type { RuntimeSettingsStore } from './runtime-settings';
import type { PluginCredentialStore } from './plugin-credential-store';
import type { TurnPlanStore } from './turn-plans';
import type { TurnChangesStore } from './turn-changes';
import {
  ScheduledTaskScheduler,
  type ScheduledTaskStore,
} from './scheduled-tasks';
import type { MarketplaceUpgradeResponse } from '../generated/protocol/typescript/v2/MarketplaceUpgradeResponse';
import type { PluginListResponse } from '../generated/protocol/typescript/v2/PluginListResponse';
import type { PluginReadResponse } from '../generated/protocol/typescript/v2/PluginReadResponse';
import type { SkillsListResponse } from '../generated/protocol/typescript/v2/SkillsListResponse';
import type { ListMcpServerStatusResponse } from '../generated/protocol/typescript/v2/ListMcpServerStatusResponse';
import {
  isRetiredPresetSourceName,
  normalizeExtensionName,
  pluginConfigKey,
  pluginMcpConfigKey,
} from '../shared/extension-policy';
import {
  assertPluginUiToolPermission,
  pluginMcpHttpConnection,
  pluginUiRoot,
  readPluginUiDescriptor,
  replacePluginUiRegistry,
} from './plugin-ui';
import { callPluginMcpTool } from './plugin-mcp-client';
import { readPluginCredentialContributions } from './plugin-credential-manifest';
import { readTextInside, resolvePluginRoot } from './plugin-manifest';

interface RegisterIpcOptions {
  appServer: AppServerClient;
  extensionPolicy: ExtensionPolicyStore;
  projects: ProjectStore;
  runtimeSettings: RuntimeSettingsStore;
  pluginCredentials: PluginCredentialStore;
  turnPlans: TurnPlanStore;
  turnChanges: TurnChangesStore;
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
  'mcpServer/elicitation/request',
  'applyPatchApproval',
  'execCommandApproval',
]);

export function registerIpc(options: RegisterIpcOptions): () => void {
  const {
    appServer,
    extensionPolicy,
    projects,
    runtimeSettings,
    pluginCredentials,
    turnPlans,
    turnChanges,
    scheduledTasks,
    attachmentsRoot,
    window,
  } = options;
  const channels: string[] = [];
  const outstanding = new Map<string, OutstandingRequest>();
  let eventSequence = 0;
  let eventGeneration = appServer.status().generation;
  let scheduler: ScheduledTaskScheduler | null = null;

  const broadcast = (event: unknown) => {
    if (!window.isDestroyed()) window.webContents.send(IPC.event, event);
  };

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
      const scheduledTurnId = stringValue(params?.turnId);
      if (scheduledTurnId) scheduler?.handleApprovalStarted(scheduledTurnId);
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
    if (method === 'serverRequest/resolved') {
      const requestId = params?.requestId;
      if (typeof requestId === 'string' || typeof requestId === 'number') {
        const request = outstanding.get(requestKey(requestId));
        if (request?.turnId) scheduler?.handleApprovalResolved(request.turnId);
        outstanding.delete(requestKey(requestId));
      }
    }
    if (method === 'turn/completed') {
      const turn = asRecord(params?.turn);
      const turnId = stringValue(turn?.id) ?? stringValue(params?.turnId);
      const threadId = stringValue(params?.threadId);
      if (turnId) {
        scheduler?.handleTurnCompleted(
          turnId,
          stringValue(turn?.status) ?? 'completed',
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
      const response = asRecord(await appServer.request('thread/start', {
        cwd: task.cwd,
        model: task.model ?? null,
        approvalPolicy: task.approvalPolicy,
        sandbox: task.sandboxMode,
        ephemeral: false,
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
    const response = asRecord(await appServer.request('turn/start', buildTurnParams(input)));
    const turnId = stringValue(asRecord(response?.turn)?.id);
    if (!turnId) throw new Error('启动定时任务回合失败');
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
  handle(IPC.threadsStart, threadStartSchema, (input) =>
    appServer.request('thread/start', {
      cwd: input.cwd,
      model: input.model ?? null,
      approvalPolicy: input.approvalPolicy ?? 'untrusted',
      sandbox: input.sandboxMode ?? 'workspace-write',
      ephemeral: false,
    }),
  );
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
    const response = await appServer.request('turn/start', buildTurnParams(input));
    const turn = asRecord(asRecord(response)?.turn);
    const turnId = stringValue(turn?.id);
    if (before && input.cwd && turnId) turnChanges.begin(turnId, input.cwd, before);
    return response;
  });
  handle(IPC.turnsSteer, steerTurnSchema, async (input) => {
    await loadAndReconcileSkills(input.cwd ? { cwd: input.cwd } : {});
    return appServer.request('turn/steer', {
      threadId: input.threadId,
      expectedTurnId: input.turnId,
      input: buildUserInput(input),
    });
  });
  handle(IPC.turnsInterrupt, interruptSchema, ({ threadId, turnId }) =>
    appServer.request('turn/interrupt', { threadId, turnId }),
  );
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
        readPluginCredentialContributions(response),
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
    const credentials = readPluginCredentialContributions(response);
    const credential = credentials.find((entry) => entry.id === input.credentialId);
    if (!credential) throw new Error('插件未声明此凭据贡献点');
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
    return {
      pluginId: input.pluginId,
      credentials: pluginCredentials.values(input.marketplaceName, credentials),
    };
  });
  handle(IPC.pluginsUiList, null, async () => {
    const catalog = await loadVisiblePluginCatalog(false);
    const entries: Array<{
      descriptor: NonNullable<ReturnType<typeof readPluginUiDescriptor>>;
      root: string;
    }> = [];
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
          const descriptor = readPluginUiDescriptor(response);
          const root = pluginUiRoot(response);
          if (descriptor && root) {
            descriptor.credentials = pluginCredentials.values(
              marketplace.name,
              readPluginCredentialContributions(response),
            );
            entries.push({ descriptor, root });
          }
        } catch {
          // An invalid UI contribution must not hide or disable the base plugin.
        }
      }
    }
    return replacePluginUiRegistry(entries);
  });
  handle(IPC.pluginsUiCallTool, pluginUiCallToolSchema, async (input) => {
    assertPluginUiToolPermission(
      input.pluginId,
      input.contributionId,
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
    const response = await appServer.request('plugin/install', pluginLocationParams(input));
    extensionPolicy.registerPlugin(
      input.pluginId,
      input.marketplaceName,
      detailResponse.plugin.mcpServers,
      readPluginCredentialContributions(detailResponse),
    );
    await appServer.restart();
    return response;
  });
  handle(IPC.pluginsUninstall, pluginUninstallSchema, async ({ pluginId }) => {
    await appServer.request('plugin/uninstall', { pluginId });
    extensionPolicy.removePlugin(pluginId);
    pluginCredentials.prune(extensionPolicy.allCredentialReferences());
    replacePluginUiRegistry([]);
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
    if (enabled) {
      const detailResponse = await appServer.request(
        'plugin/read',
        pluginLocationParams(input),
      ) as PluginReadResponse;
      if (detailResponse.plugin.summary.id !== pluginId) {
        throw new Error('插件详情与启用请求不匹配');
      }
      declaredMcpServers = detailResponse.plugin.mcpServers;
      credentials = readPluginCredentialContributions(detailResponse);
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
    }
    await writeConfigValue(`${pluginConfigKey(pluginId)}.enabled`, enabled);
    const snapshot = extensionPolicy.setPluginEnabled(
      pluginId,
      enabled,
      declaredMcpServers,
      credentials,
    );
    replacePluginUiRegistry([]);
    await appServer.restart();
    return snapshot;
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
    return result.canceled ? [] : result.filePaths.map(attachmentFromPath);
  });
  handle(IPC.filesSaveClipboardAttachment, clipboardAttachmentSchema, (input) =>
    saveClipboardAttachment(attachmentsRoot, input),
  );
  handle(IPC.filesSearch, fileSearchSchema, ({ projectPath, query }) =>
    searchProjectFiles(projectPath, query),
  );
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
  const pluginContext = (input.pluginContexts?.length ?? 0) > 0
    ? `\n<whale_plugin_context>\n以下 JSON 是用户通过已启用插件 UI 选择的本轮上下文。toolHints 表示该上下文适用的插件工具；请求与此上下文相关时应使用对应工具，并遵守 value 中的范围选择。toolHints 只是插件路由提示，不代表用户通过 $ 显式调用，也不是工具结果。\n${input.pluginContexts?.map((entry) => JSON.stringify(entry)).join('\n')}\n</whale_plugin_context>`
    : '';
  const text = `${input.text}${attachmentContext}${toolContext}${pluginContext}`;
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
  return {
    skills,
    mcp: root ? readPluginMcpConfig(root) : null,
    ui: readPluginUiDescriptor(response)?.contributions ?? [],
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
