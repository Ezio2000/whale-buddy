import { contextBridge, ipcRenderer } from 'electron';
import { currentSandboxPlatformStrategy } from '../platform/sandbox';
import { IPC } from '../shared/ipc';
import type { WhaleApi, WhaleEvent } from '../shared/types';
import {
  approvalResponseSchema,
  attachmentReadSchema,
  artifactCreateSchema,
  artifactIdSchema,
  artifactListSchema,
  authSettingsSchema,
  configReadSchema,
  configWriteSchema,
  clipboardAttachmentSchema,
  fileSearchSchema,
  historySchema,
  hookListSchema,
  hookSetEnabledSchema,
  idSchema,
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
  whaleEventSchema,
} from '../shared/validation';

const invoke = <T>(channel: string, payload?: unknown): Promise<T> =>
  ipcRenderer.invoke(channel, payload) as Promise<T>;

const api: WhaleApi = {
  auth: {
    status: () => invoke(IPC.authStatus),
    settings: () => invoke(IPC.authSettings),
    configure: (input) => invoke(IPC.authConfigure, authSettingsSchema.parse(input)),
    login: () => invoke(IPC.authLogin),
    logout: () => invoke(IPC.authLogout),
  },
  runtime: {
    windowCapabilities: {
      rendererDragRegions: currentSandboxPlatformStrategy().rendererDragRegions,
    },
    status: () => invoke(IPC.runtimeStatus),
    restart: () => invoke(IPC.runtimeRestart),
    settings: () => invoke(IPC.runtimeSettings),
    revealProviderApiKey: () => invoke(IPC.runtimeRevealProviderApiKey),
    configure: (input) =>
      invoke(IPC.runtimeConfigure, runtimeConnectionInputSchema.parse(input)),
    branding: () => invoke(IPC.runtimeBranding),
    pickBrandIcon: () => invoke(IPC.runtimePickBrandIcon),
    configureBranding: (input) =>
      invoke(IPC.runtimeConfigureBranding, runtimeBrandingInputSchema.parse(input)),
    quit: () => invoke(IPC.runtimeQuit),
  },
  projects: {
    list: () => invoke(IPC.projectsList),
    open: () => invoke(IPC.projectsOpen),
    remove: (projectId) =>
      invoke(IPC.projectsRemove, projectRemoveSchema.parse({ projectId })),
  },
  threads: {
    list: (input = {}) => invoke(IPC.threadsList, threadListSchema.parse(input)),
    start: (input) => invoke(IPC.threadsStart, threadStartSchema.parse(input)),
    resume: (threadId) => invoke(IPC.threadsResume, threadIdSchema.parse({ threadId })),
    fork: (threadId) => invoke(IPC.threadsFork, threadIdSchema.parse({ threadId })),
    rename: (threadId, name) =>
      invoke(IPC.threadsRename, threadRenameSchema.parse({ threadId, name })),
    archive: (threadId) => invoke(IPC.threadsArchive, threadIdSchema.parse({ threadId })),
    delete: (threadId) => invoke(IPC.threadsDelete, threadIdSchema.parse({ threadId })),
    readHistory: (input) => invoke(IPC.threadsReadHistory, historySchema.parse(input)),
    compact: (threadId) => invoke(IPC.threadsCompact, threadIdSchema.parse({ threadId })),
  },
  turns: {
    start: (input) => invoke(IPC.turnsStart, startTurnSchema.parse(input)),
    steer: (input) => invoke(IPC.turnsSteer, steerTurnSchema.parse(input)),
    interrupt: (threadId, turnId) =>
      invoke(IPC.turnsInterrupt, interruptSchema.parse({ threadId, turnId })),
    pause: (threadId, turnId) =>
      invoke(IPC.turnsPause, interruptSchema.parse({ threadId, turnId })),
    review: (threadId) => invoke(IPC.turnsReview, threadIdSchema.parse({ threadId })),
  },
  approvals: {
    respond: (input) => invoke(IPC.approvalsRespond, approvalResponseSchema.parse(input)),
  },
  models: {
    list: () => invoke(IPC.modelsList),
    capabilities: () => invoke(IPC.modelsCapabilities),
  },
  config: {
    read: (cwd) => invoke(IPC.configRead, configReadSchema.parse({ cwd })),
    write: (input) => invoke(IPC.configWrite, configWriteSchema.parse(input)),
  },
  plugins: {
    list: (input = {}) => invoke(IPC.pluginsList, pluginListSchema.parse(input)),
    read: (input) => invoke(IPC.pluginsRead, pluginLocationSchema.parse(input)),
    contributions: (input) =>
      invoke(IPC.pluginsContributions, pluginLocationSchema.parse(input)),
    credentials: (input) =>
      invoke(IPC.pluginsCredentials, pluginLocationSchema.parse(input)),
    configureCredential: (input) =>
      invoke(IPC.pluginsConfigureCredential, pluginCredentialConfigureSchema.parse(input)),
    install: (input) => invoke(IPC.pluginsInstall, pluginLocationSchema.parse(input)),
    uninstall: (input) =>
      invoke(IPC.pluginsUninstall, pluginUninstallSchema.parse(input)),
    setEnabled: (input) =>
      invoke(IPC.pluginsSetEnabled, pluginSetEnabledSchema.parse(input)),
    descriptors: () => invoke(IPC.pluginsDescriptors),
    callMcp: (input) =>
      invoke(IPC.pluginsCallMcp, pluginMcpCallSchema.parse(input)),
  },
  hooks: {
    previewPlugin: (input) =>
      invoke(IPC.hooksPreviewPlugin, pluginLocationSchema.parse(input)),
    list: (input = {}) => invoke(IPC.hooksList, hookListSchema.parse(input)),
    setEnabled: (input) =>
      invoke(IPC.hooksSetEnabled, hookSetEnabledSchema.parse(input)),
  },
  marketplaces: {
    add: (input) => invoke(IPC.marketplacesAdd, marketplaceAddSchema.parse(input)),
    remove: (marketplaceName) =>
      invoke(IPC.marketplacesRemove, marketplaceNameSchema.parse({ marketplaceName })),
    upgrade: (marketplaceName) =>
      invoke(IPC.marketplacesUpgrade, marketplaceUpgradeSchema.parse({ marketplaceName })),
    sources: () => invoke(IPC.marketplacesSources),
    setEnabled: (marketplaceName, enabled) =>
      invoke(
        IPC.marketplacesSetEnabled,
        marketplaceSourceEnabledSchema.parse({ marketplaceName, enabled }),
      ),
  },
  skills: {
    list: (input = {}) => invoke(IPC.skillsList, skillsListSchema.parse(input)),
    setEnabled: (input) =>
      invoke(IPC.skillsSetEnabled, skillSetEnabledSchema.parse(input)),
  },
  mcp: {
    list: (input = {}) => invoke(IPC.mcpList, mcpListSchema.parse(input)),
    login: (input) => invoke(IPC.mcpLogin, mcpLoginSchema.parse(input)),
    setEnabled: (input) => invoke(IPC.mcpSetEnabled, mcpSetEnabledSchema.parse(input)),
    reload: () => invoke(IPC.mcpReload),
  },
  files: {
    pickAttachments: () => invoke(IPC.filesPickAttachments),
    saveClipboardAttachment: (input) =>
      invoke(IPC.filesSaveClipboardAttachment, clipboardAttachmentSchema.parse(input)),
    search: (projectPath, query) =>
      invoke(IPC.filesSearch, fileSearchSchema.parse({ projectPath, query })),
    readAttachment: (path) => invoke(IPC.filesReadAttachment, attachmentReadSchema.parse({ path })),
  },
  audit: {
    list: () => invoke(IPC.auditList),
    clear: () => invoke(IPC.auditClear),
  },
  artifacts: {
    create: (input) => invoke(IPC.artifactsCreate, artifactCreateSchema.parse(input)),
    list: (threadId) => invoke(IPC.artifactsList, artifactListSchema.parse({ threadId })),
    open: (id) => invoke(IPC.artifactsOpen, artifactIdSchema.parse({ id })),
    saveAs: (id) => invoke(IPC.artifactsSaveAs, artifactIdSchema.parse({ id })),
  },
  schedules: {
    list: () => invoke(IPC.schedulesList),
    create: (input) => invoke(IPC.schedulesCreate, scheduledTaskCreateSchema.parse(input)),
    update: (input) => invoke(IPC.schedulesUpdate, scheduledTaskUpdateSchema.parse(input)),
    remove: (taskId) => invoke(IPC.schedulesRemove, scheduledTaskIdSchema.parse({ taskId })),
    runNow: (taskId) => invoke(IPC.schedulesRunNow, scheduledTaskIdSchema.parse({ taskId })),
    history: (taskId) => invoke(IPC.schedulesHistory, scheduledTaskIdSchema.parse({ taskId })),
  },
  events: {
    subscribe: (listener) => {
      const wrapped = (_event: Electron.IpcRendererEvent, raw: unknown) => {
        const parsed = whaleEventSchema.safeParse(raw);
        if (parsed.success) listener(parsed.data as WhaleEvent);
      };
      ipcRenderer.on(IPC.event, wrapped);
      return () => ipcRenderer.removeListener(IPC.event, wrapped);
    },
  },
};

// The exposed surface contains no generic IPC or process primitive.
contextBridge.exposeInMainWorld('whale', Object.freeze(api));
