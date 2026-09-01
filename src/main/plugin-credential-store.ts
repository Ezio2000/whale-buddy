import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type {
  ActivePluginCredential,
  PluginCredentialDeclaration,
  PluginCredentialValue,
} from '../shared/plugin-credentials';
import { normalizeExtensionName } from '../shared/extension-policy';

export interface PluginCredentialEnvironmentResolution {
  environment: NodeJS.ProcessEnv;
  errors: string[];
}

interface StoredPluginCredentials {
  version: 1;
  values: Record<string, string>;
}

const EMPTY_CREDENTIALS: StoredPluginCredentials = {
  version: 1,
  values: {},
};

export class PluginCredentialStore {
  readonly filePath: string;
  private state: StoredPluginCredentials;

  constructor(uiStateRoot: string) {
    mkdirSync(uiStateRoot, { recursive: true });
    this.filePath = path.join(uiStateRoot, 'plugin-credentials.json');
    this.state = this.load();
  }

  values(
    marketplaceName: string,
    credentials: PluginCredentialDeclaration[],
  ): PluginCredentialValue[] {
    return credentials.map((credential) => ({
      ...credential,
      mcpServers: [...credential.mcpServers],
      value: this.value(marketplaceName, credential.key),
    }));
  }

  has(marketplaceName: string, key: string): boolean {
    return Boolean(this.value(marketplaceName, key));
  }

  configure(marketplaceName: string, key: string, value: string | null): void {
    const id = storageKey(marketplaceName, key);
    if (value === null) {
      delete this.state.values[id];
      this.persist();
      return;
    }
    const normalized = value.trim();
    if (!normalized) throw new Error('凭据不能为空');
    if (normalized.length > 16_384) throw new Error('凭据不能超过 16 KB');
    this.state.values[id] = normalized;
    this.persist();
  }

  missingRequired(
    marketplaceName: string,
    credentials: PluginCredentialDeclaration[],
  ): PluginCredentialDeclaration[] {
    return credentials.filter(
      (credential) => credential.required && !this.has(marketplaceName, credential.key),
    );
  }

  launchEnvironment(credentials: ActivePluginCredential[]): NodeJS.ProcessEnv {
    const resolved = this.resolveLaunchEnvironment(credentials);
    if (resolved.errors.length > 0) throw new Error(resolved.errors[0]);
    return resolved.environment;
  }

  resolveLaunchEnvironment(
    credentials: ActivePluginCredential[],
  ): PluginCredentialEnvironmentResolution {
    const environment: NodeJS.ProcessEnv = {};
    const errors: string[] = [];
    const conflictedNames = new Set<string>();
    for (const credential of credentials) {
      const value = this.value(credential.marketplaceName, credential.key);
      if (!value) {
        if (credential.required) errors.push(`插件凭据“${credential.label}”尚未配置`);
        continue;
      }
      if (conflictedNames.has(credential.env)) continue;
      const existing = environment[credential.env];
      if (existing && existing !== value) {
        delete environment[credential.env];
        conflictedNames.add(credential.env);
        errors.push(`插件凭据环境变量 ${credential.env} 存在冲突`);
        continue;
      }
      environment[credential.env] = value;
    }
    return { environment, errors };
  }

  prune(allowed: Array<{ marketplaceName: string; key: string }>): void {
    const keep = new Set(allowed.map((entry) => storageKey(entry.marketplaceName, entry.key)));
    let changed = false;
    for (const key of Object.keys(this.state.values)) {
      if (keep.has(key)) continue;
      delete this.state.values[key];
      changed = true;
    }
    if (changed) this.persist();
  }

  private value(marketplaceName: string, key: string): string | null {
    return this.state.values[storageKey(marketplaceName, key)] ?? null;
  }

  private load(): StoredPluginCredentials {
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as StoredPluginCredentials;
      if (
        parsed.version !== 1
        || typeof parsed.values !== 'object'
        || parsed.values === null
        || Array.isArray(parsed.values)
        || Object.values(parsed.values).some((value) => typeof value !== 'string')
      ) {
        throw new Error('invalid plugin credential store');
      }
      return parsed;
    } catch {
      return structuredClone(EMPTY_CREDENTIALS);
    }
  }

  private persist(): void {
    const temporaryPath = `${this.filePath}.tmp`;
    writeFileSync(temporaryPath, `${JSON.stringify(this.state, null, 2)}\n`, 'utf8');
    renameSync(temporaryPath, this.filePath);
  }
}

function storageKey(marketplaceName: string, key: string): string {
  return `${normalizeExtensionName(marketplaceName)}\u0000${key}`;
}
