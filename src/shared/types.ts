import type { ListMcpServerStatusResponse } from '../generated/protocol/typescript/v2/ListMcpServerStatusResponse';
import type { MarketplaceAddResponse } from '../generated/protocol/typescript/v2/MarketplaceAddResponse';
import type { MarketplaceRemoveResponse } from '../generated/protocol/typescript/v2/MarketplaceRemoveResponse';
import type { MarketplaceUpgradeResponse } from '../generated/protocol/typescript/v2/MarketplaceUpgradeResponse';
import type { PluginInstallResponse } from '../generated/protocol/typescript/v2/PluginInstallResponse';
import type { PluginListResponse } from '../generated/protocol/typescript/v2/PluginListResponse';
import type { PluginReadResponse } from '../generated/protocol/typescript/v2/PluginReadResponse';
import type { SkillsConfigWriteResponse } from '../generated/protocol/typescript/v2/SkillsConfigWriteResponse';
import type { ExtensionPolicySnapshot } from './extension-policy';
import type { SkillsListResponse } from '../generated/protocol/typescript/v2/SkillsListResponse';
import type { ModelProviderCapabilitiesReadResponse } from '../generated/protocol/typescript/v2/ModelProviderCapabilitiesReadResponse';
import type {
  PluginDescriptor,
  PluginMcpCallInput,
  PluginUiContribution,
  PluginWebMcpTool,
} from './plugin';
import type { PluginCredentialsSnapshot } from './plugin-credentials';
import type {
  PluginHookListInput,
  PluginHookPreview,
  PluginHookSetEnabledInput,
  PluginHooksListResponse,
} from './plugin-hooks';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue | undefined };

export interface IdentityContext {
  userId: string;
  username: string;
  displayName: string;
  sessionId: string;
  departments?: WhaleDepartment[];
  primaryDepartmentId?: string | null;
}

export interface PolicyDecision {
  id: string;
  source: 'execution-policy' | 'tool-approval' | 'user-approval';
  action: string;
  effect: 'allow' | 'deny' | 'confirm';
  reason: string;
  decidedAt: number;
  requestId: string | null;
}

export interface AuditEvent {
  id: string;
  operationId: string;
  type:
    | 'operation.started'
    | 'operation.steered'
    | 'operation.interrupt-requested'
    | 'operation.paused'
    | 'operation.resumed'
    | 'operation.activity'
    | 'approval.requested'
    | 'policy.decided'
    | 'operation.completed';
  action: string;
  outcome:
    | 'started'
    | 'confirmation-required'
    | 'allowed'
    | 'denied'
    | 'succeeded'
    | 'failed'
    | 'cancelled';
  timestamp: number;
  reason: string | null;
}

export interface OperationRecord {
  operationId: string;
  identity: IdentityContext | null;
  action: string;
  resource: JsonObject;
  threadId: string | null;
  turnId: string | null;
  createdAt: number;
  updatedAt: number;
  decisions: PolicyDecision[];
  events: AuditEvent[];
}

export type RuntimePhase =
  | 'stopped'
  | 'starting'
  | 'ready'
  | 'reconnecting'
  | 'faulted'
  | 'unavailable';

export interface RuntimeStatus {
  phase: RuntimePhase;
  generation: number;
  pid: number | null;
  codexVersion: string | null;
  protocolVersion: string | null;
  sidecarHome: string;
  codexHome: string;
  diagnosticLog: string;
  restartAttempt: number;
  message: string | null;
}

export type RuntimeProxyMode = 'inherit' | 'off' | 'custom';
export type RuntimeProviderMode = 'custom';
export type RuntimeReasoningEffort =
  | 'none'
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
  | 'max'
  | 'ultra';

export interface RuntimeModelCapabilities {
  contextWindow: number;
  imageInput: boolean;
  supportsReasoning: boolean;
  reasoningEfforts: RuntimeReasoningEffort[];
  defaultReasoningEffort: RuntimeReasoningEffort;
  supportsReasoningSummaries: boolean;
}

export interface RuntimeConnectionSettings {
  proxy: {
    mode: RuntimeProxyMode;
    url: string;
    noProxy: string;
  };
  provider: {
    mode: RuntimeProviderMode;
    id: string;
    name: string;
    baseUrl: string;
    model: string;
    capabilities: RuntimeModelCapabilities;
    hasApiKey: boolean;
  };
}

export interface RuntimeConnectionSettingsInput {
  proxy: RuntimeConnectionSettings['proxy'];
  provider: Omit<RuntimeConnectionSettings['provider'], 'hasApiKey'> & {
    apiKey?: string;
  };
}

export interface RuntimeBrandingSettings {
  name: string;
  iconPath: string;
  iconUrl: string | null;
}

