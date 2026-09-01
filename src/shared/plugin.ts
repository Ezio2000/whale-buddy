import type { JsonValue } from './types';
import type { PluginCredentialValue } from './plugin-credentials';

export const WHALE_PLUGIN_API_VERSION = 2;
export const WHALE_PLUGIN_MESSAGE_CHANNEL = 'whale-plugin-v2';

export const PLUGIN_MESSAGE_ITEM_TYPES = [
  'userMessage',
  'agentMessage',
  'reasoning',
  'plan',
  'commandExecution',
  'fileChange',
  'mcpToolCall',
  'dynamicToolCall',
  'collabAgentToolCall',
  'webSearch',
  'imageGeneration',
  'imageView',
  'enteredReviewMode',
  'exitedReviewMode',
  'contextCompaction',
  'sleep',
] as const;

export type PluginMessageItemType = typeof PLUGIN_MESSAGE_ITEM_TYPES[number];
export type PluginToolScope = 'global' | 'project' | 'thread';
export type PluginStateScope = PluginToolScope;
export type PluginActionPlacement = 'commandPalette' | 'threadToolbar' | 'composerToolbar';

interface PluginUiBase {
  id: string;
  entryUrl: string;
  order: number;
}

export type PluginUiContribution =
  | PluginUiBase & {
      type: 'page';
      placement: 'navigation';
      title: string;
    }
  | PluginUiBase & {
      type: 'action';
      placement: PluginActionPlacement;
      title: string;
      description: string;
      keywords: string[];
    }
  | PluginUiBase & {
      type: 'widget';
      placement: 'composer';
    }
  | PluginUiBase & {
      type: 'panel';
      placement: 'turnDetails';
      title: string;
    }
  | PluginUiBase & {
      type: 'card';
      placement: 'message';
      title: string;
      itemTypes: PluginMessageItemType[];
      server: string | null;
      tools: string[];
    };

export interface PluginWebMcpTool {
  id: string;
  name: string;
  title: string;
  description: string;
  scope: PluginToolScope;
  inputSchema: JsonValue;
  annotations: {
    readOnlyHint: boolean;
    untrustedContentHint: boolean;
  };
}

export interface PluginMcpPermission {
  principal: string;
  server: string;
  tools: string[];
}

export interface PluginDescriptor {
  pluginId: string;
  pluginName: string;
  displayName: string;
  apiVersion: 2;
  uiContributions: PluginUiContribution[];
  webMcp: {
    entryUrl: string;
    tools: PluginWebMcpTool[];
  } | null;
  mcpPermissions: PluginMcpPermission[];
  credentials: PluginCredentialValue[];
}

export interface PluginComposerContextValue {
  label: string;
  value: JsonValue;
  explicitTools?: Array<{ server: string; name: string }>;
}

export interface PluginToolCardContext {
  itemId: string;
  server: string;
  tool: string;
  status: string;
  arguments: JsonValue | null;
  result: JsonValue | null;
  error: JsonValue | null;
  readOnlyHint: boolean | null;
}

export interface PluginMessageContext {
  itemId: string;
  itemType: PluginMessageItemType;
  status: string;
  data: JsonValue;
}

export interface PluginProjectContext {
  id: string;
  name: string;
  path: string;
}

export interface PluginThreadContext {
  id: string;
  name: string;
  cwd: string;
}

export type PluginFrameSurface =
  | {
      kind: 'ui';
      contributionId: string;
      contributionType: PluginUiContribution['type'];
      placement: PluginUiContribution['placement'];
    }
  | { kind: 'runtime' };

export interface PluginFrameContext {
  apiVersion: 2;
  pluginId: string;
  pluginName: string;
  surface: PluginFrameSurface;
  locale: string;
  theme: 'light' | 'dark';
  threadId: string | null;
  turnId: string | null;
  project: PluginProjectContext | null;
  thread: PluginThreadContext | null;
  credentials: PluginCredentialValue[];
  toolCall?: PluginToolCardContext;
  message?: PluginMessageContext;
}

export type PluginHostEvent =
  | { type: 'context.changed'; context: PluginFrameContext }
  | {
      type: 'state.changed';
      pluginId: string;
      scope: PluginStateScope;
      scopeId: string;
      value: JsonValue | null;
    }
  | { type: 'tool.started'; pluginId: string; toolId: string; callId: string }
  | {
      type: 'composerContext.changed';
      pluginId: string;
      sourceId: string;
      threadId: string;
      value: PluginComposerContextValue | null;
    }
  | { type: 'artifacts.changed'; pluginId: string; threadId: string; turnId: string | null }
  | {
      type: 'tool.completed';
      pluginId: string;
      toolId: string;
      callId: string;
      result: JsonValue;
    }
  | { type: 'tool.failed'; pluginId: string; toolId: string; callId: string; error: string };

export interface PluginMcpCallInput {
  pluginId: string;
  principal: string;
  threadId: string | null;
  server: string;
  tool: string;
  arguments?: JsonValue;
}
