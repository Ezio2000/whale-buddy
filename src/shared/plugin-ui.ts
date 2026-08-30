import type { JsonValue } from './types';
import type { PluginCredentialValue } from './plugin-credentials';

export const WHALE_PLUGIN_API_VERSION = 1;
export const WHALE_PLUGIN_UI_API_VERSION = WHALE_PLUGIN_API_VERSION;
export const WHALE_PLUGIN_MESSAGE_CHANNEL = 'whale-plugin-ui-v1';

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

export type PluginUiContribution =
  | {
      id: string;
      type: 'composer.widget';
      entryUrl: string;
      order: number;
    }
  | {
      id: string;
      type: 'mcp.toolCard';
      entryUrl: string;
      server: string;
      tools: string[];
    }
  | {
      id: string;
      type: 'navigation.page';
      entryUrl: string;
      title: string;
      order: number;
    }
  | {
      id: string;
      type: 'command.action';
      entryUrl: string;
      title: string;
      description: string;
      keywords: string[];
      order: number;
    }
  | {
      id: string;
      type: 'thread.toolbarAction';
      entryUrl: string;
      title: string;
      order: number;
    }
  | {
      id: string;
      type: 'composer.action';
      entryUrl: string;
      title: string;
      order: number;
    }
  | {
      id: string;
      type: 'message.card';
      entryUrl: string;
      title: string;
      itemTypes: PluginMessageItemType[];
      server: string | null;
      tools: string[];
      order: number;
    };

export interface PluginUiDescriptor {
  pluginId: string;
  pluginName: string;
  displayName: string;
  apiVersion: number;
  contributions: PluginUiContribution[];
  uiMcpPermissions: Array<{ server: string; tools: string[] }>;
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

export interface PluginUiCallToolInput {
  pluginId: string;
  contributionId: string;
  threadId: string | null;
  server: string;
  tool: string;
  arguments?: JsonValue;
}

export interface PluginUiFrameContext {
  apiVersion: 1;
  pluginId: string;
  pluginName: string;
  contributionId: string;
  contributionType: PluginUiContribution['type'];
  locale: string;
  theme: 'light' | 'dark';
  threadId: string | null;
  project: PluginProjectContext | null;
  thread: PluginThreadContext | null;
  credentials: PluginCredentialValue[];
  toolCall?: PluginToolCardContext;
  message?: PluginMessageContext;
}
