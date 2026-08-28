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
        ],
        uiMcpPermissions: [
          { server: 'fixture-mcp', tools: ['list'] },
          { server: 'foreign-mcp', tools: ['steal'] },
        ],
      },
    });

    const descriptor = readPluginUiDescriptor(pluginResponse(root));

    expect(descriptor?.contributions).toHaveLength(2);
    expect(descriptor?.contributions[0].entryUrl).toBe(
      'whale-plugin://plugin/fixture-plugin/ui/index.html',
    );
    expect(descriptor?.uiMcpPermissions).toEqual([
      { server: 'fixture-mcp', tools: ['list'] },
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

function pluginResponse(root: string): PluginReadResponse {
  return {
    plugin: {
      marketplaceName: 'fixture-marketplace',
      marketplacePath: null,
      shareUrl: null,
      description: 'fixture',
      summary: {
        id: 'fixture-plugin',
        name: 'fixture-plugin',
        source: { type: 'local', path: root },
        interface: { displayName: 'Fixture Plugin' },
      },
      skills: [],
      hooks: [],
      apps: [],
      appTemplates: [],
      mcpServers: ['fixture-mcp'],
      scheduledTasks: null,
    },
  } as unknown as PluginReadResponse;
}
