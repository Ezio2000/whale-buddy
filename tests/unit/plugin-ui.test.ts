import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { PluginReadResponse } from '../../src/generated/protocol/typescript/v2/PluginReadResponse';
import {
  pluginMcpHttpConnection,
  readPluginUiDescriptor,
  replacePluginUiRegistry,
} from '../../src/main/plugin-ui';
import { readPluginCredentialContributions } from '../../src/main/plugin-credential-manifest';

const roots: string[] = [];

afterEach(() => {
  replacePluginUiRegistry([]);
});

describe('plugin UI manifest', () => {
  it('accepts versioned entries inside the plugin root and filters permissions', async () => {
    const root = await fixtureRoot({
      whale: {
        apiVersion: 1,
        contributions: [
          { id: 'widget', type: 'composer.widget', entry: './ui/index.html', order: 7 },
          {
            id: 'card',
            type: 'mcp.toolCard',
            entry: './ui/index.html',
            server: 'fixture-mcp',
            tools: ['inspect'],
          },
          {
            id: 'navigation',
            type: 'navigation.page',
            entry: './ui/index.html',
            title: 'Fixture Home',
            order: 5,
          },
          {
            id: 'command',
            type: 'command.action',
            entry: './ui/index.html',
            title: 'Fixture Command',
            description: 'Open fixture',
            keywords: ['fixture'],
          },
          {
            id: 'thread-action',
            type: 'thread.toolbarAction',
            entry: './ui/index.html',
            title: 'Fixture Thread',
          },
          {
            id: 'composer-action',
            type: 'composer.action',
            entry: './ui/index.html',
            title: 'Fixture Composer',
          },
          {
            id: 'message',
            type: 'message.card',
            entry: './ui/index.html',
            title: 'Fixture Result',
            itemTypes: ['mcpToolCall'],
            server: 'fixture-mcp',
            tools: ['inspect'],
          },
        ],
        uiMcpPermissions: [
          { server: 'fixture-mcp', tools: ['list'] },
          { server: 'foreign-mcp', tools: ['steal'] },
        ],
      },
    });

    const descriptor = readPluginUiDescriptor(pluginResponse(root));

    expect(descriptor?.contributions).toHaveLength(7);
    expect(descriptor?.contributions[0].entryUrl).toBe(
      'whale-plugin://plugin/fixture-plugin/ui/index.html',
    );
    expect(descriptor?.uiMcpPermissions).toEqual([
      { server: 'fixture-mcp', tools: ['list'] },
    ]);
    expect(descriptor?.contributions.slice(2)).toEqual([
      expect.objectContaining({ id: 'navigation', type: 'navigation.page', title: 'Fixture Home' }),
      expect.objectContaining({ id: 'command', type: 'command.action', keywords: ['fixture'] }),
      expect.objectContaining({ id: 'thread-action', type: 'thread.toolbarAction' }),
      expect.objectContaining({ id: 'composer-action', type: 'composer.action' }),
      expect.objectContaining({
        id: 'message',
        type: 'message.card',
        itemTypes: ['mcpToolCall'],
        server: 'fixture-mcp',
        tools: ['inspect'],
      }),
    ]);
  });

  it('drops malformed host contributions without hiding valid entries', async () => {
    const root = await fixtureRoot({
      whale: {
        apiVersion: 1,
        contributions: [
          { id: 'valid', type: 'navigation.page', entry: './ui/index.html', title: 'Valid' },
          { id: 'missing-title', type: 'command.action', entry: './ui/index.html' },
          {
            id: 'foreign-message',
            type: 'message.card',
            entry: './ui/index.html',
            title: 'Foreign',
            itemTypes: ['mcpToolCall'],
            server: 'foreign-mcp',
            tools: ['inspect'],
          },
          {
            id: 'unknown-message',
            type: 'message.card',
            entry: './ui/index.html',
            title: 'Unknown',
            itemTypes: ['inventedMessage'],
          },
        ],
      },
    });

    expect(readPluginUiDescriptor(pluginResponse(root))?.contributions).toEqual([
      expect.objectContaining({ id: 'valid', type: 'navigation.page' }),
    ]);
  });

  it('rejects entries outside the plugin root and unsupported API versions', async () => {
    const escaped = await fixtureRoot({
      whale: {
        apiVersion: 1,
        contributions: [{ id: 'escape', type: 'composer.widget', entry: '../outside.html' }],
      },
    });
    expect(readPluginUiDescriptor(pluginResponse(escaped))).toBeNull();

    const unsupported = await fixtureRoot({
      whale: {
        apiVersion: 99,
        contributions: [{ id: 'widget', type: 'composer.widget', entry: './ui/index.html' }],
      },
    });
    expect(readPluginUiDescriptor(pluginResponse(unsupported))).toBeNull();
  });

  it('reads an enabled plugin own HTTP MCP connection without exposing it to the renderer', async () => {
    const root = await fixtureRoot({
      whale: {
        apiVersion: 1,
        contributions: [{ id: 'widget', type: 'composer.widget', entry: './ui/index.html' }],
      },
    });
    await writeFile(path.join(root, '.mcp.json'), JSON.stringify({
      mcpServers: {
        'fixture-mcp': {
          url: 'https://example.test/mcp',
          http_headers: { Authorization: 'Bearer fixture-secret' },
          tool_timeout_sec: 12,
        },
      },
    }));
    const descriptor = readPluginUiDescriptor(pluginResponse(root));
    expect(descriptor).not.toBeNull();
    replacePluginUiRegistry([{ descriptor: descriptor!, root }]);

    expect(pluginMcpHttpConnection('fixture-plugin', 'fixture-mcp')).toEqual({
      url: 'https://example.test/mcp',
      headers: { Authorization: 'Bearer fixture-secret' },
      timeoutMs: 12_000,
    });
  });

  it('adds a declared bearer token to direct plugin UI MCP calls', async () => {
    const root = await fixtureRoot({
      whale: {
        apiVersion: 1,
        contributions: [{ id: 'widget', type: 'composer.widget', entry: './ui/index.html' }],
      },
    });
    await writeFile(path.join(root, '.mcp.json'), JSON.stringify({
      mcpServers: {
        'fixture-mcp': {
          url: 'https://example.test/mcp',
          bearer_token_env_var: 'FIXTURE_MCP_TOKEN',
        },
      },
    }));
    const descriptor = readPluginUiDescriptor(pluginResponse(root));
    replacePluginUiRegistry([{ descriptor: descriptor!, root }]);

    expect(pluginMcpHttpConnection('fixture-plugin', 'fixture-mcp', {
      FIXTURE_MCP_TOKEN: 'fixture-secret',
    }).headers).toEqual({ Authorization: 'Bearer fixture-secret' });
  });

  it('parses Whale credential contributions and only rejects malformed environment names', async () => {
    const root = await fixtureRoot({
      whale: {
        apiVersion: 1,
        contributions: [
          {
            id: 'fixture-token',
            type: 'credential',
            key: 'fixture/token',
            credentialType: 'bearerToken',
            label: 'Fixture Token',
            description: 'Fixture secret',
            env: 'FIXTURE_MCP_TOKEN',
            required: true,
            scope: 'marketplace',
            usedBy: { mcpServers: ['fixture-mcp'] },
          },
          {
            id: 'unsafe',
            type: 'credential',
            key: 'fixture/unsafe',
            credentialType: 'apiKey',
            label: 'Unsafe',
            env: 'PATH',
            required: true,
            usedBy: { mcpServers: ['fixture-mcp'] },
          },
          {
            id: 'host-prefixed',
            type: 'credential',
            key: 'fixture/host-prefixed',
            credentialType: 'apiKey',
            label: 'Host Prefixed',
            env: 'WHALE_CUSTOM_PROVIDER_API_KEY',
            required: true,
            usedBy: { mcpServers: ['fixture-mcp'] },
          },
        ],
      },
    });

    expect(readPluginCredentialContributions(pluginResponse(root))).toEqual([
      {
        id: 'fixture-token',
        type: 'credential',
        key: 'fixture/token',
        credentialType: 'bearerToken',
        label: 'Fixture Token',
        description: 'Fixture secret',
        env: 'FIXTURE_MCP_TOKEN',
        required: true,
        scope: 'marketplace',
        mcpServers: ['fixture-mcp'],
      },
      {
        id: 'host-prefixed',
        type: 'credential',
        key: 'fixture/host-prefixed',
        credentialType: 'apiKey',
        label: 'Host Prefixed',
        description: '',
        env: 'WHALE_CUSTOM_PROVIDER_API_KEY',
        required: true,
        scope: 'marketplace',
        mcpServers: ['fixture-mcp'],
      },
    ]);
  });

  it('keeps both Xiaojing plugins on one marketplace-scoped AIHub credential', () => {
    const marketplaceRoot = path.resolve('marketplaces/xiaojing/plugins');
    const knowledge = readPluginCredentialContributions(pluginResponse(
      path.join(marketplaceRoot, 'xiaojing-knowledge-base'),
      'xiaojing-knowledge-base',
      'xiaojing-knowledge-base',
    ));
    const outlook = readPluginCredentialContributions(pluginResponse(
      path.join(marketplaceRoot, 'xiaojing-outlook'),
      'xiaojing-outlook',
      'xiaojing-outlook',
    ));

    expect(knowledge).toHaveLength(1);
    expect(outlook).toHaveLength(1);
    expect(knowledge[0]).toMatchObject({
      key: 'aihub/token',
      env: 'AIHUB_MCP_TOKEN',
      scope: 'marketplace',
      mcpServers: ['xiaojing-knowledge-base'],
    });
    expect(outlook[0]).toMatchObject({
      key: knowledge[0].key,
      env: knowledge[0].env,
      scope: knowledge[0].scope,
      mcpServers: ['xiaojing-outlook'],
    });
  });
});

async function fixtureRoot(manifest: Record<string, unknown>): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'whale-plugin-ui-'));
  roots.push(root);
  await mkdir(path.join(root, '.codex-plugin'), { recursive: true });
  await mkdir(path.join(root, 'ui'), { recursive: true });
  await writeFile(path.join(root, '.codex-plugin', 'plugin.json'), JSON.stringify({
    name: 'fixture-plugin',
    mcpServers: './.mcp.json',
    ...manifest,
  }));
  await writeFile(path.join(root, 'ui', 'index.html'), '<!doctype html>');
  return root;
}

function pluginResponse(
  root: string,
  pluginName = 'fixture-plugin',
  mcpServer = 'fixture-mcp',
): PluginReadResponse {
  return {
    plugin: {
      marketplaceName: 'fixture-marketplace',
      marketplacePath: null,
      shareUrl: null,
      description: 'fixture',
      summary: {
        id: pluginName,
        name: pluginName,
        source: { type: 'local', path: root },
        interface: { displayName: 'Fixture Plugin' },
      },
      skills: [],
      hooks: [],
      apps: [],
      appTemplates: [],
      mcpServers: [mcpServer],
      scheduledTasks: null,
    },
  } as unknown as PluginReadResponse;
}
