import { stat, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { RuntimeSettingsStore } from '../../src/main/runtime-settings';
import { currentPlatformStrategy } from '../../src/platform';
import type { RuntimeConnectionSettingsInput } from '../../src/shared/types';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('RuntimeSettingsStore', () => {
  it('keeps provider credentials out of public IPC settings and stores them as plaintext', async () => {
    const root = await temporaryRoot();
    const store = new RuntimeSettingsStore(root);
    const secret = 'sk-whale-test-secret';
    const saved = store.configure(
      customInput({
        proxy: {
          mode: 'custom',
          url: 'http://127.0.0.1:7890',
          noProxy: 'localhost,127.0.0.1',
        },
        provider: {
          mode: 'custom',
          id: 'acme_responses',
          name: 'Acme Responses',
          baseUrl: 'https://gateway.example/v1/',
          model: 'acme-code',
          apiKey: secret,
        },
      }),
    );

    expect(saved.provider).toMatchObject({
      mode: 'custom',
      baseUrl: 'https://gateway.example/v1',
      hasApiKey: true,
    });
    expect(JSON.stringify(saved)).not.toContain(secret);
    expect(store.revealProviderApiKey()).toBe(secret);

    const persisted = await readFile(store.filePath, 'utf8');
    expect(persisted).toContain(secret);
    expect(JSON.parse(persisted)).toMatchObject({ version: 4, apiKey: secret });
    if (currentPlatformStrategy().enforcesPrivateMode) {
      expect((await stat(store.filePath)).mode & 0o777).toBe(0o600);
    }

    const launch = store.launchConfiguration({ PATH: '/usr/bin', HTTP_PROXY: 'old' });
    expect(launch.environment.WHALE_CUSTOM_PROVIDER_API_KEY).toBe(secret);
    expect(launch.environment.HTTP_PROXY).toBe('http://127.0.0.1:7890');
    expect(launch.environment.HTTPS_PROXY).toBe('http://127.0.0.1:7890');
    expect(launch.environment.NO_PROXY).toBe('localhost,127.0.0.1');
    expect(launch.configOverrides).toContain('model_provider="acme_responses"');
    expect(launch.configOverrides).toContain(
      'model_providers.acme_responses.wire_api="responses"',
    );
    expect(launch.configOverrides.some((value) => value.startsWith('model_catalog_json='))).toBe(
      false,
    );
    expect(JSON.stringify(launch.configOverrides)).not.toContain(secret);

    const reloaded = new RuntimeSettingsStore(root);
    expect(reloaded.read().provider.hasApiKey).toBe(true);
    expect(reloaded.revealProviderApiKey()).toBe(secret);
    expect(reloaded.launchConfiguration({}).environment.WHALE_CUSTOM_PROVIDER_API_KEY).toBe(secret);
  });

  it('removes legacy credential provenance while preserving a plaintext key', async () => {
    const root = await temporaryRoot();
    const secret = 'legacy-provider-secret';
    const settingsPath = path.join(root, 'runtime-settings.json');
    await writeFile(
      settingsPath,
      JSON.stringify({
        version: 1,
        proxy: { mode: 'inherit', url: '', noProxy: 'localhost,127.0.0.1,::1' },
        provider: {
          mode: 'custom',
          id: 'minimax_token_plan',
          name: 'MiniMax',
          baseUrl: 'https://api.minimaxi.com/v1',
          model: 'MiniMax-M3',
          credentialSource: 'legacy-import',
        },
        apiKey: secret,
      }),
      { mode: 0o600 },
    );

    const store = new RuntimeSettingsStore(root);
    expect(store.revealProviderApiKey()).toBe(secret);
    const migrated = await readFile(settingsPath, 'utf8');
    expect(migrated).not.toContain('credentialSource');
    expect(JSON.parse(migrated)).toMatchObject({ version: 4, apiKey: secret });
  });

  it('can explicitly remove inherited proxy variables', async () => {
    const root = await temporaryRoot();
    const store = new RuntimeSettingsStore(root);
    store.configure(
      customInput({
        proxy: { mode: 'off', url: '', noProxy: '' },
      }),
    );
    const launch = store.launchConfiguration({
      HTTP_PROXY: 'http://proxy.example',
      https_proxy: 'http://proxy.example',
      NO_PROXY: 'localhost',
      PATH: '/usr/bin',
    });
    expect(launch.environment).toMatchObject({
      PATH: '/usr/bin',
      WHALE_CUSTOM_PROVIDER_API_KEY: 'test-provider-key',
    });
    expect(launch.environment.HTTP_PROXY).toBeUndefined();
    expect(launch.environment.https_proxy).toBeUndefined();
    expect(launch.environment.NO_PROXY).toBeUndefined();
    expect(launch.configOverrides).toContain('model_provider="custom"');
  });

  it('applies the MiniMax Responses context preset from manual settings', async () => {
    const root = await temporaryRoot();
    const secret = 'minimax-token-plan-test-secret';
    const store = new RuntimeSettingsStore(root);
    const saved = store.configure(
      customInput({
        provider: {
          id: 'minimax_token_plan',
          name: 'MiniMax',
          baseUrl: 'https://api.minimaxi.com/v1',
          model: 'MiniMax-M3',
          apiKey: secret,
        },
      }),
    );
    expect(saved.provider).toMatchObject({
      mode: 'custom',
      id: 'minimax_token_plan',
      baseUrl: 'https://api.minimaxi.com/v1',
      model: 'MiniMax-M3',
      hasApiKey: true,
    });
    const launch = store.launchConfiguration({});
    expect(launch.environment.WHALE_CUSTOM_PROVIDER_API_KEY).toBe(secret);
    expect(launch.configOverrides).toContain('model_context_window=1000000');
    expect(launch.configOverrides).toContain(
      `model_catalog_json=${JSON.stringify(store.minimaxModelCatalogPath)}`,
    );
    expect(launch.configOverrides).toContain('model_supports_reasoning_summaries=true');

    const catalog = JSON.parse(await readFile(store.minimaxModelCatalogPath, 'utf8'));
    expect(catalog).toMatchObject({
      models: [
        {
          slug: 'MiniMax-M3',
          default_reasoning_level: 'high',
          context_window: 1_000_000,
          input_modalities: ['text', 'image'],
        },
      ],
    });
    if (currentPlatformStrategy().enforcesPrivateMode) {
      expect((await stat(store.minimaxModelCatalogPath)).mode & 0o777).toBe(0o600);
    }
  });

  it('rejects an Anthropic URL and an endpoint URL that already includes /responses', async () => {
    const root = await temporaryRoot();
    const store = new RuntimeSettingsStore(root);
    expect(() =>
      store.configure(
        customInput({
          provider: {
            mode: 'custom',
            baseUrl: 'https://api.minimaxi.com/anthropic',
          },
        }),
      ),
    ).toThrow('Anthropic Base URL');
    expect(() =>
      store.configure(
        customInput({
          provider: {
            mode: 'custom',
            baseUrl: 'https://gateway.example/v1/responses',
          },
        }),
      ),
    ).toThrow('不要包含末尾的 /responses');
  });

  it('stores configurable branding and exposes a renderable local icon URL', async () => {
    const root = await temporaryRoot();
    const iconPath = path.join(root, 'custom-brand.png');
    await writeFile(iconPath, 'fixture image');
    const store = new RuntimeSettingsStore(root);

    expect(store.readBranding()).toEqual({
      name: 'AI小鲸',
      iconPath: '',
      iconUrl: null,
    });

    const branding = store.configureBranding({ name: '研发助手', iconPath });
    expect(branding).toMatchObject({ name: '研发助手', iconPath });
    expect(branding.iconUrl).toBe(new URL(`file://${iconPath}`).href);
    expect(JSON.parse(await readFile(store.filePath, 'utf8'))).toMatchObject({
      version: 4,
      brand: { name: '研发助手', iconPath },
    });

    expect(new RuntimeSettingsStore(root).readBranding()).toEqual(branding);
    expect(() => store.configureBranding({ name: '无效', iconPath: 'relative.png' })).toThrow(
      '图标必须使用绝对路径',
    );
  });
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'whale-runtime-settings-'));
  roots.push(root);
  return root;
}

function customInput(
  patch: {
    proxy?: Partial<RuntimeConnectionSettingsInput['proxy']>;
    provider?: Partial<RuntimeConnectionSettingsInput['provider']>;
  } = {},
): RuntimeConnectionSettingsInput {
  return {
    proxy: {
      mode: 'inherit',
      url: '',
      noProxy: 'localhost,127.0.0.1,::1',
      ...patch.proxy,
    },
    provider: {
      mode: 'custom',
      id: 'custom',
      name: 'Custom Responses',
      baseUrl: 'https://gateway.example/v1',
      model: 'custom-model',
      apiKey: 'test-provider-key',
      ...patch.provider,
    },
  };
}
