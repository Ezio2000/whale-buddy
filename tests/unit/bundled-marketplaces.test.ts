import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ensureBundledMarketplaces } from '../../src/main/bundled-marketplaces';
import { ExtensionPolicyStore } from '../../src/main/extension-policy';

describe('bundled marketplaces', () => {
  it('registers office and AIHub as presets and restarts once', async () => {
    const stateRoot = await mkdtemp(path.join(tmpdir(), 'whale-bundled-marketplaces-'));
    const policy = new ExtensionPolicyStore(stateRoot);
    const request = vi.fn(async (_method: string, input: unknown) => {
      const source = (input as { source: string }).source;
      return { marketplaceName: source.endsWith('office') ? 'whale-office' : 'whale-aihub' };
    });
    const restart = vi.fn(async () => undefined);

    await ensureBundledMarketplaces(
      { request, restart },
      policy,
      '/workspace',
      '/resources',
      false,
    );

    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenNthCalledWith(1, 'marketplace/add', {
      source: path.join('/workspace', 'marketplaces', 'office'),
      refName: null,
      sparsePaths: null,
    });
    expect(request).toHaveBeenNthCalledWith(2, 'marketplace/add', {
      source: path.join('/workspace', 'marketplaces', 'aihub'),
      refName: null,
      sparsePaths: null,
    });
    expect(policy.source('whale-office')).toMatchObject({ preset: true, enabled: true });
    expect(policy.source('whale-aihub')).toMatchObject({ preset: true, enabled: true });
    expect(restart).toHaveBeenCalledTimes(1);

    await ensureBundledMarketplaces(
      { request, restart },
      policy,
      '/workspace',
      '/resources',
      false,
    );
    expect(request).toHaveBeenCalledTimes(2);
    expect(restart).toHaveBeenCalledTimes(1);
  });

  it('uses packaged resource paths and rejects an unexpected manifest name', async () => {
    const stateRoot = await mkdtemp(path.join(tmpdir(), 'whale-bundled-marketplaces-'));
    const policy = new ExtensionPolicyStore(stateRoot);
    const request = vi.fn(async () => ({ marketplaceName: 'unexpected' }));

    await expect(ensureBundledMarketplaces(
      { request, restart: vi.fn(async () => undefined) },
      policy,
      '/workspace',
      '/app/resources',
      true,
    )).rejects.toThrow('办公商城清单名称无效');
    expect(request).toHaveBeenCalledWith('marketplace/add', {
      source: path.join('/app/resources', 'office'),
      refName: null,
      sparsePaths: null,
    });
  });
});

describe('AIHub merge migration', () => {
  it.each([true, false])('migrates an Outlook-only installation without changing its enabled preference (%s)', async (enabled) => {
    const { migrateAIHubPlugin } = await import('../../src/main/bundled-marketplaces');
    const dir = await mkdtemp(path.join(tmpdir(), 'whale-aihub-merge-'));
    const policy = new ExtensionPolicyStore(dir);
    policy.addMarketplace('whale-aihub', '/resources/aihub', null, true);
    policy.registerPlugin('xiaojing-outlook@whale-aihub', 'whale-aihub', ['xiaojing-outlook']);
    policy.setPluginEnabled('xiaojing-outlook@whale-aihub', enabled);
    const request = vi.fn().mockResolvedValue({});
    expect(await migrateAIHubPlugin({ request }, policy)).toBe(true);
    expect(request).toHaveBeenCalledWith('plugin/install', expect.objectContaining({ pluginName: 'xiaojing-knowledge-base' }));
    expect(policy.isPluginEnabled('xiaojing-outlook@whale-aihub')).toBe(false);
    expect(policy.isPluginEnabled('xiaojing-knowledge-base@whale-aihub')).toBe(enabled);
    expect(await migrateAIHubPlugin({ request }, new ExtensionPolicyStore(dir))).toBe(false);
    expect(request).toHaveBeenCalledTimes(2);
  });
  it('leaves the old policy retryable when installation fails', async () => {
    const { migrateAIHubPlugin } = await import('../../src/main/bundled-marketplaces');
    const dir = await mkdtemp(path.join(tmpdir(), 'whale-aihub-merge-'));
    const policy = new ExtensionPolicyStore(dir);
    policy.addMarketplace('whale-aihub', '/resources/aihub', null, true);
    policy.registerPlugin('xiaojing-outlook@whale-aihub', 'whale-aihub', ['xiaojing-outlook']);
    policy.setPluginEnabled('xiaojing-outlook@whale-aihub', true);
    await expect(migrateAIHubPlugin({ request: vi.fn().mockRejectedValue(new Error('offline')) }, policy)).rejects.toThrow('offline');
    expect(policy.isPluginEnabled('xiaojing-outlook@whale-aihub')).toBe(true);
    expect(policy.hasMigration('aihub-unified-v1')).toBe(false);
  });
});

it('keeps the shared credential declaration and a disabled MCP when merging existing installs', async () => {
  const { migrateAIHubPlugin } = await import('../../src/main/bundled-marketplaces');
  const dir = await mkdtemp(path.join(tmpdir(), 'whale-aihub-preferences-'));
  const policy = new ExtensionPolicyStore(dir);
  policy.addMarketplace('whale-aihub', '/resources/aihub', null, true);
  const mergedId = 'xiaojing-knowledge-base@whale-aihub';
  policy.registerPlugin(mergedId, 'whale-aihub', ['xiaojing-knowledge-base'], [{
    id: 'aihub-token', key: 'aihub/token', credentialType: 'bearerToken', label: 'AIHub Key',
    description: '', env: 'AIHUB_MCP_TOKEN', required: true, scope: 'marketplace', mcpServers: ['xiaojing-knowledge-base'],
  }]);
  policy.setPluginEnabled(mergedId, true);
  policy.setMcpEnabled(mergedId, 'xiaojing-knowledge-base', false);
  await migrateAIHubPlugin({ request: vi.fn().mockResolvedValue({}) }, policy);
  const merged = policy.snapshot().plugins.find((p) => p.pluginId === mergedId)!;
  expect(merged.enabled).toBe(true);
  expect(merged.enabledMcpServers).toEqual([]);
  expect(merged.credentials[0]).toMatchObject({ key: 'aihub/token', env: 'AIHUB_MCP_TOKEN' });
});
