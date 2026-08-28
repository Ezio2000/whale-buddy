import { existsSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import type { PluginReadResponse } from '../generated/protocol/typescript/v2/PluginReadResponse';

export interface WhalePluginManifest {
  root: string;
  manifest: Record<string, unknown>;
  whale: Record<string, unknown>;
}

export function readWhalePluginManifest(response: PluginReadResponse): WhalePluginManifest | null {
  const root = resolvePluginRoot(response.plugin);
  if (!root) return null;
  const manifest = readJsonInside(root, path.join(root, '.codex-plugin', 'plugin.json'));
  const whale = record(manifest?.whale);
  return manifest && whale ? { root, manifest, whale } : null;
}

export function resolvePluginRoot(plugin: PluginReadResponse['plugin']): string | null {
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

export function readTextInside(root: string, candidate: string): string | null {
  try {
    const resolvedRoot = realpathSync(root);
    const resolvedFile = realpathSync(
      path.isAbsolute(candidate) ? candidate : path.resolve(root, candidate),
    );
    const relative = path.relative(resolvedRoot, resolvedFile);
    if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
    const contents = readFileSync(resolvedFile, 'utf8');
    return contents.length <= 2_000_000 ? contents : null;
  } catch {
    return null;
  }
}

export function readJsonInside(
  root: string,
  candidate: string,
): Record<string, unknown> | null {
  const contents = readTextInside(root, candidate);
  if (!contents) return null;
  try {
    return record(JSON.parse(contents));
  } catch {
    return null;
  }
}

export function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(realpathSync(root), candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
