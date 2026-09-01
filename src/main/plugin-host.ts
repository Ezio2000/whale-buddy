import { protocol } from 'electron';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import type { PluginReadResponse } from '../generated/protocol/typescript/v2/PluginReadResponse';
import type { DynamicToolSpec } from '../generated/protocol/typescript/v2/DynamicToolSpec';
import {
  PLUGIN_MESSAGE_ITEM_TYPES,
  WHALE_PLUGIN_API_VERSION,
  type PluginDescriptor,
  type PluginMcpPermission,
  type PluginUiContribution,
  type PluginWebMcpTool,
} from '../shared/plugin';
import type { JsonValue } from '../shared/types';
import {
  isInside,
  readJsonInside,
  readWhalePluginManifest,
  record,
  resolvePluginRoot,
} from './plugin-manifest';

const pluginRoots = new Map<string, string>();
const pluginDescriptors = new Map<string, PluginDescriptor>();

export interface PluginMcpHttpConnection {
  url: string;
  headers: Record<string, string>;
  timeoutMs: number;
}

export function registerPluginSchemes(): void {
  protocol.registerSchemesAsPrivileged([{
    scheme: 'whale-plugin',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  }]);
}

export function registerPluginProtocol(): void {
  protocol.handle('whale-plugin', async (request) => {
    try {
      const url = new URL(request.url);
      if (url.hostname !== 'plugin') return response('Not found', 404, 'text/plain');
      const segments = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
      const pluginId = segments.shift();
      const root = pluginId ? pluginRoots.get(pluginId) : null;
      if (!pluginId || !root || segments.length === 0) return response('Not found', 404, 'text/plain');
      const resolved = realpathSync(path.resolve(root, ...segments));
      if (!isInside(root, resolved)) return response('Forbidden', 403, 'text/plain');
      return response(
        readFileSync(resolved),
        200,
        contentType(resolved),
        path.extname(resolved) === '.html',
      );
    } catch {
      return response('Not found', 404, 'text/plain');
    }
  });
}

export function readPluginDescriptor(response: PluginReadResponse): PluginDescriptor | null {
  const plugin = response.plugin;
  const resolved = readWhalePluginManifest(response);
  if (!resolved || resolved.whale.apiVersion !== WHALE_PLUGIN_API_VERSION) return null;
  const { root, whale } = resolved;
  const declaredServers = new Set(plugin.mcpServers);
  const uiContributions = parseUiContributions(
    whale.uiContributions,
    plugin.summary.id,
    root,
    declaredServers,
  );
  const webMcp = parseWebMcp(whale.webMcp, plugin.summary.id, root);
  if (uiContributions.length === 0 && !webMcp) return null;
  return {
    pluginId: plugin.summary.id,
    pluginName: plugin.summary.name,
    displayName: plugin.summary.interface?.displayName ?? plugin.summary.name,
    apiVersion: WHALE_PLUGIN_API_VERSION,
    uiContributions,
    webMcp,
    mcpPermissions: parsePermissions(whale.permissions, declaredServers),
    credentials: [],
  };
}

export function replacePluginRegistry(
  entries: Array<{ descriptor: PluginDescriptor; root: string }>,
): PluginDescriptor[] {
  const toolNames = new Set<string>();
  for (const { descriptor } of entries) {
    for (const tool of descriptor.webMcp?.tools ?? []) {
      if (toolNames.has(tool.name)) throw new Error(`WebMCP 工具名称重复：${tool.name}`);
      toolNames.add(tool.name);
    }
  }
  pluginRoots.clear();
  pluginDescriptors.clear();
  for (const entry of entries) {
    pluginRoots.set(entry.descriptor.pluginId, entry.root);
    pluginDescriptors.set(entry.descriptor.pluginId, entry.descriptor);
  }
  return entries.map((entry) => entry.descriptor);
}

export function pluginRoot(response: PluginReadResponse): string | null {
  return resolvePluginRoot(response.plugin);
}

export function pluginDynamicTools(): DynamicToolSpec[] {
  return Array.from(pluginDescriptors.values()).flatMap((descriptor) =>
    (descriptor.webMcp?.tools ?? []).map((tool) => ({
      type: 'function' as const,
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      deferLoading: false,
    })));
}

