import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import {
  hardenPrivateFile,
  PRIVATE_DIRECTORY_MODE,
  PRIVATE_FILE_MODE,
} from './filesystem-security';
import { pathToFileURL } from 'node:url';
import type {
  RuntimeBrandingSettings,
  RuntimeBrandingSettingsInput,
  RuntimeConnectionSettings,
  RuntimeConnectionSettingsInput,
  RuntimeModelCapabilities,
  RuntimeProviderMode,
  RuntimeProxyMode,
  RuntimeReasoningEffort,
} from '../shared/types';
import {
  defaultRuntimeModelCapabilities,
  runtimeModelCatalogJson,
} from './model-catalog';

const SETTINGS_VERSION = 5;
const SETTINGS_FILE = 'runtime-settings.json';
const PROVIDER_API_KEY_ENV = 'WHALE_CUSTOM_PROVIDER_API_KEY';
const MODEL_CATALOGS_DIRECTORY = 'model-catalogs';
const RUNTIME_MODEL_CATALOG_FILE = 'runtime-model.json';
const PROXY_ENV_KEYS = [
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'all_proxy',
  'no_proxy',
] as const;

export interface RuntimeLaunchConfiguration {
  environment: NodeJS.ProcessEnv;
  configOverrides: string[];
}

interface StoredSettings {
  version: number;
  brand: {
    name: string;
    iconPath: string;
  };
  proxy: {
    mode: RuntimeProxyMode;
    url: string;
    noProxy: string;
  };
  provider: {
    mode: RuntimeProviderMode;
    id: string;
    name: string;
    baseUrl: string;
    model: string;
    capabilities: RuntimeModelCapabilities;
  };
  apiKey: string;
}

const DEFAULT_SETTINGS: StoredSettings = {
  version: SETTINGS_VERSION,
  brand: {
    name: 'AI小鲸',
    iconPath: '',
  },
  proxy: {
    mode: 'inherit',
    url: '',
    noProxy: 'localhost,127.0.0.1,::1',
  },
  provider: {
    mode: 'custom',
    id: 'custom',
    name: 'Custom Responses',
    baseUrl: '',
    model: '',
    capabilities: defaultRuntimeModelCapabilities({ id: 'custom', baseUrl: '', model: '' }),
  },
  apiKey: '',
};

export class RuntimeSettingsStore {
  readonly filePath: string;
  readonly modelCatalogPath: string;
  private settings: StoredSettings;
  private shouldPersistAfterLoad = false;

  constructor(uiStateRoot: string) {
    this.filePath = path.join(uiStateRoot, SETTINGS_FILE);
    this.settings = this.load();
    this.modelCatalogPath = writeRuntimeModelCatalog(uiStateRoot, this.settings.provider);
    if (this.shouldPersistAfterLoad) this.persist();
  }

  read(): RuntimeConnectionSettings {
    return this.publicSettings();
  }

  readBranding(): RuntimeBrandingSettings {
    const iconPath = this.settings.brand.iconPath;
    return {
      ...this.settings.brand,
      iconUrl: iconPath && existsSync(iconPath) ? pathToFileURL(iconPath).href : null,
    };
  }

  configureBranding(input: RuntimeBrandingSettingsInput): RuntimeBrandingSettings {
    const name = input.name.trim();
    const iconPath = input.iconPath.trim();
    if (!name) throw new Error('应用名称不能为空');
    if (name.length > 64) throw new Error('应用名称不能超过 64 个字符');
    if (iconPath) validateBrandIcon(iconPath);
    this.settings = {
      ...this.settings,
      version: SETTINGS_VERSION,
      brand: { name, iconPath },
    };
    this.persist();
    return this.readBranding();
  }

  revealProviderApiKey(): string | null {
    return this.settings.apiKey || null;
  }

  configure(input: RuntimeConnectionSettingsInput): RuntimeConnectionSettings {
    const proxy = {
      mode: input.proxy.mode,
      url: input.proxy.url.trim(),
      noProxy: input.proxy.noProxy.trim(),
    };
    const provider = {
      mode: input.provider.mode,
      id: input.provider.id.trim(),
      name: input.provider.name.trim(),
      baseUrl: normalizeBaseUrl(input.provider.baseUrl),
      model: input.provider.model.trim(),
      capabilities: configuredModelCapabilities(input.provider.capabilities),
    } satisfies StoredSettings['provider'];

    validateResponsesBaseUrl(provider.baseUrl);
    if (!provider.name) throw new Error('Provider 名称不能为空');
    if (!provider.model) throw new Error('模型名称不能为空');

    const apiKey = input.provider.apiKey?.trim() || this.settings.apiKey;
    if (!apiKey) throw new Error('Provider API Key 不能为空');

    this.settings = {
      ...this.settings,
      version: SETTINGS_VERSION,
      proxy,
      provider,
      apiKey,
    };
    writeRuntimeModelCatalog(path.dirname(this.filePath), provider);
    this.persist();
    return this.publicSettings();
  }

