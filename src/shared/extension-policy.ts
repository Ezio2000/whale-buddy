import type { PluginCredentialContribution } from './plugin-credentials';
export type { ActivePluginCredential } from './plugin-credentials';

const RETIRED_PRESET_SOURCE_NAMES = [
  'codex-bundled-skills',
  'codex-apps',
  'openai-curated-remote',
  'openai-curated',
  'openai-api-curated',
] as const;

export type ExtensionSourceKind = 'marketplace';

export interface ExtensionSource {
  name: string;
  title: string;
  description: string;
  kind: ExtensionSourceKind;
  source: string | null;
  refName: string | null;
  enabled: boolean;
}

export interface ExtensionPluginPolicy {
  pluginId: string;
  marketplaceName: string;
  enabled: boolean;
  mcpServers: string[];
  enabledMcpServers: string[];
  credentials: PluginCredentialContribution[];
}

export interface ExtensionPolicySnapshot {
  sources: ExtensionSource[];
  plugins: ExtensionPluginPolicy[];
  enabledSkillPaths: string[];
}

export function normalizeExtensionName(name: string): string {
  return name.trim().toLocaleLowerCase('en-US');
}

export function isRetiredPresetSourceName(name: string): boolean {
  return RETIRED_PRESET_SOURCE_NAMES.includes(
    normalizeExtensionName(name) as (typeof RETIRED_PRESET_SOURCE_NAMES)[number],
  );
}

export function pluginConfigKey(pluginId: string): string {
  return `plugins.${tomlQuotedKey(pluginId)}`;
}

export function pluginMcpConfigKey(pluginId: string, serverName: string): string {
  return `${pluginConfigKey(pluginId)}.mcp_servers.${tomlQuotedKey(serverName)}`;
}

export function tomlQuotedKey(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}
