import { createHash } from 'node:crypto';
import path from 'node:path';
import type { PluginReadResponse } from '../generated/protocol/typescript/v2/PluginReadResponse';
import type { DesktopPlatform } from '../platform';
import { currentPlatformStrategy } from '../platform';
import { pluginHookPlatformCommand } from '../platform/plugin-hooks';
import type { PluginHookPreview, PluginHookPreviewItem } from '../shared/plugin-hooks';
import { readTextInside, resolvePluginRoot } from './plugin-manifest';

const HOOKS_RELATIVE_PATH = 'hooks/hooks.json';
const MAX_HOOK_FILE_BYTES = 1_000_000;
const MAX_GROUPS = 64;
const MAX_HANDLERS_PER_GROUP = 64;
const MAX_COMMAND_LENGTH = 16_384;

export function previewPluginHooks(
  response: PluginReadResponse,
  platform: DesktopPlatform = currentPlatformStrategy().id,
): PluginHookPreview {
  const pluginId = response.plugin.summary.id;
  const root = resolvePluginRoot(response.plugin);
  if (!root) return failed(pluginId, null, '无法定位插件目录');
  const sourcePath = path.join(root, HOOKS_RELATIVE_PATH);
  const text = readTextInside(root, sourcePath);
  if (text === null) {
    return response.plugin.hooks.length > 0
      ? failed(pluginId, sourcePath, '无法读取 hooks/hooks.json')
      : empty(pluginId, sourcePath);
  }
  if (Buffer.byteLength(text, 'utf8') > MAX_HOOK_FILE_BYTES) {
    return failed(pluginId, sourcePath, 'hooks/hooks.json 超过 1 MB 限制');
  }

  const digest = `sha256:${createHash('sha256').update(text).digest('hex')}`;
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch {
    return failed(pluginId, sourcePath, 'hooks/hooks.json 不是有效 JSON', digest);
  }
  const rootRecord = record(document);
  const eventTable = record(rootRecord?.hooks);
  if (!rootRecord || !eventTable) {
    return failed(pluginId, sourcePath, 'hooks/hooks.json 必须包含 hooks 对象', digest);
  }
  const eventNames = Object.keys(eventTable);
  const unsupportedEvents = eventNames.filter((name) => name !== 'Stop');
  if (unsupportedEvents.length > 0) {
    return failed(
      pluginId,
      sourcePath,
      `当前仅支持 Stop Hook，不支持：${unsupportedEvents.join('、')}`,
      digest,
    );
  }
  if (eventNames.length === 0) return empty(pluginId, sourcePath, digest);
  const groups = eventTable.Stop;
  if (!Array.isArray(groups) || groups.length > MAX_GROUPS) {
    return failed(pluginId, sourcePath, 'Stop 必须是最多 64 项的数组', digest);
  }

  const hooks: PluginHookPreviewItem[] = [];
  const errors: string[] = [];
  groups.forEach((rawGroup, groupIndex) => {
    const group = record(rawGroup);
    const handlers = group?.hooks;
    const matcher = nullableBoundedString(group?.matcher, 1_024);
    if (!group || !Array.isArray(handlers) || handlers.length > MAX_HANDLERS_PER_GROUP) {
      errors.push(`Stop[${groupIndex}] 必须包含最多 64 项的 hooks 数组`);
      return;
    }
    handlers.forEach((rawHandler, handlerIndex) => {
      const handler = record(rawHandler);
      if (!handler || handler.type !== 'command') {
        errors.push(`Stop[${groupIndex}].hooks[${handlerIndex}] 仅支持 command 类型`);
        return;
      }
      const command = boundedString(handler.command, MAX_COMMAND_LENGTH);
      const commandWindows = optionalBoundedString(handler.commandWindows, MAX_COMMAND_LENGTH);
      const timeout = optionalPositiveInteger(handler.timeout, 3_600);
      const async = handler.async === undefined ? false : handler.async;
      const statusMessage = nullableBoundedString(handler.statusMessage, 512);
      if (!command) errors.push(`Stop[${groupIndex}].hooks[${handlerIndex}] 缺少有效 command`);
      if (commandWindows === undefined) errors.push(`Stop[${groupIndex}].hooks[${handlerIndex}] 的 commandWindows 无效`);
      if (timeout === undefined) errors.push(`Stop[${groupIndex}].hooks[${handlerIndex}] 的 timeout 无效`);
      if (typeof async !== 'boolean') errors.push(`Stop[${groupIndex}].hooks[${handlerIndex}] 的 async 必须是布尔值`);
      if (!command || commandWindows === undefined || timeout === undefined || typeof async !== 'boolean') return;
      hooks.push({
        key: `${pluginId}:${HOOKS_RELATIVE_PATH}:stop:${groupIndex}:${handlerIndex}`,
        eventName: 'stop',
        command,
        platformCommand: pluginHookPlatformCommand(command, commandWindows, platform),
        async,
        timeoutSec: timeout ?? 5,
        statusMessage,
        matcher,
      });
    });
  });
  if (errors.length === 0) {
    if (response.plugin.hooks.length !== hooks.length) {
      errors.push('Hook 文件与插件声明数量不一致');
    } else {
      response.plugin.hooks.forEach((declaration, index) => {
        if (declaration.eventName !== 'stop') {
          errors.push(`插件声明包含不支持的 Hook 事件：${declaration.eventName}`);
          return;
        }
        hooks[index].key = declaration.key;
      });
    }
  }
  return { pluginId, sourcePath, digest, hooks, errors, supported: errors.length === 0 };
}

export function hookStateKeyPath(key: string): string {
  return `hooks.state."${key.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

function failed(pluginId: string, sourcePath: string | null, error: string, digest: string | null = null): PluginHookPreview {
  return { pluginId, sourcePath, digest, hooks: [], errors: [error], supported: false };
}

function empty(pluginId: string, sourcePath: string | null, digest: string | null = null): PluginHookPreview {
  return { pluginId, sourcePath, digest, hooks: [], errors: [], supported: true };
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function boundedString(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max
    ? value
    : null;
}

function nullableBoundedString(value: unknown, max: number): string | null {
  return value === undefined || value === null ? null : boundedString(value, max);
}

function optionalBoundedString(value: unknown, max: number): string | null | undefined {
  return value === undefined || value === null ? null : boundedString(value, max) ?? undefined;
}

function optionalPositiveInteger(value: unknown, max: number): number | null | undefined {
  if (value === undefined || value === null) return null;
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= max
    ? value
    : undefined;
}
