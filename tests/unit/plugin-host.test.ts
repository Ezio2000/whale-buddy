import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { PluginReadResponse } from '../../src/generated/protocol/typescript/v2/PluginReadResponse';
import {
  assertPluginMcpPermission,
  pluginDynamicTools,
  pluginMcpHttpConnection,
  readPluginDescriptor,
  replacePluginRegistry,
} from '../../src/main/plugin-host';
import { readPluginCredentials } from '../../src/main/plugin-credential-manifest';

const roots: string[] = [];
afterEach(async () => {
  replacePluginRegistry([]);
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('plugin host v2 manifest', () => {
  it('parses UI, WebMCP, permissions, and exports Codex dynamic tools', async () => {
    const root = await fixtureRoot({
      whale: {
        apiVersion: 2,
        uiContributions: [
          { id: 'widget', type: 'widget', placement: 'composer', entry: './ui/index.html', order: 7 },
          { id: 'page', type: 'page', placement: 'navigation', entry: './ui/index.html', title: 'Fixture' },
          { id: 'action', type: 'action', placement: 'commandPalette', entry: './ui/index.html', title: 'Run', keywords: ['fixture'] },
          { id: 'details', type: 'panel', placement: 'turnDetails', entry: './ui/index.html', title: 'Fixture Changes' },
          { id: 'card', type: 'card', placement: 'message', entry: './ui/index.html', title: 'Result', match: { itemTypes: ['mcpToolCall'], server: 'fixture-mcp', tools: ['inspect'] } },
        ],
        webMcp: {
          entry: './ui/index.html',
          tools: [{
            id: 'list', name: 'fixture_list', title: 'List fixtures', description: 'List fixtures.',
            scope: 'project', inputSchema: { type: 'object' },
            annotations: { readOnlyHint: true, untrustedContentHint: false },
          }],
        },
        permissions: { mcp: [
          { principal: 'webMcp:list', server: 'fixture-mcp', tools: ['inspect'] },
          { principal: 'ui:*', server: 'foreign-mcp', tools: ['steal'] },
        ] },
      },
    });
    const descriptor = readPluginDescriptor(pluginResponse(root));
    expect(descriptor?.apiVersion).toBe(2);
    expect(descriptor?.uiContributions).toHaveLength(5);
    expect(descriptor?.uiContributions[3]).toMatchObject({ type: 'panel', placement: 'turnDetails', title: 'Fixture Changes' });
    expect(descriptor?.uiContributions[0].entryUrl).toBe('whale-plugin://plugin/fixture-plugin/ui/index.html');
    expect(descriptor?.webMcp?.tools[0]).toMatchObject({ id: 'list', name: 'fixture_list', scope: 'project' });
    expect(descriptor?.mcpPermissions).toEqual([
      { principal: 'webMcp:list', server: 'fixture-mcp', tools: ['inspect'] },
    ]);
    replacePluginRegistry([{ descriptor: descriptor!, root }]);
    expect(pluginDynamicTools()).toEqual([
      expect.objectContaining({ type: 'function', name: 'fixture_list', deferLoading: false }),
    ]);
    expect(() => assertPluginMcpPermission('fixture-plugin', 'webMcp:list', 'fixture-mcp', 'inspect')).not.toThrow();
    expect(() => assertPluginMcpPermission('fixture-plugin', 'ui:widget', 'fixture-mcp', 'inspect')).toThrow(/未获准/);
  });

  it('rejects v1 and entries that escape the plugin root', async () => {
    const v1 = await fixtureRoot({ whale: { apiVersion: 1, uiContributions: [{ id: 'widget', type: 'widget', placement: 'composer', entry: './ui/index.html' }] } });
    expect(readPluginDescriptor(pluginResponse(v1))).toBeNull();
    const escaped = await fixtureRoot({ whale: { apiVersion: 2, uiContributions: [{ id: 'widget', type: 'widget', placement: 'composer', entry: '../outside.html' }] } });
    expect(readPluginDescriptor(pluginResponse(escaped))).toBeNull();
  });

  it('rejects globally duplicated WebMCP tool names', async () => {
    const first = await webMcpFixture('first-plugin', 'duplicate_tool');
    const second = await webMcpFixture('second-plugin', 'duplicate_tool');
    expect(() => replacePluginRegistry([first, second])).toThrow(/名称重复/);
  });

  it('isolates WebMCP tools that the Codex dynamic-tool protocol cannot accept', async () => {
    for (const [name, inputSchema] of [
      ['lookup.ticket', { type: 'object' }],
      ['mcp', { type: 'object' }],
      ['mcp__fixture__lookup', { type: 'object' }],
      ['fixture_null', { type: 'null' }],
      ['fixture_bad_nested', { type: 'object', properties: { value: { type: 'wat' } } }],
    ] as const) {
      const root = await webMcpRoot('invalid-plugin', name, inputSchema);
      expect(readPluginDescriptor(pluginResponse(root, 'invalid-plugin'))?.webMcp ?? null).toBeNull();
    }
  });

  it('resolves HTTP MCP configuration and bearer credentials in the host', async () => {
    const root = await webMcpRoot('fixture-plugin', 'fixture_tool');
    await writeFile(path.join(root, '.mcp.json'), JSON.stringify({ mcpServers: {
      'fixture-mcp': { url: 'https://example.test/mcp', bearer_token_env_var: 'FIXTURE_MCP_TOKEN', tool_timeout_sec: 12 },
    } }));
    const descriptor = readPluginDescriptor(pluginResponse(root));
    replacePluginRegistry([{ descriptor: descriptor!, root }]);
    expect(pluginMcpHttpConnection('fixture-plugin', 'fixture-mcp', { FIXTURE_MCP_TOKEN: 'secret' })).toEqual({
      url: 'https://example.test/mcp', headers: { Authorization: 'Bearer secret' }, timeoutMs: 12_000,
    });
  });

  it('reads one credential and both surfaces from the unified AIHub plugin', () => {
    const marketplaceRoot = path.resolve('marketplaces/aihub/plugins');
    const knowledge = readPluginCredentials(pluginResponse(path.join(marketplaceRoot, 'xiaojing-knowledge-base'), 'xiaojing-knowledge-base', 'xiaojing-knowledge-base'));
    expect(knowledge).toHaveLength(1);
    const descriptor = readPluginDescriptor(pluginResponse(
      path.join(marketplaceRoot, 'xiaojing-knowledge-base'),
      'xiaojing-knowledge-base',
      'xiaojing-knowledge-base',
    ));
    expect(descriptor?.uiContributions.map((entry) => entry.type)).toEqual([
      'action', 'action', 'action', 'card', 'action', 'card',
    ]);
    expect(descriptor?.webMcp?.tools.map((tool) => tool.name)).toEqual([
      'xiaojing_list_knowledge_bases',
      'xiaojing_set_knowledge_scope',
      'xiaojing_clear_knowledge_scope',
    ]);
    expect(knowledge[0]).toMatchObject({ key: 'aihub/token', env: 'AIHUB_MCP_TOKEN', scope: 'marketplace', mcpServers: ['xiaojing-knowledge-base'] });
  });
});

async function webMcpFixture(pluginName: string, toolName: string) {
  const root = await webMcpRoot(pluginName, toolName);
  return { descriptor: readPluginDescriptor(pluginResponse(root, pluginName))!, root };
}
async function webMcpRoot(pluginName: string, toolName: string, inputSchema: Record<string, unknown> = { type: 'object' }) {
  return fixtureRoot({ name: pluginName, whale: { apiVersion: 2, webMcp: {
    entry: './ui/index.html', tools: [{ id: 'tool', name: toolName, description: 'Fixture tool.', scope: 'global', inputSchema }],
  } } });
}
async function fixtureRoot(manifest: Record<string, unknown>): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'whale-plugin-host-'));
  roots.push(root);
  await mkdir(path.join(root, '.codex-plugin'), { recursive: true });
  await mkdir(path.join(root, 'ui'), { recursive: true });
  await writeFile(path.join(root, '.codex-plugin', 'plugin.json'), JSON.stringify({ name: 'fixture-plugin', mcpServers: './.mcp.json', ...manifest }));
  await writeFile(path.join(root, 'ui', 'index.html'), '<!doctype html>');
  return root;
}
function pluginResponse(root: string, pluginName = 'fixture-plugin', mcpServer = 'fixture-mcp'): PluginReadResponse {
  return { plugin: {
    marketplaceName: 'fixture-marketplace', marketplacePath: null, shareUrl: null, description: 'fixture',
    summary: { id: pluginName, name: pluginName, source: { type: 'local', path: root }, interface: { displayName: 'Fixture Plugin' } },
    skills: [], hooks: [], apps: [], appTemplates: [], mcpServers: [mcpServer], scheduledTasks: null,
  } } as unknown as PluginReadResponse;
}
