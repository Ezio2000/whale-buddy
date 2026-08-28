import { opendir } from 'node:fs/promises';
import path from 'node:path';
import type { FileSearchResult } from '../shared/types';
import { normalizeProjectPath } from './projects';

const IGNORED_DIRECTORIES = new Set([
  '.git',
  '.idea',
  '.next',
  '.vite',
  'coverage',
  'dist',
  'node_modules',
  'out',
  'target',
]);

export async function searchProjectFiles(
  projectPath: string,
  query: string,
  limit = 50,
): Promise<FileSearchResult[]> {
  const root = normalizeProjectPath(projectPath);
  const needle = query.trim().toLocaleLowerCase();
  const results: Array<FileSearchResult & { score: number }> = [];
  const queue = [root];
  let visited = 0;

  while (queue.length > 0 && visited < 20_000) {
    const directory = queue.shift();
    if (!directory) break;
    let handle;
    try {
      handle = await opendir(directory);
    } catch {
      continue;
    }

    for await (const entry of handle) {
      visited += 1;
      if (entry.name.startsWith('.') && entry.name !== '.env.example') continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) queue.push(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      const relativePath = path.relative(root, absolute);
      const haystack = relativePath.toLocaleLowerCase();
      if (needle && !haystack.includes(needle)) continue;
      const fileName = entry.name.toLocaleLowerCase();
      const score = needle
        ? fileName === needle
          ? 0
          : fileName.startsWith(needle)
            ? 1
            : haystack.startsWith(needle)
              ? 2
              : 3
        : 4;
      results.push({ name: entry.name, path: absolute, relativePath, score });
    }
  }

  return results
    .sort((left, right) => left.score - right.score || left.relativePath.localeCompare(right.relativePath))
    .slice(0, limit)
    .map(({ score: _score, ...result }) => result);
}
