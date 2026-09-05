import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  normalizeExtensionName,
  isRetiredPresetSourceName,
  pluginConfigKey,
  pluginMcpConfigKey,
  type ExtensionPluginPolicy,
  type ExtensionPolicySnapshot,
  type ExtensionSource,
} from '../shared/extension-policy';
import type {
  ActivePluginCredential,
  PluginCredentialDeclaration,
} from '../shared/plugin-credentials';
import {
  isPluginCredentialEnvironmentName,
  isPluginCredentialKey,
} from '../shared/plugin-credentials';

interface StoredMarketplaceSource {
  name: string;
  source: string;
  refName: string | null;
  enabled: boolean;
  preset?: boolean;
}

interface StoredExtensionPolicy {
  version: 2;
  migrations?: string[];
  marketplaces: StoredMarketplaceSource[];
  plugins: ExtensionPluginPolicy[];
  enabledSkillPaths: string[];
}

const EMPTY_POLICY: StoredExtensionPolicy = {
  version: 2,
  marketplaces: [],
  plugins: [],
  enabledSkillPaths: [],
};

export class ExtensionPolicyStore {
  readonly filePath: string;
  private state: StoredExtensionPolicy;

  constructor(uiStateRoot: string) {
    mkdirSync(uiStateRoot, { recursive: true });
    this.filePath = path.join(uiStateRoot, 'extension-policy.json');
    this.state = this.load();
    // Persist the sanitized state so retired presets cannot reappear on a
    // later launch even when an older Whale Buddy version wrote them here.
    this.persist();
  }

  hasMigration(name: string): boolean { return this.state.migrations?.includes(name) ?? false; }

  markMigration(name: string): void {
    this.state.migrations = [...new Set([...(this.state.migrations ?? []), name])];
    this.persist();
  }

  snapshot(): ExtensionPolicySnapshot {
    return {
      sources: this.sources(),
      plugins: this.state.plugins.map((plugin) => ({
        ...plugin,
        mcpServers: [...plugin.mcpServers],
        enabledMcpServers: [...plugin.enabledMcpServers],
        credentials: plugin.credentials.map(cloneCredential),
      })),
      enabledSkillPaths: [],
    };
  }

  sources(): ExtensionSource[] {
    return this.state.marketplaces.map((marketplace) => ({
      name: marketplace.name,
      title: marketplace.name,
      description: marketplace.source,
      kind: 'marketplace' as const,
      source: marketplace.source,
      refName: marketplace.refName,
      enabled: marketplace.enabled,
      preset: marketplace.preset === true,
    }));
  }

  source(name: string): ExtensionSource | null {
    const normalized = normalizeExtensionName(name);
    return this.sources().find((source) => normalizeExtensionName(source.name) === normalized) ?? null;
  }

  isSourceEnabled(name: string): boolean {
    return this.source(name)?.enabled === true;
  }

  enabledMarketplaceNames(): string[] {
    return this.sources()
      .filter((source) => source.enabled)
      .map((source) => normalizeExtensionName(source.name));
  }

  enabledGitMarketplaceNames(): string[] {
    return this.sources()
      .filter((source) =>
        source.enabled
        && source.source !== null
        && !isLocalMarketplaceSource(source.source)
      )
      .map((source) => normalizeExtensionName(source.name));
  }

  addMarketplace(name: string, source: string, refName: string | null, preset = false): void {
    const normalized = normalizeExtensionName(name);
    if (isRetiredPresetSourceName(normalized)) {
      throw new Error(`此应用不支持预设扩展源：${name}`);
    }
    const next: StoredMarketplaceSource = {
      name: normalized,
      source,
      refName,
      enabled: true,
      preset,
    };
    const index = this.state.marketplaces.findIndex(
      (entry) => normalizeExtensionName(entry.name) === normalized,
    );
    if (index >= 0) this.state.marketplaces[index] = next;
    else this.state.marketplaces.push(next);
    this.persist();
  }

  removeMarketplace(name: string): void {
    const normalized = normalizeExtensionName(name);
    const current = this.state.marketplaces.find((entry) => normalizeExtensionName(entry.name) === normalized);
    if (current?.preset) throw new Error('预置商城源不能删除，可以将其停用');
    this.state.marketplaces = this.state.marketplaces.filter(
      (entry) => normalizeExtensionName(entry.name) !== normalized,
    );
    for (const plugin of this.state.plugins) {
      if (normalizeExtensionName(plugin.marketplaceName) === normalized) plugin.enabled = false;
    }
    this.persist();
  }

  setSourceEnabled(name: string, enabled: boolean): ExtensionPolicySnapshot {
    const normalized = normalizeExtensionName(name);
    const source = this.state.marketplaces.find(
      (entry) => normalizeExtensionName(entry.name) === normalized,
    );
    if (!source) throw new Error(`未知商城源：${name}`);
    source.enabled = enabled;
    this.persist();
    return this.snapshot();
  }

