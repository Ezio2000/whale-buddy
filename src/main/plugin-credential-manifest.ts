import type { PluginReadResponse } from '../generated/protocol/typescript/v2/PluginReadResponse';
import type {
  PluginCredentialDeclaration,
  PluginCredentialType,
} from '../shared/plugin-credentials';
import {
  isPluginCredentialEnvironmentName,
  isPluginCredentialKey,
} from '../shared/plugin-credentials';
import { readWhalePluginManifest, record } from './plugin-manifest';
import { WHALE_PLUGIN_API_VERSION } from '../shared/plugin';

export function readPluginCredentials(
  response: PluginReadResponse,
): PluginCredentialDeclaration[] {
  const resolved = readWhalePluginManifest(response);
  if (!resolved || resolved.whale.apiVersion !== WHALE_PLUGIN_API_VERSION) return [];
  const declaredServers = new Set(response.plugin.mcpServers);
  const rawCredentials = resolved.whale.credentials;
  if (!Array.isArray(rawCredentials)) return [];

  const seen = new Set<string>();
  const credentials: PluginCredentialDeclaration[] = [];
  for (const raw of rawCredentials.slice(0, 64)) {
    const credential = record(raw);
    const id = boundedString(credential?.id, 128);
    const key = boundedString(credential?.key, 128);
    const label = boundedString(credential?.label, 160);
    const description = boundedString(credential?.description, 1_024) ?? '';
    const env = boundedString(credential?.env, 256);
    const credentialType = parseCredentialType(credential?.credentialType);
    const scope = credential?.scope;
    const usedBy = record(credential?.usedBy);
    const mcpServers = stringArray(usedBy?.mcpServers, 512)
      .filter((server) => declaredServers.has(server));
    if (
      !id
      || seen.has(id)
      || !key
      || !isPluginCredentialKey(key)
      || !label
      || !env
      || !isPluginCredentialEnvironmentName(env)
      || !credentialType
      || scope !== 'marketplace'
      || mcpServers.length === 0
    ) {
      continue;
    }
    credentials.push({
      id,
      key,
      credentialType,
      label,
      description,
      env,
      required: credential?.required === true,
      scope,
      mcpServers,
    });
    seen.add(id);
  }
  return credentials.slice(0, 16);
}

function parseCredentialType(value: unknown): PluginCredentialType | null {
  return value === 'apiKey' || value === 'bearerToken' ? value : null;
}

function boundedString(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.trim() && value.length <= max ? value.trim() : null;
}

function stringArray(value: unknown, max: number): string[] {
  return Array.isArray(value)
    ? Array.from(new Set(value.flatMap((entry) => {
        const item = boundedString(entry, max);
        return item ? [item] : [];
      }))).slice(0, 128)
    : [];
}
