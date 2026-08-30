import { protocol } from 'electron';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import type { PluginReadResponse } from '../generated/protocol/typescript/v2/PluginReadResponse';
import {
  WHALE_PLUGIN_UI_API_VERSION,
  PLUGIN_MESSAGE_ITEM_TYPES,
  type PluginUiContribution,
  type PluginUiDescriptor,
} from '../shared/plugin-ui';
import {
  isInside,
  readJsonInside,
  readWhalePluginManifest,
  record,
  resolvePluginRoot,
} from './plugin-manifest';

const pluginRoots = new Map<string, string>();
const pluginDescriptors = new Map<string, PluginUiDescriptor>();

export interface PluginMcpHttpConnection {
  url: string;
  headers: Record<string, string>;
  timeoutMs: number;
}

export function registerPluginUiSchemes(): void {
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

export function registerPluginUiProtocol(): void {
  protocol.handle('whale-plugin', async (request) => {
    try {
      const url = new URL(request.url);
      if (url.hostname !== 'plugin') return response('Not found', 404, 'text/plain');
      const segments = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
      const pluginId = segments.shift();
      const root = pluginId ? pluginRoots.get(pluginId) : null;
      if (!pluginId || !root || segments.length === 0) return response('Not found', 404, 'text/plain');
      const candidate = path.resolve(root, ...segments);
      const resolved = realpathSync(candidate);
      if (!isInside(root, resolved)) return response('Forbidden', 403, 'text/plain');
      const contents = readFileSync(resolved);
      return response(contents, 200, contentType(resolved), path.extname(resolved) === '.html');
    } catch {
      return response('Not found', 404, 'text/plain');
    }
  });
}

export function readPluginUiDescriptor(response: PluginReadResponse): PluginUiDescriptor | null {
  const plugin = response.plugin;
  const resolved = readWhalePluginManifest(response);
  if (!resolved || resolved.whale.apiVersion !== WHALE_PLUGIN_UI_API_VERSION) return null;
  const { root, whale } = resolved;

  const declaredServers = new Set(plugin.mcpServers);
  const permissions = parsePermissions(whale.uiMcpPermissions, declaredServers);
  const contributions = parseContributions(
    whale.contributions,
    plugin.summary.id,
    root,
    declaredServers,
  );
  if (contributions.length === 0) return null;
  return {
    pluginId: plugin.summary.id,
    pluginName: plugin.summary.name,
    displayName: plugin.summary.interface?.displayName ?? plugin.summary.name,
    apiVersion: WHALE_PLUGIN_UI_API_VERSION,
    contributions,
    uiMcpPermissions: permissions,
    credentials: [],
  };
}

export function replacePluginUiRegistry(
  entries: Array<{ descriptor: PluginUiDescriptor; root: string }>,
): PluginUiDescriptor[] {
  pluginRoots.clear();
  pluginDescriptors.clear();
  for (const entry of entries) {
    pluginRoots.set(entry.descriptor.pluginId, entry.root);
    pluginDescriptors.set(entry.descriptor.pluginId, entry.descriptor);
  }
  return entries.map((entry) => entry.descriptor);
}

export function pluginUiRoot(response: PluginReadResponse): string | null {
  return resolvePluginRoot(response.plugin);
}

export function assertPluginUiToolPermission(
  pluginId: string,
  contributionId: string,
  server: string,
  tool: string,
): void {
  const descriptor = pluginDescriptors.get(pluginId);
  if (!descriptor) throw new Error('插件 UI 尚未加载或插件已停用');
  if (!descriptor.contributions.some((entry) => entry.id === contributionId)) {
    throw new Error('未知的插件 UI 贡献点');
  }
  const permission = descriptor.uiMcpPermissions.find((entry) => entry.server === server);
  if (!permission?.tools.includes(tool)) {
    throw new Error(`插件 UI 未获准调用 ${server}.${tool}`);
  }
}

export function pluginMcpHttpConnection(
  pluginId: string,
  server: string,
  credentialEnvironment: NodeJS.ProcessEnv = {},
): PluginMcpHttpConnection {
  const root = pluginRoots.get(pluginId);
  if (!root) throw new Error('插件 UI 尚未加载或插件已停用');
  const manifest = readJsonInside(root, path.join(root, '.mcp.json'));
  const servers = record(manifest?.mcpServers);
  const config = record(servers?.[server]);
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
    if (name.length <= 256 && typeof value === 'string' && value.length <= 16_384) {
      headers[name] = value;
    }
  }
  const bearerTokenEnvironment = boundedString(config?.bearer_token_env_var, 256);
  const bearerToken = bearerTokenEnvironment
    ? credentialEnvironment[bearerTokenEnvironment]
    : undefined;
  if (bearerToken && !Object.keys(headers).some((name) => name.toLowerCase() === 'authorization')) {
    headers.Authorization = `Bearer ${bearerToken}`;
  }
  const timeoutSeconds = typeof config?.tool_timeout_sec === 'number'
    ? config.tool_timeout_sec
    : 60;
  return {
    url,
    headers,
    timeoutMs: Math.max(1_000, Math.min(300_000, Math.round(timeoutSeconds * 1_000))),
  };
}

