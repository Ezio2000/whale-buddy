import type { JsonValue } from './types';

export const WHALE_PLUGIN_UI_API_VERSION = 1;
export const WHALE_PLUGIN_MESSAGE_CHANNEL = 'whale-plugin-ui-v1';

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
    };

export interface PluginUiDescriptor {
  pluginId: string;
  pluginName: string;
  displayName: string;
  apiVersion: number;
  contributions: PluginUiContribution[];
  uiMcpPermissions: Array<{ server: string; tools: string[] }>;
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

export interface PluginUiCallToolInput {
  pluginId: string;
  contributionId: string;
  threadId: string;
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
  threadId: string;
  toolCall?: PluginToolCardContext;
}
