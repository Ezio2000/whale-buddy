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