export interface RuntimeBrandingSettingsInput {
  name: string;
  iconPath: string;
}

export interface WhaleUser {
  id: string;
  username: string;
  displayName: string;
  email: string | null;
  avatar: string | null;
  departments?: WhaleDepartment[];
  primaryDepartmentId?: string | null;
}

export interface WhaleDepartment {
  id: string;
  name: string;
}

export type WhaleAuthState =
  | { status: 'logged-out'; user: null; message: null }
  | { status: 'waiting'; user: null; message: null }
  | { status: 'logged-in'; user: WhaleUser; message: null }
  | { status: 'error'; user: null; message: string };

export interface WhaleAuthSettings {
  issuer: string;
}

export interface LocalProject {
  id: string;
  path: string;
  name: string;
  lastOpenedAt: number;
}

export interface ThreadSummary {
  id: string;
  preview: string;
  name: string | null;
  cwd: string;
  createdAt: number;
  updatedAt: number;
  status: unknown;
  archived?: boolean;
  turns?: unknown[];
  [key: string]: unknown;
}

export interface ModelSummary {
  id: string;
  model: string;
  displayName: string;
  description: string;
  isDefault: boolean;
  defaultReasoningEffort?: string;
  supportedReasoningEfforts?: Array<{ reasoningEffort: string; description?: string }>;
  [key: string]: unknown;
}

export interface HistoryPage {
  turns: unknown[];
  items: unknown[];
  plans: TurnPlanSnapshot[];
  changes: TurnChangesSnapshot[];
  operations?: OperationRecord[];
  turnsNextCursor: string | null;
  itemsNextCursor: string | null;
}

export interface TurnPlanSnapshot {
  turnId: string;
  explanation: string | null;
  plan: Array<{ step: string; status: string }>;
  updatedAt: number;
}

export interface TurnFileChange {
  path: string;
  kind: 'created' | 'modified' | 'deleted';
  size: number | null;
  binary: boolean;
  createdAt: number | null;
  modifiedAt: number | null;
}

export interface TurnChangesSnapshot {
  turnId: string;
  cwd: string;
  files: TurnFileChange[];
  diff: string;
  updatedAt: number;
}

export interface LocalAttachment {
  id?: string;
  name: string;
  path: string;
  kind: 'image' | 'file';
  mimeType?: string;
  size?: number;
  sha256?: string;
  originalPath?: string | null;
}

export interface ArtifactCreateInput {
  name: string;
  format: 'html' | 'docx' | 'xlsx' | 'pptx';
  dataBase64: string;
  threadId: string;
  taskId: string;
  pluginId?: string | null;
  turnId?: string | null;
}

export interface ArtifactRecord {
  id: string;
  name: string;
  path: string;
  format: ArtifactCreateInput['format'];
  mimeType: string;
  size: number;
  sha256: string;
  threadId: string;
  taskId: string;
  pluginId: string | null;
  turnId: string | null;
  createdAt: number;
}

export interface ExplicitSkillReference {
  name: string;
  path: string;
}

export interface ExplicitToolReference {
  server: string;
  name: string;
}

export interface ExplicitDynamicToolReference {
  pluginId: string;
  name: string;
}

export interface StartTurnInput {
  threadId: string;
  text: string;
  attachments?: LocalAttachment[];
  mentions?: Array<{ name: string; path: string }>;
  explicitSkills?: ExplicitSkillReference[];
  explicitTools?: ExplicitToolReference[];
  explicitDynamicTools?: ExplicitDynamicToolReference[];
  pluginContexts?: Array<{
    pluginId: string;
    contributionId: string;
    label: string;
    value: JsonValue;
    toolHints?: ExplicitToolReference[];
  }>;
  model?: string;
  effort?: string;
  cwd?: string;
  approvalPolicy?: 'untrusted' | 'on-request' | 'never';
  sandboxMode?: 'read-only' | 'workspace-write' | 'danger-full-access';
  resumeOperationId?: string;
}

export type TaskStatus =
  | 'planned'
  | 'running'
  | 'waiting-confirmation'
  | 'paused'
  | 'cancelled'
  | 'failed'
  | 'completed'
  | 'interrupted';

export type ScheduledTaskPreset = 'hourly' | 'daily' | 'weekdays' | 'weekly' | 'custom';
export type ScheduledRunStatus =
  | 'running'
  | 'waitingApproval'
  | 'completed'
  | 'failed'
  | 'skipped';

export interface ScheduledPluginContext {
  pluginId: string;
  contributionId: string;
  label: string;
  value: JsonValue;
  toolHints?: ExplicitToolReference[];
}