  registerPlugin(
    pluginId: string,
    marketplaceName: string,
    mcpServers: string[],
    credentials: PluginCredentialDeclaration[] = [],
  ): ExtensionPolicySnapshot {
    const normalizedId = pluginId.trim();
    const current = this.state.plugins.find((plugin) => plugin.pluginId === normalizedId);
    const next: ExtensionPluginPolicy = {
      pluginId: normalizedId,
      marketplaceName: normalizeExtensionName(marketplaceName),
      enabled: false,
      mcpServers: [...new Set(mcpServers)].sort(),
      enabledMcpServers: [],
      credentials: credentials.map(cloneCredential),
    };
    if (current) Object.assign(current, next);
    else this.state.plugins.push(next);
    this.persist();
    return this.snapshot();
  }

  removePlugin(pluginId: string): ExtensionPolicySnapshot {
    this.state.plugins = this.state.plugins.filter((plugin) => plugin.pluginId !== pluginId);
    this.persist();
    return this.snapshot();
  }

  setPluginEnabled(
    pluginId: string,
    enabled: boolean,
    declaredMcpServers?: string[],
    credentials?: PluginCredentialDeclaration[],
  ): ExtensionPolicySnapshot {
    const plugin = this.requirePlugin(pluginId);
    if (declaredMcpServers) {
      plugin.mcpServers = [...new Set(declaredMcpServers)].sort();
    }
    if (credentials) plugin.credentials = credentials.map(cloneCredential);
    plugin.enabled = enabled;
    // Child overrides are session preferences, not permanent defaults. Every
    // plugin activation starts from its manifest defaults: all declared MCP
    // servers are enabled. Individual servers may then be disabled again.
    plugin.enabledMcpServers = enabled ? [...plugin.mcpServers] : [];
    this.persist();
    return this.snapshot();
  }

  updatePluginCredentials(
    pluginId: string,
    credentials: PluginCredentialDeclaration[],
  ): ExtensionPolicySnapshot {
    const plugin = this.requirePlugin(pluginId);
    plugin.credentials = credentials.map(cloneCredential);
    this.persist();
    return this.snapshot();
  }

  isPluginEnabled(pluginId: string): boolean {
    const plugin = this.state.plugins.find((entry) => entry.pluginId === pluginId);
    return Boolean(plugin?.enabled && this.isSourceEnabled(plugin.marketplaceName));
  }

  setSkillEnabled(pathValue: string, enabled: boolean): ExtensionPolicySnapshot {
    void pathValue;
    void enabled;
    this.state.enabledSkillPaths = [];
    this.persist();
    return this.snapshot();
  }

  isStandaloneSkillEnabled(pathValue: string): boolean {
    void pathValue;
    return false;
  }

  setMcpEnabled(pluginId: string, serverName: string, enabled: boolean): ExtensionPolicySnapshot {
    const plugin = this.requirePlugin(pluginId);
    if (!plugin.mcpServers.includes(serverName)) {
      throw new Error(`插件 ${pluginId} 未声明 MCP 服务 ${serverName}`);
    }
    const values = new Set(plugin.enabledMcpServers);
    if (enabled) values.add(serverName);
    else values.delete(serverName);
    plugin.enabledMcpServers = [...values].sort();
    this.persist();
    return this.snapshot();
  }

  isMcpEnabled(pluginId: string | null, serverName: string): boolean {
    if (!pluginId) return false;
    const plugin = this.state.plugins.find((entry) => entry.pluginId === pluginId);
    return Boolean(
      plugin
      && this.isPluginEnabled(pluginId)
      && plugin.enabledMcpServers.includes(serverName),
    );
  }

  activeCredentials(): ActivePluginCredential[] {
    return this.state.plugins.flatMap((plugin) => {
      if (!this.isPluginEnabled(plugin.pluginId)) return [];
      return plugin.credentials.flatMap((credential) =>
        credential.mcpServers.some((server) => plugin.enabledMcpServers.includes(server))
          ? [{
              ...cloneCredential(credential),
              pluginId: plugin.pluginId,
              marketplaceName: plugin.marketplaceName,
            }]
          : []
      );
    });
  }

  activeCredentialsForMcp(pluginId: string, serverName: string): ActivePluginCredential[] {
    return this.activeCredentials().filter(
      (credential) =>
        credential.pluginId === pluginId
        && credential.mcpServers.includes(serverName),
    );
  }

  allCredentialReferences(): Array<{ marketplaceName: string; key: string }> {
    return this.state.plugins.flatMap((plugin) => plugin.credentials.map((credential) => ({
      marketplaceName: plugin.marketplaceName,
      key: credential.key,
    })));
  }

  isCredentialRequiredByEnabledPlugin(marketplaceName: string, key: string): boolean {
    const marketplace = normalizeExtensionName(marketplaceName);
    return this.activeCredentials().some(
      (credential) =>
        credential.marketplaceName === marketplace
        && credential.key === key
        && credential.required,
    );
  }