export function resolvePluginTool(name: string): {
  descriptor: PluginDescriptor;
  tool: PluginWebMcpTool;
} | null {
  for (const descriptor of pluginDescriptors.values()) {
    const tool = descriptor.webMcp?.tools.find((candidate) => candidate.name === name);
    if (tool) return { descriptor, tool };
  }
  return null;
}

export function assertPluginMcpPermission(
  pluginId: string,
  principal: string,
  server: string,
  tool: string,
): void {
  const descriptor = pluginDescriptors.get(pluginId);
  if (!descriptor) throw new Error('插件宿主尚未加载或插件已停用');
  if (!principalExists(descriptor, principal)) throw new Error('未知的插件调用主体');
  const allowed = descriptor.mcpPermissions.some((permission) =>
    principalMatches(permission.principal, principal)
    && permission.server === server
    && permission.tools.includes(tool));
  if (!allowed) throw new Error(`${principal} 未获准调用 ${server}.${tool}`);
}

export function pluginMcpHttpConnection(
  pluginId: string,
  server: string,
  credentialEnvironment: NodeJS.ProcessEnv = {},
): PluginMcpHttpConnection {
  const root = pluginRoots.get(pluginId);
  if (!root) throw new Error('插件宿主尚未加载或插件已停用');
  const manifest = readJsonInside(root, path.join(root, '.mcp.json'));
  const config = record(record(manifest?.mcpServers)?.[server]);
  const url = boundedString(config?.url, 4_096);
  if (!url) throw new Error(`MCP 服务 ${server} 不是 HTTP 服务`);
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error('unsupported');
  } catch {
    throw new Error(`MCP 服务 ${server} 的 URL 无效`);
  }
  const rawHeaders = record(config?.http_headers);
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(rawHeaders ?? {}).slice(0, 64)) {
    if (name.length <= 256 && typeof value === 'string' && value.length <= 16_384) headers[name] = value;
  }
  const bearerTokenEnvironment = boundedString(config?.bearer_token_env_var, 256);
  const bearerToken = bearerTokenEnvironment ? credentialEnvironment[bearerTokenEnvironment] : undefined;
  if (bearerToken && !Object.keys(headers).some((name) => name.toLowerCase() === 'authorization')) {
    headers.Authorization = `Bearer ${bearerToken}`;
  }
  const timeoutSeconds = typeof config?.tool_timeout_sec === 'number' ? config.tool_timeout_sec : 60;
  return {
    url,
    headers,
    timeoutMs: Math.max(1_000, Math.min(300_000, Math.round(timeoutSeconds * 1_000))),
  };
}

function parseUiContributions(
  value: unknown,
  pluginId: string,
  root: string,
  declaredServers: Set<string>,
): PluginUiContribution[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: PluginUiContribution[] = [];
  for (const raw of value.slice(0, 32)) {
    const item = record(raw);
    const id = boundedString(item?.id, 128);
    const type = boundedString(item?.type, 64);
    const placement = boundedString(item?.placement, 64);
    const entryUrl = resolveEntryUrl(pluginId, root, item?.entry);
    if (!id || seen.has(id) || !entryUrl) continue;
    const order = boundedOrder(item?.order);
    if (type === 'widget' && placement === 'composer') {
      result.push({ id, type, placement, entryUrl, order });
    } else if (type === 'panel' && placement === 'turnDetails') {
      const title = boundedString(item?.title, 128);
      if (!title) continue;
      result.push({ id, type, placement, entryUrl, title, order });
    } else if (type === 'page' && placement === 'navigation') {
      const title = boundedString(item?.title, 128);
      if (!title) continue;
      result.push({ id, type, placement, entryUrl, title, order });
    } else if (
      type === 'action'
      && ['commandPalette', 'threadToolbar', 'composerToolbar'].includes(placement ?? '')
    ) {
      const title = boundedString(item?.title, 128);
      if (!title) continue;
      result.push({
        id,
        type,
        placement: placement as 'commandPalette' | 'threadToolbar' | 'composerToolbar',
        entryUrl,
        title,
        description: boundedString(item?.description, 512) ?? '',
        keywords: stringArray(item?.keywords, 64).slice(0, 16),
        order,
      });
    } else if (type === 'card' && placement === 'message') {
      const title = boundedString(item?.title, 128);
      const match = record(item?.match);
      const requestedItemTypes = stringArray(match?.itemTypes, 64);
      const itemTypes = PLUGIN_MESSAGE_ITEM_TYPES.filter((candidate) =>
        requestedItemTypes.includes(candidate));
      const server = boundedString(match?.server, 512) ?? null;
      const tools = stringArray(match?.tools, 512);
      if (!title || itemTypes.length === 0) continue;
      if (server && (!declaredServers.has(server) || tools.length === 0)) continue;
      if (!server && tools.length > 0) continue;
      result.push({ id, type, placement, entryUrl, title, itemTypes, server, tools, order });
    } else {
      continue;
    }
    seen.add(id);
  }
  return result;
}