export interface ScheduledTaskInput {
  name: string;
  projectId: string;
  cwd: string;
  prompt: string;
  enabled: boolean;
  preset: ScheduledTaskPreset;
  cron: string;
  timezone: string;
  model?: string;
  effort: string;
  approvalPolicy: 'untrusted' | 'on-request' | 'never';
  sandboxMode: 'read-only' | 'workspace-write' | 'danger-full-access';
  pluginContexts?: ScheduledPluginContext[];
}

export interface ScheduledTask extends ScheduledTaskInput {
  id: string;
  threadId: string | null;
  createdAt: number;
  updatedAt: number;
  nextRunAt: number | null;
  lastRunAt: number | null;
  healthError: string | null;
}

export interface ScheduledRun {
  id: string;
  taskId: string;
  trigger: 'schedule' | 'manual';
  scheduledAt: number;
  startedAt: number | null;
  completedAt: number | null;
  status: ScheduledRunStatus;
  threadId: string | null;
  turnId: string | null;
  error: string | null;
  skippedReason: 'missed' | 'conflict' | 'runtimeUnavailable' | null;
}

export interface ApprovalResponseInput {
  requestId: string | number;
  method: string;
  response: JsonValue;
}

export interface FileSearchResult {
  name: string;
  path: string;
  relativePath: string;
}

export interface PluginLocationInput {
  pluginId: string;
  marketplaceName: string;
  marketplacePath: string | null;
  pluginName: string;
}

export interface PluginCredentialConfigureInput extends PluginLocationInput {
  credentialId: string;
  value: string | null;
}

export interface PluginContributionDetails {
  skills: Array<{
    name: string;
    path: string;
    contents: string;
  }>;
  mcp: {
    path: string;
    contents: string;
    servers: Array<{ name: string; config: Record<string, unknown> }>;
  } | null;
  uiContributions: PluginUiContribution[];
  webMcp: { tools: PluginWebMcpTool[] } | null;
}

export interface MarketplaceAddInput {
  source: string;
  refName?: string;
}

export type MenuCommand = 'open-project' | 'new-thread' | 'command-palette' | 'toggle-diff';

export type WhaleEvent =
  | {
      kind: 'notification';
      generation: number;
      sequence: number;
      message: { method: string; params?: unknown };
    }
  | {
      kind: 'serverRequest';
      generation: number;
      sequence: number;
      message: { id: string | number; method: string; params?: unknown };
    }
  | {
      kind: 'runtime';
      generation: number;
      sequence: number;
      event:
        | { type: 'status'; status: RuntimeStatus }
        | { type: 'diagnostic'; level: 'info' | 'warning' | 'error'; message: string }
        | { type: 'menu'; command: MenuCommand }
        | { type: 'turnChanges'; threadId: string; snapshot: TurnChangesSnapshot }
        | { type: 'scheduledTasksChanged'; tasks: ScheduledTask[] }
        | { type: 'scheduledRunUpdated'; run: ScheduledRun }
        | { type: 'pluginsChanged'; clearPluginId?: string }
        | { type: 'authChanged'; state: WhaleAuthState };
    };

