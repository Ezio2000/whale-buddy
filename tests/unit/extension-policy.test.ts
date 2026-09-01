import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ExtensionPolicyStore } from '../../src/main/extension-policy';
import type { PluginCredentialDeclaration } from '../../src/shared/plugin-credentials';

const fixtureCredential: PluginCredentialDeclaration = {
  id: 'fixture-token',
  key: 'fixture/token',
  credentialType: 'bearerToken',
  label: 'Fixture Token',
  description: 'Fixture credential',
  env: 'FIXTURE_MCP_TOKEN',
  required: true,
  scope: 'marketplace',
  mcpServers: ['demo-mcp'],
};

describe('ExtensionPolicyStore', () => {
  it('starts with a fail-closed runtime and no enabled extension sources', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'whale-extension-policy-'));
    const store = new ExtensionPolicyStore(root);

    expect(store.sources()).toEqual([]);
    expect(store.enabledMarketplaceNames()).toEqual([]);
    expect(store.launchConfigOverrides()).toEqual(expect.arrayContaining([
      'features.apps=false',
      'features.plugins=false',
      'features.remote_plugin=false',
      'features.recommended_plugins=false',
      'features.tool_suggest=false',
      'skills.bundled.enabled=false',
      'skills.include_instructions=false',
    ]));
  });

  it('only activates explicitly added sources, plugins, and MCP servers', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'whale-extension-policy-'));
    const store = new ExtensionPolicyStore(root);
    store.addMarketplace('private-tools', 'https://example.test/private-tools.git', 'main');
    store.registerPlugin('demo@private-tools', 'private-tools', ['demo-mcp']);

    let launch = store.launchConfigOverrides();
    expect(launch).toContain('features.plugins=true');
    expect(launch).toContain('plugins."demo@private-tools".enabled=false');
    expect(launch).toContain(
      'plugins."demo@private-tools".mcp_servers."demo-mcp".enabled=false',
    );

    store.setPluginEnabled('demo@private-tools', true);
    launch = store.launchConfigOverrides();
    expect(launch).toContain('plugins."demo@private-tools".enabled=true');
    expect(launch).toContain(
      'plugins."demo@private-tools".mcp_servers."demo-mcp".enabled=true',
    );

    store.setMcpEnabled('demo@private-tools', 'demo-mcp', false);
    expect(store.isMcpEnabled('demo@private-tools', 'demo-mcp')).toBe(false);
    store.setPluginEnabled('demo@private-tools', false);
    store.setPluginEnabled('demo@private-tools', true);
    launch = store.launchConfigOverrides();
    expect(launch).toEqual(expect.arrayContaining([
      'features.apps=false',
      'features.remote_plugin=false',
      'skills.bundled.enabled=false',
      'skills.include_instructions=true',
      'plugins."demo@private-tools".enabled=true',
      'plugins."demo@private-tools".mcp_servers."demo-mcp".enabled=true',
    ]));
  });

  it('activates persisted credential contributions only with their plugin MCP', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'whale-extension-policy-'));
    const store = new ExtensionPolicyStore(root);
    store.addMarketplace('private-tools', '/private/catalog', null);
    store.registerPlugin('demo@private-tools', 'private-tools', ['demo-mcp'], [fixtureCredential]);

    expect(store.activeCredentials()).toEqual([]);
    store.setPluginEnabled('demo@private-tools', true);
    expect(store.activeCredentials()).toEqual([{
      ...fixtureCredential,
      pluginId: 'demo@private-tools',
      marketplaceName: 'private-tools',
    }]);
    expect(store.activeCredentialsForMcp('demo@private-tools', 'demo-mcp')).toEqual([{
      ...fixtureCredential,
      pluginId: 'demo@private-tools',
      marketplaceName: 'private-tools',
    }]);
    expect(store.activeCredentialsForMcp('demo@private-tools', 'other-mcp')).toEqual([]);

    store.setMcpEnabled('demo@private-tools', 'demo-mcp', false);
    expect(store.activeCredentials()).toEqual([]);
    expect(new ExtensionPolicyStore(root).snapshot().plugins[0].credentials).toEqual([
      fixtureCredential,
    ]);
  });

  it('only selects enabled Git marketplaces for remote upgrades', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'whale-extension-policy-'));
    const store = new ExtensionPolicyStore(root);
    store.addMarketplace('local-tools', '/Users/test/local-tools', null);
    store.addMarketplace('relative-local', './fixtures/local-tools', null);
    store.addMarketplace('remote-tools', 'https://example.test/remote-tools.git', 'main');
    store.addMarketplace('github-short', 'owner/repo', null);
    store.setSourceEnabled('github-short', false);

    expect(store.enabledMarketplaceNames()).toEqual([
      'local-tools',
      'relative-local',
      'remote-tools',
    ]);
    expect(store.enabledGitMarketplaceNames()).toEqual(['remote-tools']);
  });

  it('keeps the bundled office source removable only by disabling it', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'whale-extension-policy-'));
    const store = new ExtensionPolicyStore(root);
    store.addMarketplace('whale-office', '/Applications/Whale Buddy.app/Contents/Resources/office', null, true);

    expect(store.source('whale-office')).toMatchObject({ preset: true, enabled: true });
    expect(() => store.removeMarketplace('whale-office')).toThrow('预置商城源不能删除');
    store.setSourceEnabled('whale-office', false);
    expect(new ExtensionPolicyStore(root).source('whale-office')).toMatchObject({ preset: true, enabled: false });
  });

  it('keeps cached plugin intent inert while its source is disabled', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'whale-extension-policy-'));
    const store = new ExtensionPolicyStore(root);
    store.addMarketplace('private-tools', '/private/catalog', null);
    store.registerPlugin('demo@private-tools', 'private-tools', ['demo-mcp']);
    store.setPluginEnabled('demo@private-tools', true);
    store.setMcpEnabled('demo@private-tools', 'demo-mcp', true);
    store.setSourceEnabled('private-tools', false);

    expect(store.isPluginEnabled('demo@private-tools')).toBe(false);
    expect(store.isMcpEnabled('demo@private-tools', 'demo-mcp')).toBe(false);
    expect(store.launchConfigOverrides()).toEqual(expect.arrayContaining([
      'features.plugins=false',
      'plugins."demo@private-tools".enabled=false',
      'plugins."demo@private-tools".mcp_servers."demo-mcp".enabled=false',
    ]));

    const reloaded = new ExtensionPolicyStore(root);
    expect(reloaded.isPluginEnabled('demo@private-tools')).toBe(false);
    expect(reloaded.source('private-tools')?.enabled).toBe(false);
  });

  it('does not migrate an incompatible policy file and fails closed instead', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'whale-extension-policy-'));
    await writeFile(path.join(root, 'extension-policy.json'), JSON.stringify({
      version: 0,
      visibleMarketplaces: ['openai-curated-remote'],
      enabledPlugins: ['legacy-plugin'],
    }));

    const store = new ExtensionPolicyStore(root);

    expect(store.sources()).toEqual([]);
    expect(store.snapshot().plugins).toEqual([]);
    expect(store.launchConfigOverrides()).toContain('features.plugins=false');
  });

  it('drops all retired preset sources and their plugins from existing state', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'whale-extension-policy-'));
    await writeFile(path.join(root, 'extension-policy.json'), JSON.stringify({
      version: 1,
      enabledBuiltinSources: ['codex-bundled-skills', 'codex-apps', 'openai-curated-remote'],
      marketplaces: [{
        name: 'openai-curated-remote',
        source: 'preset',
        refName: null,
        enabled: true,
      }],
      plugins: [{
        pluginId: 'retired-plugin',
        marketplaceName: 'openai-curated-remote',
        enabled: true,
        mcpServers: ['retired-mcp'],
        enabledMcpServers: ['retired-mcp'],
      }],
      enabledSkillPaths: [],
    }));

    const store = new ExtensionPolicyStore(root);
    expect(store.sources()).toEqual([]);
    expect(store.snapshot().plugins).toEqual([]);
    const persisted = JSON.parse(
      await readFile(path.join(root, 'extension-policy.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(persisted).not.toHaveProperty('enabledBuiltinSources');
    expect(store.launchConfigOverrides()).toEqual(expect.arrayContaining([
      'features.apps=false',
      'features.plugins=false',
      'features.remote_plugin=false',
      'skills.bundled.enabled=false',
    ]));
  });
});
