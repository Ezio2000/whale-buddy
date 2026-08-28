import { mkdirSync, realpathSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { normalizeProjectPath, projectForCwd, ProjectStore } from '../../src/main/projects';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('project persistence and ownership', () => {
  it('normalizes paths, deduplicates projects, and persists UI state separately', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'whale-projects-'));
    temporaryRoots.push(root);
    const workspace = path.join(root, 'repo');
    const uiState = path.join(root, 'ui-state');
    mkdirSync(workspace);
    const store = new ProjectStore(uiState);

    const first = store.add(`${workspace}/`);
    const second = store.add(workspace);
    expect(first.id).toBe(second.id);
    expect(first.path).toBe(realpathSync.native(workspace));
    expect(store.list()).toHaveLength(1);
    expect(normalizeProjectPath(workspace)).toBe(first.path);
  });

  it('assigns a cwd to the deepest nested project root', () => {
    const projects = [
      { id: 'outer', path: '/repo', name: 'repo', lastOpenedAt: 1 },
      { id: 'inner', path: '/repo/packages/app', name: 'app', lastOpenedAt: 2 },
    ];
    expect(projectForCwd(projects, '/repo/packages/app/src')).toMatchObject({ id: 'inner' });
    expect(projectForCwd(projects, '/repo/other')).toMatchObject({ id: 'outer' });
    expect(projectForCwd(projects, '/repository')).toBeNull();
  });
});