  launchConfiguration(baseEnvironment: NodeJS.ProcessEnv = process.env): RuntimeLaunchConfiguration {
    const environment: NodeJS.ProcessEnv = { ...baseEnvironment };
    delete environment[PROVIDER_API_KEY_ENV];

    if (this.settings.proxy.mode === 'off') {
      for (const key of PROXY_ENV_KEYS) delete environment[key];
    } else if (this.settings.proxy.mode === 'custom') {
      const proxyUrl = this.settings.proxy.url;
      environment.HTTP_PROXY = proxyUrl;
      environment.HTTPS_PROXY = proxyUrl;
      environment.ALL_PROXY = proxyUrl;
      environment.http_proxy = proxyUrl;
      environment.https_proxy = proxyUrl;
      environment.all_proxy = proxyUrl;
      if (this.settings.proxy.noProxy) {
        environment.NO_PROXY = this.settings.proxy.noProxy;
        environment.no_proxy = this.settings.proxy.noProxy;
      } else {
        delete environment.NO_PROXY;
        delete environment.no_proxy;
      }
    }

    const configOverrides: string[] = [];
    if (this.providerConfigured()) {
      const provider = this.settings.provider;
      const apiKey = this.settings.apiKey;
      if (apiKey) environment[PROVIDER_API_KEY_ENV] = apiKey;
      configOverrides.push(
        configString('model_provider', provider.id),
        configString('model', provider.model),
        configString(`model_providers.${provider.id}.name`, provider.name),
        configString(`model_providers.${provider.id}.base_url`, provider.baseUrl),
        configString(`model_providers.${provider.id}.wire_api`, 'responses'),
        `model_providers.${provider.id}.requires_openai_auth=false`,
        `model_providers.${provider.id}.supports_websockets=false`,
        `model_providers.${provider.id}.request_max_retries=2`,
        `model_providers.${provider.id}.stream_max_retries=2`,
        `model_providers.${provider.id}.stream_idle_timeout_ms=300000`,
        `model_context_window=${provider.capabilities.contextWindow}`,
        configString('model_catalog_json', this.modelCatalogPath),
      );
      if (apiKey) {
        configOverrides.push(
          configString(`model_providers.${provider.id}.env_key`, PROVIDER_API_KEY_ENV),
        );
      }
    }

    return { environment, configOverrides };
  }

  private publicSettings(): RuntimeConnectionSettings {
    return {
      proxy: { ...this.settings.proxy },
      provider: {
        ...this.settings.provider,
        hasApiKey: Boolean(this.settings.apiKey),
      },
    };
  }

  private providerConfigured(): boolean {
    const provider = this.settings.provider;
    return Boolean(provider.id && provider.name && provider.baseUrl && provider.model && this.settings.apiKey);
  }

  private load(): StoredSettings {
    if (!existsSync(this.filePath)) return structuredClone(DEFAULT_SETTINGS);
    try {
      const raw = JSON.parse(readFileSync(this.filePath, 'utf8')) as Record<string, unknown>;
      const proxy = record(raw.proxy);
      const provider = record(raw.provider);
      const brand = record(raw.brand);
      this.shouldPersistAfterLoad =
        raw.version !== SETTINGS_VERSION ||
        Boolean(provider && Object.hasOwn(provider, 'credentialSource')) ||
        Object.hasOwn(raw, 'encryptedApiKey');
      const mode = proxyMode(proxy?.mode);
      const providerModeValue = providerMode(provider?.mode);
      const loadedProvider = {
        mode: providerModeValue,
        id: safeProviderId(provider?.id),
        name: stringValue(provider?.name) || DEFAULT_SETTINGS.provider.name,
        baseUrl: normalizeBaseUrl(stringValue(provider?.baseUrl)),
        model: stringValue(provider?.model),
      };
      const loaded: StoredSettings = {
        version: SETTINGS_VERSION,
        brand: {
          name: stringValue(brand?.name).trim() || DEFAULT_SETTINGS.brand.name,
          iconPath: stringValue(brand?.iconPath).trim(),
        },
        proxy: {
          mode,
          url: stringValue(proxy?.url),
          noProxy: stringValue(proxy?.noProxy) || DEFAULT_SETTINGS.proxy.noProxy,
        },
        provider: {
          ...loadedProvider,
          capabilities: loadedModelCapabilities(provider?.capabilities, loadedProvider),
        },
        apiKey: stringValue(raw.apiKey).trim(),
      };
      if (loaded.provider.baseUrl) validateResponsesBaseUrl(loaded.provider.baseUrl);
      hardenPrivateFile(this.filePath);
      return loaded;
    } catch {
      return structuredClone(DEFAULT_SETTINGS);
    }
  }

  private persist(): void {
    const temporaryPath = `${this.filePath}.tmp-${process.pid}`;
    writeFileSync(temporaryPath, `${JSON.stringify(this.settings, null, 2)}\n`, {
      encoding: 'utf8',
      mode: PRIVATE_FILE_MODE,
    });
    renameSync(temporaryPath, this.filePath);
    hardenPrivateFile(this.filePath);
  }
}