  isCredentialActive(marketplaceName: string, key: string): boolean {
    const marketplace = normalizeExtensionName(marketplaceName);
    return this.activeCredentials().some(
      (credential) => credential.marketplaceName === marketplace && credential.key === key,
    );
  }

  launchConfigOverrides(): string[] {
    const effectivePlugins = this.state.plugins.filter((plugin) => this.isPluginEnabled(plugin.pluginId));
    const pluginsEnabled = this.enabledMarketplaceNames().length > 0 || effectivePlugins.length > 0;
    const includeSkillInstructions = effectivePlugins.length > 0;
    const overrides = [
      'features.apps=false',
      `features.plugins=${String(pluginsEnabled)}`,
      'features.remote_plugin=false',
      'features.recommended_plugins=false',
      'features.tool_suggest=false',
      'skills.bundled.enabled=false',
      `skills.include_instructions=${String(includeSkillInstructions)}`,
    ];
    for (const plugin of this.state.plugins) {
      const pluginEnabled = this.isPluginEnabled(plugin.pluginId);
      overrides.push(`${pluginConfigKey(plugin.pluginId)}.enabled=${String(pluginEnabled)}`);
      for (const serverName of plugin.mcpServers) {
        const serverEnabled = pluginEnabled && plugin.enabledMcpServers.includes(serverName);
        overrides.push(`${pluginMcpConfigKey(plugin.pluginId, serverName)}.enabled=${String(serverEnabled)}`);
      }
    }
    return overrides;
  }

  private requirePlugin(pluginId: string): ExtensionPluginPolicy {
    const plugin = this.state.plugins.find((entry) => entry.pluginId === pluginId);
    if (!plugin) throw new Error(`未知插件：${pluginId}`);
    return plugin;
  }

  private load(): StoredExtensionPolicy {
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as StoredExtensionPolicy & {
        enabledBuiltinSources?: unknown;
      };
      if (parsed.version !== 2) throw new Error('unsupported extension policy');
      if (
        !Array.isArray(parsed.marketplaces)
        || !Array.isArray(parsed.plugins)
        || !Array.isArray(parsed.enabledSkillPaths)
      ) {
        throw new Error('invalid extension policy');
      }
      return {
        version: 2,
        migrations: Array.isArray(parsed.migrations) ? parsed.migrations.filter((name) => typeof name === 'string') : [],
        marketplaces: parsed.marketplaces.filter(
          (marketplace) => !isRetiredPresetSourceName(marketplace.name),
        ),
        plugins: parsed.plugins
          .filter((plugin) => !isRetiredPresetSourceName(plugin.marketplaceName))
          .map((plugin) => ({
            ...plugin,
            credentials: Array.isArray(plugin.credentials)
              ? plugin.credentials.flatMap((credential) => {
                  const normalized = storedCredential(credential, plugin.mcpServers);
                  return normalized ? [normalized] : [];
                })
              : [],
          })),
        enabledSkillPaths: [],
      };
    } catch {
      return structuredClone(EMPTY_POLICY);
    }
  }

  private persist(): void {
    const temporaryPath = `${this.filePath}.tmp`;
    writeFileSync(temporaryPath, `${JSON.stringify(this.state, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    renameSync(temporaryPath, this.filePath);
  }
}

function cloneCredential(credential: PluginCredentialDeclaration): PluginCredentialDeclaration {
  return { ...credential, mcpServers: [...credential.mcpServers] };
}

function storedCredential(
  value: unknown,
  declaredMcpServers: string[],
): PluginCredentialDeclaration | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const credential = value as Partial<PluginCredentialDeclaration>;
  const declared = new Set(declaredMcpServers);
  const mcpServers = Array.isArray(credential.mcpServers)
    ? credential.mcpServers.filter(
        (server): server is string => typeof server === 'string' && declared.has(server),
      )
    : [];
  if (
    typeof credential.id !== 'string'
    || typeof credential.key !== 'string'
    || !isPluginCredentialKey(credential.key)
    || (credential.credentialType !== 'apiKey' && credential.credentialType !== 'bearerToken')
    || typeof credential.label !== 'string'
    || typeof credential.description !== 'string'
    || typeof credential.env !== 'string'
    || !isPluginCredentialEnvironmentName(credential.env)
    || typeof credential.required !== 'boolean'
    || credential.scope !== 'marketplace'
    || mcpServers.length === 0
  ) {
    return null;
  }
  return {
    id: credential.id,
    key: credential.key,
    credentialType: credential.credentialType,
    label: credential.label,
    description: credential.description,
    env: credential.env,
    required: credential.required,
    scope: 'marketplace',
    mcpServers: [...new Set(mcpServers)],
  };
}

function isLocalMarketplaceSource(source: string): boolean {
  const value = source.trim();
  return path.isAbsolute(value)
    || /^[A-Za-z]:[\\/]/.test(value)
    || value.startsWith('\\\\')
    || value.startsWith('./')
    || value.startsWith('.\\')
    || value.startsWith('../')
    || value.startsWith('..\\')
    || value.startsWith('~/')
    || value === '.'
    || value === '..';
}
