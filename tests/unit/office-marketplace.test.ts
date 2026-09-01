import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('bundled office marketplace', () => {
  it('uses Codex-supported installation and authentication policy values', async () => {
    const root = path.resolve('marketplaces/office');
    const manifest = JSON.parse(
      await readFile(path.join(root, '.agents/plugins/marketplace.json'), 'utf8'),
    ) as { name: string; plugins: Array<{ name: string; policy: { installation: string; authentication: string } }> };

    expect(manifest.name).toBe('whale-office');
    expect(manifest.plugins).toHaveLength(1);
    expect(manifest.plugins[0]).toMatchObject({
      name: 'whale-office-assistant',
      policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
    });
  });

  it('declares both object and column-aligned array rows for Excel staging', async () => {
    const plugin = JSON.parse(
      await readFile(path.resolve('marketplaces/office/plugins/whale-office-assistant/.codex-plugin/plugin.json'), 'utf8'),
    ) as { whale: { webMcp: { tools: Array<{ inputSchema: { properties: Record<string, unknown> } }> } } };
    const properties = plugin.whale.webMcp.tools[0].inputSchema.properties as {
      sheetName?: { type: string };
      rows: { items: { anyOf: Array<{ type: string }> } };
    };

    expect(properties.sheetName?.type).toBe('string');
    expect(properties.rows.items.anyOf.map((variant) => variant.type)).toEqual(['object', 'array']);
  });
});