function parseWebMcp(
  value: unknown,
  pluginId: string,
  root: string,
): PluginDescriptor['webMcp'] {
  const webMcp = record(value);
  const entryUrl = resolveEntryUrl(pluginId, root, webMcp?.entry);
  if (!webMcp || !entryUrl || !Array.isArray(webMcp.tools)) return null;
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();
  const tools: PluginWebMcpTool[] = [];
  for (const raw of webMcp.tools.slice(0, 64)) {
    const tool = record(raw);
    const id = boundedString(tool?.id, 128);
    const name = boundedString(tool?.name, 128);
    const description = boundedString(tool?.description, 500);
    const scope = tool?.scope;
    const inputSchema = jsonValue(record(tool?.inputSchema));
    if (
      !id || seenIds.has(id)
      || !name || seenNames.has(name) || !isSupportedDynamicToolName(name)
      || !description
      || !['global', 'project', 'thread'].includes(String(scope))
      || inputSchema === undefined || !isSupportedToolInputSchema(inputSchema)
    ) continue;
    const annotations = record(tool?.annotations);
    tools.push({
      id,
      name,
      title: boundedString(tool?.title, 128) ?? name,
      description,
      scope: scope as 'global' | 'project' | 'thread',
      inputSchema,
      annotations: {
        readOnlyHint: annotations?.readOnlyHint === true,
        untrustedContentHint: annotations?.untrustedContentHint === true,
      },
    });
    seenIds.add(id);
    seenNames.add(name);
  }
  return tools.length > 0 ? { entryUrl, tools } : null;
}

function isSupportedDynamicToolName(name: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(name) && name !== 'mcp' && !name.startsWith('mcp__');
}

function isSupportedToolInputSchema(value: JsonValue, root = true): boolean {
  if (!value || Array.isArray(value) || typeof value !== 'object') return false;
  const schema = value as Record<string, JsonValue>;
  const schemaType = schema.type;
  const supportedTypes = new Set(['string', 'number', 'boolean', 'integer', 'object', 'array', 'null']);
  if (typeof schemaType === 'string' && !supportedTypes.has(schemaType)) return false;
  if (Array.isArray(schemaType) && (!schemaType.length || !schemaType.every((entry) => typeof entry === 'string' && supportedTypes.has(entry)))) return false;
  if (schemaType !== undefined && typeof schemaType !== 'string' && !Array.isArray(schemaType)) return false;
  if (root && schemaType === 'null') return false;
  if (schema.required !== undefined && (!Array.isArray(schema.required) || !schema.required.every((entry) => typeof entry === 'string'))) return false;
  if (schema.maxLength !== undefined && (typeof schema.maxLength !== 'number' || !Number.isSafeInteger(schema.maxLength) || schema.maxLength < 0)) return false;
  for (const key of ['$ref', 'description'] as const) if (schema[key] !== undefined && typeof schema[key] !== 'string') return false;
  if (schema.encrypted !== undefined && typeof schema.encrypted !== 'boolean') return false;
  for (const key of ['minimum', 'maximum'] as const) if (schema[key] !== undefined && typeof schema[key] !== 'number') return false;
  if (schema.enum !== undefined && !Array.isArray(schema.enum)) return false;
  if (schema.items !== undefined && !isSchemaNode(schema.items)) return false;
  if (schema.additionalProperties !== undefined && typeof schema.additionalProperties !== 'boolean' && !isSchemaNode(schema.additionalProperties)) return false;
  for (const key of ['properties', '$defs', 'definitions'] as const) {
    const table = schema[key];
    if (table === undefined) continue;
    if (!table || Array.isArray(table) || typeof table !== 'object' || !Object.values(table).every(isSchemaNode)) return false;
  }
  for (const key of ['anyOf', 'oneOf', 'allOf'] as const) {
    const variants = schema[key];
    if (variants !== undefined && (!Array.isArray(variants) || !variants.every(isSchemaNode))) return false;
  }
  return true;
}

