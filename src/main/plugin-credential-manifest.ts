import type { PluginReadResponse } from '../generated/protocol/typescript/v2/PluginReadResponse';
import type {
  PluginCredentialContribution,
  PluginCredentialType,
} from '../shared/plugin-credentials';
import {
  isPluginCredentialEnvironmentName,
  isPluginCredentialKey,
} from '../shared/plugin-credentials';
import { readWhalePluginManifest, record } from './plugin-manifest';
import { WHALE_PLUGIN_API_VERSION } from '../shared/plugin-ui';

export function readPluginCredentialContributions(
  response: PluginReadResponse,
): PluginCredentialContribution[] {
  const resolved = readWhalePluginManifest(response);
  if (!resolved || resolved.whale.apiVersion !== WHALE_PLUGIN_API_VERSION) return [];
  const declaredServers = new Set(response.plugin.mcpServers);
  const rawContributions = resolved.whale.contributions;
  if (!Array.isArray(rawContributions)) return [];

  const seen = new Set<string>();
  const credentials: PluginCredentialContribution[] = [];
  for (const raw of rawContributions.slice(0, 64)) {
    const contribution = record(raw);
    if (contribution?.type !== 'credential') continue;
    const id = boundedString(contribution.id, 128);
    const key = boundedString(contribution.key, 128);
    const label = boundedString(contribution.label, 160);
    const description = boundedString(contribution.description, 1_024) ?? '';
    const env = boundedString(contribution.env, 256);
    const credentialType = parseCredentialType(contribution.credentialType);
    const scope = contribution.scope === undefined ? 'marketplace' : contribution.scope;
    const usedBy = record(contribution.usedBy);
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
      type: 'credential',
      key,
      credentialType,
      label,
      description,
      env,
      required: contribution.required === true,
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
