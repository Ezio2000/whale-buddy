import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PluginCredentialStore } from '../../src/main/plugin-credential-store';
import type {
  ActivePluginCredential,
  PluginCredentialContribution,
} from '../../src/shared/plugin-credentials';

const roots: string[] = [];

const credential: PluginCredentialContribution = {
  id: 'aihub-token',
  type: 'credential',
  key: 'aihub/token',
  credentialType: 'bearerToken',
  label: 'AIHub Token',
  description: '访问小鲸服务',
  env: 'AIHUB_MCP_TOKEN',
  required: true,
  scope: 'marketplace',
  mcpServers: ['xiaojing-knowledge-base'],
};

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('PluginCredentialStore', () => {
  it('stores and returns plaintext values shared within one marketplace', async () => {
    const root = await temporaryRoot();
    const store = new PluginCredentialStore(root);
    expect(store.missingRequired('xiaojing', [credential])).toEqual([credential]);
    expect(() => store.launchEnvironment([{
      ...credential,
      pluginId: 'xiaojing-knowledge-base',
      marketplaceName: 'xiaojing',
    }])).toThrow('尚未配置');

    store.configure('xiaojing', credential.key, 'secret-value');

    expect(store.values('xiaojing', [credential])[0].value).toBe('secret-value');
    expect(store.values('other-marketplace', [credential])[0].value).toBeNull();
    expect(await readFile(store.filePath, 'utf8')).toContain('secret-value');

    const active: ActivePluginCredential = {
      ...credential,
      pluginId: 'xiaojing-knowledge-base',
      marketplaceName: 'xiaojing',
    };
    expect(store.launchEnvironment([active])).toEqual({
      AIHUB_MCP_TOKEN: 'secret-value',
    });
    expect(new PluginCredentialStore(root).launchEnvironment([active])).toEqual({
      AIHUB_MCP_TOKEN: 'secret-value',
    });
  });

  it('reports conflicting environment bindings', async () => {
    const root = await temporaryRoot();
    const store = new PluginCredentialStore(root);
    store.configure('xiaojing', credential.key, 'first');
    store.configure('other', credential.key, 'second');

    expect(() => store.launchEnvironment([
      { ...credential, pluginId: 'one', marketplaceName: 'xiaojing' },
      { ...credential, pluginId: 'two', marketplaceName: 'other' },
    ])).toThrow('AIHUB_MCP_TOKEN 存在冲突');
    expect(store.resolveLaunchEnvironment([
      { ...credential, pluginId: 'one', marketplaceName: 'xiaojing' },
      { ...credential, pluginId: 'two', marketplaceName: 'other' },
    ])).toEqual({
      environment: {},
      errors: ['插件凭据环境变量 AIHUB_MCP_TOKEN 存在冲突'],
    });
  });

  it('removes orphaned plaintext values', async () => {
    const root = await temporaryRoot();
    const store = new PluginCredentialStore(root);
    store.configure('xiaojing', credential.key, 'secret-value');
    store.prune([]);

    expect(store.has('xiaojing', credential.key)).toBe(false);
    expect(JSON.parse(await readFile(store.filePath, 'utf8'))).toEqual({
      version: 1,
      values: {},
    });
  });
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'whale-plugin-credentials-'));
  roots.push(root);
  return root;
}
