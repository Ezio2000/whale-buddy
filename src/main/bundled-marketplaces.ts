import { pluginConfigKey, pluginMcpConfigKey } from '../shared/extension-policy';
import path from 'node:path';
import type { AppServerClient } from './app-server-client';
import type { ExtensionPolicyStore } from './extension-policy';

interface BundledMarketplace {
  name: string;
  directory: string;
  label: string;
}

const BUNDLED_MARKETPLACES: readonly BundledMarketplace[] = [
  { name: 'whale-office', directory: 'office', label: '办公' },
  { name: 'whale-aihub', directory: 'aihub', label: 'AIHub' },
];

export async function ensureBundledMarketplaces(
  client: Pick<AppServerClient, 'request' | 'restart'>,
  policy: ExtensionPolicyStore,
  projectRoot: string,
  resourcesRoot: string,
  packaged: boolean,
): Promise<void> {
  let added = false;
  for (const marketplace of BUNDLED_MARKETPLACES) {
    if (policy.source(marketplace.name)) continue;
    const source = packaged
      ? path.join(resourcesRoot, marketplace.directory)
      : path.join(projectRoot, 'marketplaces', marketplace.directory);
    const response = await client.request('marketplace/add', {
      source,
      refName: null,
      sparsePaths: null,
    }) as { marketplaceName?: unknown };
    if (response.marketplaceName !== marketplace.name) {
      throw new Error(`${marketplace.label}商城清单名称无效`);
    }
    policy.addMarketplace(marketplace.name, source, null, true);
    added = true;
  }
  const migrated = await migrateAIHubPlugin(client, policy);
  const refreshed = await refreshBundledPluginUis(client, policy);
  if (added || migrated || refreshed) await client.restart();
}


// Keep the original knowledge plugin ID so its credentials and conversation state survive.
export async function migrateAIHubPlugin(
  client: Pick<AppServerClient, 'request'>,
  policy: ExtensionPolicyStore,
): Promise<boolean> {
  const migration = 'aihub-unified-v1';
  const source = policy.source('whale-aihub');
  if (policy.hasMigration(migration) || !source?.preset || !source.enabled || !source.source) return false;
  const mergedId = 'xiaojing-knowledge-base@whale-aihub';
  const legacyId = 'xiaojing-outlook@whale-aihub';
  const server = 'xiaojing-knowledge-base';
  const plugins = policy.snapshot().plugins;
  const merged = plugins.find((plugin) => plugin.pluginId === mergedId);
  const legacy = plugins.find((plugin) => plugin.pluginId === legacyId);
  if (!merged && !legacy) { policy.markMigration(migration); return false; }
  const enabled = Boolean(merged?.enabled || legacy?.enabled);
  const mcpEnabled = Boolean(merged?.enabled && merged.enabledMcpServers.includes(server)
    || legacy?.enabled && legacy.enabledMcpServers.includes('xiaojing-outlook'));
  const credentials = (merged?.credentials.length ? merged.credentials : legacy?.credentials ?? [])
    .map((credential) => ({ ...credential, mcpServers: [server] }));
  // Install from the updated bundled catalog, not an old cached manifest.
  await client.request('plugin/install', {
    marketplacePath: path.join(source.source, '.agents/plugins/marketplace.json'),
    remoteMarketplaceName: null,
    pluginName: 'xiaojing-knowledge-base',
  });
  await client.request('config/batchWrite', {
    edits: [
      { keyPath: pluginConfigKey(legacyId) + '.enabled', value: false, mergeStrategy: 'replace' },
      { keyPath: pluginMcpConfigKey(legacyId, 'xiaojing-outlook') + '.enabled', value: false, mergeStrategy: 'replace' },
      { keyPath: pluginConfigKey(mergedId) + '.enabled', value: enabled, mergeStrategy: 'replace' },
      { keyPath: pluginMcpConfigKey(mergedId, server) + '.enabled', value: mcpEnabled, mergeStrategy: 'replace' },
    ], expectedVersion: null,
  });
  if (legacy) policy.setPluginEnabled(legacyId, false);
  if (!merged) policy.registerPlugin(mergedId, 'whale-aihub', [server], credentials);
  policy.setPluginEnabled(mergedId, enabled, [server], credentials);
  if (enabled && !mcpEnabled) policy.setMcpEnabled(mergedId, server, false);
  policy.markMigration(migration);
  return true;
}

// Ship UI fixes to already-installed bundled plugins without changing enabled
// preferences, per-tool policies, credentials or historical plugin state.
export async function refreshBundledPluginUis(
  client: Pick<AppServerClient, 'request'>,
  policy: ExtensionPolicyStore,
): Promise<boolean> {
  let refreshed = false;
  for (const [marketplace, pluginName] of [
    ['whale-office', 'whale-office-assistant'], ['whale-aihub', 'xiaojing-knowledge-base'],
  ]) {
    const revision = pluginName === 'xiaojing-knowledge-base' ? 'v2' : 'v1';
    const migration = 'ui-audit-20260905-' + revision + ':' + pluginName;
    const source = policy.source(marketplace);
    if (policy.hasMigration(migration) || !source?.preset || !source.enabled || !source.source) continue;
    const plugin = policy.snapshot().plugins.find((entry) => entry.pluginId === pluginName + '@' + marketplace);
    if (!plugin) { policy.markMigration(migration); continue; }
    await client.request('plugin/install', { marketplacePath: path.join(source.source, '.agents/plugins/marketplace.json'), remoteMarketplaceName: null, pluginName });
    await client.request('config/batchWrite', {
      edits: [
        { keyPath: pluginConfigKey(plugin.pluginId) + '.enabled', value: plugin.enabled, mergeStrategy: 'replace' },
        ...plugin.mcpServers.map((server) => ({ keyPath: pluginMcpConfigKey(plugin.pluginId, server) + '.enabled', value: plugin.enabledMcpServers.includes(server), mergeStrategy: 'replace' })),
      ], expectedVersion: null,
    });
    policy.markMigration(migration);
    refreshed = true;
  }
  return refreshed;
}