function writeRuntimeModelCatalog(
  uiStateRoot: string,
  provider: StoredSettings['provider'],
): string {
  const catalogsDirectory = path.join(uiStateRoot, MODEL_CATALOGS_DIRECTORY);
  const catalogPath = path.join(catalogsDirectory, RUNTIME_MODEL_CATALOG_FILE);
  const catalogJson = runtimeModelCatalogJson(provider);
  mkdirSync(catalogsDirectory, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });

  if (existsSync(catalogPath) && readFileSync(catalogPath, 'utf8') === catalogJson) {
    hardenPrivateFile(catalogPath);
    return catalogPath;
  }

  const temporaryPath = `${catalogPath}.tmp-${process.pid}`;
  writeFileSync(temporaryPath, catalogJson, {
    encoding: 'utf8',
    mode: PRIVATE_FILE_MODE,
  });
  renameSync(temporaryPath, catalogPath);
  hardenPrivateFile(catalogPath);
  return catalogPath;
}

function configString(key: string, value: string): string {
  return `${key}=${JSON.stringify(value)}`;
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

function validateResponsesBaseUrl(value: string): void {
  if (!value) throw new Error('自定义 Provider 需要填写 Responses Base URL');
  const url = new URL(value);
  if (url.pathname.replace(/\/+$/, '').endsWith('/anthropic')) {
    throw new Error('Anthropic Base URL 不能直接用于 Codex；请填写实现 /responses 的兼容网关地址');
  }
  if (url.pathname.replace(/\/+$/, '').endsWith('/responses')) {
    throw new Error('请填写 Base URL（例如以 /v1 结尾），不要包含末尾的 /responses');
  }
}

function validateBrandIcon(value: string): void {
  if (!path.isAbsolute(value)) throw new Error('图标必须使用绝对路径');
  if (!existsSync(value) || !statSync(value).isFile()) throw new Error('找不到所选图标文件');
  if (!['.png', '.jpg', '.jpeg', '.webp'].includes(path.extname(value).toLowerCase())) {
    throw new Error('图标仅支持 PNG、JPG 或 WebP');
  }
}

function proxyMode(value: unknown): RuntimeProxyMode {
  return value === 'off' || value === 'custom' ? value : 'inherit';
}

function providerMode(_value: unknown): RuntimeProviderMode {
  return 'custom';
}

function safeProviderId(value: unknown): string {
  const candidate = stringValue(value);
  return /^[a-z][a-z0-9_-]*$/.test(candidate) ? candidate : DEFAULT_SETTINGS.provider.id;
}

function configuredModelCapabilities(value: RuntimeModelCapabilities): RuntimeModelCapabilities {
  if (!Number.isInteger(value.contextWindow) || value.contextWindow < 1_024 || value.contextWindow > 10_000_000) {
    throw new Error('上下文窗口必须是 1,024 到 10,000,000 之间的整数');
  }
  const reasoningEfforts = uniqueReasoningEfforts(value.reasoningEfforts);
  if (!reasoningEfforts.length) throw new Error('至少需要保留一个推理档位');
  if (!reasoningEfforts.includes(value.defaultReasoningEffort)) {
    throw new Error('默认推理档位必须包含在支持档位中');
  }
  return {
    contextWindow: value.contextWindow,
    imageInput: value.imageInput,
    supportsReasoning: value.supportsReasoning,
    reasoningEfforts,
    defaultReasoningEffort: value.defaultReasoningEffort,
    supportsReasoningSummaries: value.supportsReasoningSummaries,
  };
}

function loadedModelCapabilities(
  value: unknown,
  provider: Pick<StoredSettings['provider'], 'id' | 'baseUrl' | 'model'>,
): RuntimeModelCapabilities {
  const fallback = defaultRuntimeModelCapabilities(provider);
  const capabilities = record(value);
  if (!capabilities) return fallback;
  try {
    return configuredModelCapabilities({
      contextWindow: numberValue(capabilities.contextWindow, fallback.contextWindow),
      imageInput: booleanValue(capabilities.imageInput, fallback.imageInput),
      supportsReasoning: booleanValue(capabilities.supportsReasoning, fallback.supportsReasoning),
      reasoningEfforts: Array.isArray(capabilities.reasoningEfforts)
        ? capabilities.reasoningEfforts.filter(isRuntimeReasoningEffort)
        : fallback.reasoningEfforts,
      defaultReasoningEffort: isRuntimeReasoningEffort(capabilities.defaultReasoningEffort)
        ? capabilities.defaultReasoningEffort
        : fallback.defaultReasoningEffort,
      supportsReasoningSummaries: booleanValue(
        capabilities.supportsReasoningSummaries,
        fallback.supportsReasoningSummaries,
      ),
    });
  } catch {
    return fallback;
  }
}

function uniqueReasoningEfforts(values: RuntimeReasoningEffort[]): RuntimeReasoningEffort[] {
  return values.filter((value, index) => isRuntimeReasoningEffort(value) && values.indexOf(value) === index);
}

function isRuntimeReasoningEffort(value: unknown): value is RuntimeReasoningEffort {
  return [
    'none',
    'minimal',
    'low',
    'medium',
    'high',
    'xhigh',
    'max',
    'ultra',
  ].includes(String(value));
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === 'number' ? value : fallback;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
