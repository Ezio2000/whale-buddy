import { protocol } from 'electron';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import type { PluginReadResponse } from '../generated/protocol/typescript/v2/PluginReadResponse';
import {
  WHALE_PLUGIN_UI_API_VERSION,
  type PluginUiContribution,
  type PluginUiDescriptor,
} from '../shared/plugin-ui';

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
  const root = resolvePluginRoot(plugin);
  if (!root) return null;
  const manifestPath = path.join(root, '.codex-plugin', 'plugin.json');
  const manifest = parseRecord(readTextInside(root, manifestPath));
  const whale = record(manifest?.whale);
  if (!whale || whale.apiVersion !== WHALE_PLUGIN_UI_API_VERSION) return null;

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
): PluginMcpHttpConnection {
  const root = pluginRoots.get(pluginId);
  if (!root) throw new Error('插件 UI 尚未加载或插件已停用');
  const manifest = parseRecord(readTextInside(root, path.join(root, '.mcp.json')));
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
    if (type === 'composer.widget') {
      result.push({
        id,
        type,
        entryUrl,
        order: typeof contribution?.order === 'number'
          ? Math.max(-10_000, Math.min(10_000, contribution.order))
          : 0,
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
    }
  }
  return result;
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

function resolvePluginRoot(plugin: PluginReadResponse['plugin']): string | null {
  const source = plugin.summary.source;
  const candidates: string[] = [];
  if (source.type === 'local') {
    candidates.push(source.path);
    if (plugin.marketplacePath && !path.isAbsolute(source.path)) {
      const marketplaceRoot = path.resolve(path.dirname(plugin.marketplacePath), '..', '..');
      candidates.push(path.resolve(marketplaceRoot, source.path));
    }
  }
  if (source.type === 'git' && source.path && plugin.marketplacePath) {
    const marketplaceRoot = path.resolve(path.dirname(plugin.marketplacePath), '..', '..');
    candidates.push(path.resolve(marketplaceRoot, source.path));
  }
  for (const skill of plugin.skills) {
    if (!skill.path) continue;
    let current = path.dirname(skill.path);
    for (let depth = 0; depth < 8; depth += 1) {
      if (existsSync(path.join(current, '.codex-plugin', 'plugin.json'))) {
        candidates.push(current);
        break;
      }
      current = path.dirname(current);
    }
  }
  for (const candidate of candidates) {
    try {
      const resolved = realpathSync(candidate);
      if (existsSync(path.join(resolved, '.codex-plugin', 'plugin.json'))) return resolved;
    } catch {
      // Ignore stale catalog paths.
    }
  }
  return null;
}

function resolveEntry(root: string, entry: string): string | null {
  try {
    const resolved = realpathSync(path.resolve(root, entry));
    return isInside(root, resolved) && path.extname(resolved) === '.html' ? resolved : null;
  } catch {
    return null;
  }
}

function readTextInside(root: string, candidate: string): string | null {
  try {
    const resolved = realpathSync(candidate);
    if (!isInside(root, resolved)) return null;
    const contents = readFileSync(resolved, 'utf8');
    return contents.length <= 2_000_000 ? contents : null;
  } catch {
    return null;
  }
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(realpathSync(root), candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
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

function parseRecord(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    return record(JSON.parse(value));
  } catch {
    return null;
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
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
