import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('bundled AIHub marketplace', () => {
  it('publishes knowledge base and Outlook as separate plugins', async () => {
    const root = path.resolve('marketplaces/aihub');
    const manifest = JSON.parse(
      await readFile(path.join(root, '.agents/plugins/marketplace.json'), 'utf8'),
    ) as {
      name: string;
      interface: { displayName: string };
      plugins: Array<{ name: string; policy: { installation: string; authentication: string } }>;
    };

    expect(manifest).toMatchObject({
      name: 'whale-aihub',
      interface: { displayName: 'Whale AIHub' },
    });
    expect(manifest.plugins).toEqual([
      expect.objectContaining({
        name: 'xiaojing-knowledge-base',
        policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
      }),
      expect.objectContaining({
        name: 'xiaojing-outlook',
        policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
      }),
    ]);
  });

  it('shares one AIHub credential and keeps MCP servers isolated', async () => {
    const pluginsRoot = path.resolve('marketplaces/aihub/plugins');
    const manifests = await Promise.all(['xiaojing-knowledge-base', 'xiaojing-outlook'].map(async (name) => JSON.parse(
      await readFile(path.join(pluginsRoot, name, '.codex-plugin/plugin.json'), 'utf8'),
    ) as { whale: { credentials: Array<{ key: string; env: string; usedBy: { mcpServers: string[] } }> } }));

    expect(manifests.map((manifest) => manifest.whale.credentials[0].key)).toEqual([
      'aihub/token', 'aihub/token',
    ]);
    expect(manifests.map((manifest) => manifest.whale.credentials[0].env)).toEqual([
      'AIHUB_MCP_TOKEN', 'AIHUB_MCP_TOKEN',
    ]);
    expect(manifests.map((manifest) => manifest.whale.credentials[0].usedBy.mcpServers)).toEqual([
      ['xiaojing-knowledge-base'], ['xiaojing-outlook'],
    ]);
  });

  it('declares Outlook navigation, command, and message-card surfaces', async () => {
    const manifest = JSON.parse(await readFile(path.resolve(
      'marketplaces/aihub/plugins/xiaojing-outlook/.codex-plugin/plugin.json',
    ), 'utf8')) as {
      whale: {
        uiContributions: Array<{
          id: string;
          type: string;
          placement: string;
          match?: { server: string; tools: string[] };
        }>;
      };
    };

    expect(manifest.whale.uiContributions.map(({ type, placement }) => ({ type, placement }))).toEqual([
      { type: 'page', placement: 'navigation' },
      { type: 'action', placement: 'commandPalette' },
      { type: 'card', placement: 'message' },
    ]);
    expect(manifest.whale.uiContributions[2].match).toMatchObject({
      server: 'xiaojing-outlook',
      tools: expect.arrayContaining([
        'outlook_calendar_search',
        'outlook_mail_search',
        'outlook_mail_send_preview',
        'outlook_mail_send',
      ]),
    });
  });
});