function parseContributions(
  value: unknown,
  pluginId: string,
  root: string,
  declaredServers: Set<string>,
): PluginUiContribution[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: PluginUiContribution[] = [];
  for (const raw of value.slice(0, 32)) {
    const contribution = record(raw);
    const id = boundedString(contribution?.id, 128);
    const type = boundedString(contribution?.type, 64);
    const entry = boundedString(contribution?.entry, 1_024);
    if (!id || seen.has(id) || !entry?.startsWith('./')) continue;
    const resolvedEntry = resolveEntry(root, entry);
    if (!resolvedEntry) continue;
    const entryUrl = pluginAssetUrl(pluginId, path.relative(root, resolvedEntry));
    const order = boundedOrder(contribution?.order);
    if (type === 'composer.widget') {
      result.push({
        id,
        type,
        entryUrl,
        order,
      });
      seen.add(id);
      continue;
    }
    if (type === 'mcp.toolCard') {
      const server = boundedString(contribution?.server, 512);
      const tools = stringArray(contribution?.tools, 512);
      if (!server || !declaredServers.has(server) || tools.length === 0) continue;
      result.push({ id, type, entryUrl, server, tools });
      seen.add(id);
      continue;
    }
    if (type === 'navigation.page' || type === 'thread.toolbarAction' || type === 'composer.action') {
      const title = boundedString(contribution?.title, 128);
      if (!title) continue;
      result.push({ id, type, entryUrl, title, order });
      seen.add(id);
      continue;
    }
    if (type === 'command.action') {
      const title = boundedString(contribution?.title, 128);
      if (!title) continue;
      result.push({
        id,
        type,
        entryUrl,
        title,
        description: boundedString(contribution?.description, 512) ?? '',
        keywords: stringArray(contribution?.keywords, 64).slice(0, 16),
        order,
      });
      seen.add(id);
      continue;
    }
    if (type === 'message.card') {
      const title = boundedString(contribution?.title, 128);
      const requestedItemTypes = stringArray(contribution?.itemTypes, 64);
      const itemTypes = PLUGIN_MESSAGE_ITEM_TYPES.filter((itemType) =>
        requestedItemTypes.includes(itemType));
      const server = boundedString(contribution?.server, 512) ?? null;
      const tools = stringArray(contribution?.tools, 512);
      if (!title || itemTypes.length === 0) continue;
      if (server && (!declaredServers.has(server) || tools.length === 0)) continue;
      if (!server && tools.length > 0) continue;
      result.push({ id, type, entryUrl, title, itemTypes, server, tools, order });
      seen.add(id);
    }
  }
  return result;
}

function boundedOrder(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(-10_000, Math.min(10_000, value))
    : 0;
}

function parsePermissions(
  value: unknown,
  declaredServers: Set<string>,
): Array<{ server: string; tools: string[] }> {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 32).flatMap((raw) => {
    const permission = record(raw);
    const server = boundedString(permission?.server, 512);
    const tools = stringArray(permission?.tools, 512);
    return server && declaredServers.has(server) && tools.length > 0 ? [{ server, tools }] : [];
  });
}

function resolveEntry(root: string, entry: string): string | null {
  try {
    const resolved = realpathSync(path.resolve(root, entry));
    return isInside(root, resolved) && path.extname(resolved) === '.html' ? resolved : null;
  } catch {
    return null;
  }
}

function pluginAssetUrl(pluginId: string, relative: string): string {
  const pathName = relative.split(path.sep).map(encodeURIComponent).join('/');
  return `whale-plugin://plugin/${encodeURIComponent(pluginId)}/${pathName}`;
}

function response(
  body: string | Buffer,
  status: number,
  mime: string,
  html = false,
): Response {
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
