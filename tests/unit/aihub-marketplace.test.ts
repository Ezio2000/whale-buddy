import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
const root = path.resolve('marketplaces/aihub');
const pluginRoot = path.join(root, 'plugins/xiaojing-knowledge-base');
const json = async (file: string) => JSON.parse(await readFile(file, 'utf8'));
describe('unified AIHub marketplace', () => {
  it('publishes one plugin with one unrestricted connection and the existing credential key', async () => {
    const catalog = await json(path.join(root, '.agents/plugins/marketplace.json'));
    expect(catalog.plugins.map((p: { name: string }) => p.name)).toEqual(['xiaojing-knowledge-base']);
    const manifest = await json(path.join(pluginRoot, '.codex-plugin/plugin.json'));
    expect(manifest.interface.displayName).toBe('小鲸 AIHub');
    expect(manifest.whale.credentials).toHaveLength(1);
    expect(manifest.whale.credentials[0]).toMatchObject({ key: 'aihub/token', env: 'AIHUB_MCP_TOKEN', usedBy: { mcpServers: ['xiaojing-knowledge-base'] } });
    const mcp = await json(path.join(pluginRoot, '.mcp.json'));
    expect(Object.keys(mcp.mcpServers)).toEqual(['xiaojing-knowledge-base']);
    expect(mcp.mcpServers['xiaojing-knowledge-base'].enabled_tools).toBeUndefined();
    expect(mcp.mcpServers['xiaojing-knowledge-base'].disabled_tools).toBeUndefined();
  });
  it('omits sidebar pages while preserving both result cards in the unified plugin', async () => {
    const manifest = await json(path.join(pluginRoot, '.codex-plugin/plugin.json'));
    const ui = manifest.whale.uiContributions;
    expect(ui.filter((x: { type: string }) => x.type === 'page').map((x: { id: string }) => x.id)).toEqual([]);
    for (const card of ui.filter((x: { type: string }) => x.type === 'card')) {
      expect(card.match.server).toBe('xiaojing-knowledge-base');
      expect(card.entry).toBe('./ui/index.html');
    }
    expect(ui.find((x: { id: string }) => x.id === 'knowledge-message-card').match.tools).toContain('gac_kb_search_scoped');
    expect(ui.find((x: { id: string }) => x.id === 'outlook-message-card').match.tools).toContain('outlook_mail_action_cancel');
    expect(manifest.whale.permissions.mcp.find((x: { principal: string }) => x.principal === 'webMcp:set-knowledge-scope').tools).toEqual(['gac_kb_search_scoped']);
  });
  it('preserves email confirmation and injects explicitly scoped search', async () => {
    expect(await readFile(path.join(pluginRoot, 'ui-src/src/main.tsx'), 'utf8')).toContain("name: 'gac_kb_search_scoped'");
    const skill = await readFile(path.join(pluginRoot, 'skills/outlook-assistant/SKILL.md'), 'utf8');
    expect(skill).toContain('`xiaojing-knowledge-base` MCP');
    expect(skill).toContain('explicitly approve that exact preview');
    expect(skill).toContain('outlook_mail_action_cancel');
  });
});
