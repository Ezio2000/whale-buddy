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
});
