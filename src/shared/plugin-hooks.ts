import type { HookMetadata } from '../generated/protocol/typescript/v2/HookMetadata';
import type { HooksListResponse } from '../generated/protocol/typescript/v2/HooksListResponse';

export interface PluginHookPreviewItem {
  key: string;
  eventName: 'stop';
  command: string;
  platformCommand: string;
  async: boolean;
  timeoutSec: number;
  statusMessage: string | null;
  matcher: string | null;
}

export interface PluginHookPreview {
  pluginId: string;
  sourcePath: string | null;
  digest: string | null;
  hooks: PluginHookPreviewItem[];
  errors: string[];
  supported: boolean;
}

export interface PluginHookListInput {
  cwd?: string;
}

export interface PluginHookSetEnabledInput {
  key: string;
  cwd?: string;
  enabled: boolean;
  expectedCurrentHash?: string;
  trustCurrentDefinition?: boolean;
}

export type PluginHookMetadata = HookMetadata;
export type PluginHooksListResponse = HooksListResponse;
