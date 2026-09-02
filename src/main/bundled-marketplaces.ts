import path from 'node:path';
import type { AppServerClient } from './app-server-client';
import type { ExtensionPolicyStore } from './extension-policy';

interface BundledMarketplace {
  name: string;
  directory: string;
  label: string;
}

const BUNDLED_MARKETPLACES: readonly BundledMarketplace[] = [
  { name: 'whale-office', directory: 'office', label: '办公' },
  { name: 'whale-aihub', directory: 'aihub', label: 'AIHub' },
];

export async function ensureBundledMarketplaces(
  client: Pick<AppServerClient, 'request' | 'restart'>,
  policy: ExtensionPolicyStore,
  projectRoot: string,
  resourcesRoot: string,
  packaged: boolean,
): Promise<void> {
  let added = false;
  for (const marketplace of BUNDLED_MARKETPLACES) {
    if (policy.source(marketplace.name)) continue;
    const source = packaged
      ? path.join(resourcesRoot, marketplace.directory)
      : path.join(projectRoot, 'marketplaces', marketplace.directory);
    const response = await client.request('marketplace/add', {
      source,
      refName: null,
      sparsePaths: null,
    }) as { marketplaceName?: unknown };
    if (response.marketplaceName !== marketplace.name) {
      throw new Error(`${marketplace.label}商城清单名称无效`);
    }
    policy.addMarketplace(marketplace.name, source, null, true);
    added = true;
  }
  if (added) await client.restart();
}