export interface WhaleApi {
  auth: {
    status(): Promise<WhaleAuthState>;
    settings(): Promise<WhaleAuthSettings>;
    configure(input: WhaleAuthSettings): Promise<WhaleAuthSettings>;
    login(): Promise<WhaleAuthState>;
    logout(): Promise<WhaleAuthState>;
  };
  runtime: {
    windowCapabilities: {
      rendererDragRegions: boolean;
    };
    status(): Promise<RuntimeStatus>;
    restart(): Promise<RuntimeStatus>;
    settings(): Promise<RuntimeConnectionSettings>;
    revealProviderApiKey(): Promise<string | null>;
    configure(input: RuntimeConnectionSettingsInput): Promise<RuntimeConnectionSettings>;
    branding(): Promise<RuntimeBrandingSettings>;
    pickBrandIcon(): Promise<string | null>;
    configureBranding(input: RuntimeBrandingSettingsInput): Promise<RuntimeBrandingSettings>;
    quit(): Promise<void>;
  };
  projects: {
    list(): Promise<LocalProject[]>;
    open(): Promise<LocalProject | null>;
    remove(projectId: string): Promise<void>;
  };
  threads: {
    list(input?: { cursor?: string | null; archived?: boolean; cwd?: string }): Promise<unknown>;
    start(input: {
      cwd: string;
      model?: string;
      approvalPolicy?: 'untrusted' | 'on-request' | 'never';
      sandboxMode?: 'read-only' | 'workspace-write' | 'danger-full-access';
    }): Promise<unknown>;
    resume(threadId: string): Promise<unknown>;
    fork(threadId: string): Promise<unknown>;
    rename(threadId: string, name: string): Promise<unknown>;
    archive(threadId: string): Promise<unknown>;
    delete(threadId: string): Promise<unknown>;
    readHistory(input: {
      threadId: string;
      turnsCursor?: string | null;
      itemsCursor?: string | null;
      turnsLimit: number;
      itemsLimit: number;
      sortDirection: 'asc' | 'desc';
    }): Promise<HistoryPage>;
    compact(threadId: string): Promise<unknown>;
  };
  turns: {
    start(input: StartTurnInput): Promise<unknown>;
    steer(input: StartTurnInput & { turnId: string }): Promise<unknown>;
    interrupt(threadId: string, turnId: string): Promise<unknown>;
    pause(threadId: string, turnId: string): Promise<unknown>;
    review(threadId: string): Promise<unknown>;
  };
  approvals: {
    respond(input: ApprovalResponseInput): Promise<void>;
  };
  models: {
    list(): Promise<unknown>;
    capabilities(): Promise<ModelProviderCapabilitiesReadResponse>;
  };
  config: {
    read(cwd?: string): Promise<unknown>;
    write(input: { keyPath: string; value: JsonValue; expectedVersion?: string }): Promise<unknown>;
  };
  plugins: {
    list(input?: { cwd?: string; forceRefetch?: boolean }): Promise<PluginListResponse>;
    read(input: PluginLocationInput): Promise<PluginReadResponse>;
    contributions(input: PluginLocationInput): Promise<PluginContributionDetails>;
    credentials(input: PluginLocationInput): Promise<PluginCredentialsSnapshot>;
    configureCredential(input: PluginCredentialConfigureInput): Promise<PluginCredentialsSnapshot>;
    install(input: PluginLocationInput): Promise<PluginInstallResponse>;
    uninstall(input: PluginLocationInput): Promise<void>;
    setEnabled(
      input: PluginLocationInput & { enabled: boolean; cwd?: string; approvedHookDigest?: string },
    ): Promise<ExtensionPolicySnapshot>;
    descriptors(): Promise<PluginDescriptor[]>;
    callMcp(input: PluginMcpCallInput): Promise<JsonValue>;
  };
  hooks: {
    previewPlugin(input: PluginLocationInput): Promise<PluginHookPreview>;
    list(input?: PluginHookListInput): Promise<PluginHooksListResponse>;
    setEnabled(input: PluginHookSetEnabledInput): Promise<PluginHooksListResponse>;
  };
  marketplaces: {
    add(input: MarketplaceAddInput): Promise<MarketplaceAddResponse>;
    remove(marketplaceName: string): Promise<MarketplaceRemoveResponse>;
    upgrade(marketplaceName?: string): Promise<MarketplaceUpgradeResponse>;
    sources(): Promise<ExtensionPolicySnapshot>;
    setEnabled(marketplaceName: string, enabled: boolean): Promise<ExtensionPolicySnapshot>;
  };
  skills: {
    list(input?: { cwd?: string; forceReload?: boolean }): Promise<SkillsListResponse>;
    setEnabled(input: {
      path: string;
      scope: 'user' | 'repo' | 'system' | 'admin';
      pluginId: string | null;
      enabled: boolean;
    }): Promise<SkillsConfigWriteResponse>;
  };
  mcp: {
    list(input?: { threadId?: string }): Promise<ListMcpServerStatusResponse>;
    login(input: { name: string; threadId?: string }): Promise<{ started: true }>;
    setEnabled(input: { name: string; pluginId: string; enabled: boolean }): Promise<ExtensionPolicySnapshot>;
    reload(): Promise<void>;
  };
  files: {
    pickAttachments(): Promise<LocalAttachment[]>;
    saveClipboardAttachment(input: { dataUrl: string; name: string }): Promise<LocalAttachment>;
    search(projectPath: string, query: string): Promise<FileSearchResult[]>;
    readAttachment(path: string): Promise<{ dataBase64: string }>;
  };
  audit: {
    list(): Promise<OperationRecord[]>;
    clear(): Promise<void>;
  };
  artifacts: {
    create(input: ArtifactCreateInput): Promise<ArtifactRecord>;
    list(threadId?: string): Promise<ArtifactRecord[]>;
    open(id: string): Promise<void>;
    saveAs(id: string): Promise<string | null>;
  };
  schedules: {
    list(): Promise<ScheduledTask[]>;
    create(input: ScheduledTaskInput & { id: string }): Promise<ScheduledTask>;
    update(input: ScheduledTaskInput & { id: string }): Promise<ScheduledTask>;
    remove(taskId: string): Promise<void>;
    runNow(taskId: string): Promise<ScheduledRun>;
    history(taskId: string): Promise<ScheduledRun[]>;
  };
  events: {
    subscribe(listener: (event: WhaleEvent) => void): () => void;
  };
}