function isSchemaNode(value: JsonValue): boolean {
  if (typeof value === 'boolean') return true;
  return isSupportedToolInputSchema(value, false);
}

function parsePermissions(value: unknown, declaredServers: Set<string>): PluginMcpPermission[] {
  const permissions = record(value);
  if (!Array.isArray(permissions?.mcp)) return [];
  return permissions.mcp.slice(0, 64).flatMap((raw) => {
    const permission = record(raw);
    const principal = boundedString(permission?.principal, 256);
    const server = boundedString(permission?.server, 512);
    const tools = stringArray(permission?.tools, 512);
    return principal && /^(ui|webMcp):(?:\*|[A-Za-z0-9._-]+)$/.test(principal)
      && server && declaredServers.has(server) && tools.length > 0
      ? [{ principal, server, tools }]
      : [];
  });
}

function principalExists(descriptor: PluginDescriptor, principal: string): boolean {
  const [kind, id] = principal.split(':', 2);
  if (kind === 'ui') return descriptor.uiContributions.some((entry) => entry.id === id);
  if (kind === 'webMcp') return Boolean(descriptor.webMcp?.tools.some((entry) => entry.id === id));
  return false;
}

function principalMatches(declared: string, actual: string): boolean {
  return declared === actual || declared === `${actual.split(':', 1)[0]}:*`;
}

function resolveEntryUrl(pluginId: string, root: string, value: unknown): string | null {
  const entry = boundedString(value, 1_024);
  if (!entry?.startsWith('./')) return null;
  try {
    const resolved = realpathSync(path.resolve(root, entry));
    if (!isInside(root, resolved) || path.extname(resolved) !== '.html') return null;
    const pathName = path.relative(root, resolved).split(path.sep).map(encodeURIComponent).join('/');
    return `whale-plugin://plugin/${encodeURIComponent(pluginId)}/${pathName}`;
  } catch {
    return null;
  }
}

function jsonValue(value: unknown): JsonValue | undefined {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (Array.isArray(value)) {
    const parsed = value.map(jsonValue);
    return parsed.some((entry) => entry === undefined) ? undefined : parsed as JsonValue[];
  }
  const object = record(value);
  if (!object) return undefined;
  const entries = Object.entries(object).map(([key, entry]) => [key, jsonValue(entry)] as const);
  if (entries.some(([, entry]) => entry === undefined)) return undefined;
  return Object.fromEntries(entries) as JsonValue;
}

function boundedOrder(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(-10_000, Math.min(10_000, value))
    : 0;
}

function boundedString(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.trim() && value.length <= max ? value.trim() : null;
}

function stringArray(value: unknown, max: number): string[] {
  return Array.isArray(value)
    ? Array.from(new Set(value.flatMap((entry) => {
        const item = boundedString(entry, max);
        return item ? [item] : [];
      }))).slice(0, 128)
    : [];
}

function response(body: string | Buffer, status: number, mime: string, html = false): Response {
  const headers: Record<string, string> = {
    'Content-Type': mime,
    'Access-Control-Allow-Origin': '*',
    'Cross-Origin-Resource-Policy': 'cross-origin',
  };
  if (html) {
    headers['Content-Security-Policy'] = [
      "default-src 'none'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'none'",
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors file: http://localhost:* http://127.0.0.1:*",
    ].join('; ');
  }
  return new Response(body as BodyInit, { status, headers });
}

function contentType(filePath: string): string {
  switch (path.extname(filePath).toLocaleLowerCase()) {
    case '.html': return 'text/html; charset=utf-8';
    case '.js': case '.mjs': return 'text/javascript; charset=utf-8';
    case '.css': return 'text/css; charset=utf-8';
    case '.json': return 'application/json; charset=utf-8';
    case '.svg': return 'image/svg+xml';
    case '.png': return 'image/png';
    case '.jpg': case '.jpeg': return 'image/jpeg';
    case '.webp': return 'image/webp';
    case '.woff2': return 'font/woff2';
    default: return 'application/octet-stream';
  }
}
