export type PluginCredentialType = 'apiKey' | 'bearerToken';

const CREDENTIAL_KEY = /^[a-z0-9][a-z0-9._/-]{0,127}$/;
const SECRET_ENVIRONMENT_NAME = /^[A-Z][A-Z0-9_]*(?:_API_KEY|_TOKEN|_SECRET|_PASSWORD)$/;

export function isPluginCredentialKey(value: string): boolean {
  return CREDENTIAL_KEY.test(value);
}

export function isPluginCredentialEnvironmentName(value: string): boolean {
  return SECRET_ENVIRONMENT_NAME.test(value);
}

export interface PluginCredentialDeclaration {
  id: string;
  key: string;
  credentialType: PluginCredentialType;
  label: string;
  description: string;
  env: string;
  required: boolean;
  scope: 'marketplace';
  mcpServers: string[];
}

export interface PluginCredentialValue extends PluginCredentialDeclaration {
  value: string | null;
}

export interface PluginCredentialsSnapshot {
  pluginId: string;
  credentials: PluginCredentialValue[];
}

export interface ActivePluginCredential extends PluginCredentialDeclaration {
  pluginId: string;
  marketplaceName: string;
}
