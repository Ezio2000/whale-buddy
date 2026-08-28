import { mkdir, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { TurnChangesStore } from '../../src/main/turn-changes';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('turn workspace changes', () => {
  it('records created, modified, and deleted files outside a Git repository', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'whale-turn-changes-'));
    temporaryRoots.push(root);
    const workspace = path.join(root, 'workspace');
    const uiState = path.join(root, 'ui-state');
    await mkdir(workspace);
    await writeFile(path.join(workspace, 'modified.txt'), 'before');
    await writeFile(path.join(workspace, 'deleted.txt'), 'delete me');

    const store = new TurnChangesStore(uiState);
    const before = await store.capture(workspace);
    store.begin('turn-1', workspace, before);
    await writeFile(path.join(workspace, 'modified.txt'), 'after with more content');
    await unlink(path.join(workspace, 'deleted.txt'));
    await writeFile(path.join(workspace, 'report.xlsx'), 'binary fixture');

    const snapshot = await store.complete('turn-1');
    expect(snapshot?.files.map(({ createdAt: _createdAt, modifiedAt: _modifiedAt, ...file }) => file)).toEqual([
      { path: 'deleted.txt', kind: 'deleted', size: 9, binary: false },
      { path: 'modified.txt', kind: 'modified', size: 23, binary: false },
      { path: 'report.xlsx', kind: 'created', size: 14, binary: true },
    ]);
    expect(snapshot?.files.every((file) => typeof file.createdAt === 'number')).toBe(true);
    expect(snapshot?.files.every((file) => typeof file.modifiedAt === 'number')).toBe(true);

    const restored = new TurnChangesStore(uiState);
    expect(restored.find(['turn-1'])).toEqual([snapshot]);
  });
});
