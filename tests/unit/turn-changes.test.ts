import { mkdir, mkdtemp, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { TurnChangesStore } from '../../src/main/turn-changes';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('turn workspace changes', () => {
  it('previews current UTF-8 files from a saved turn and rejects unsupported or unrecorded files', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'whale-preview-'));
    temporaryRoots.push(root);
    const workspace = path.join(root, 'workspace');
    await mkdir(workspace);
    await writeFile(path.join(workspace, 'deleted.txt'), 'before');
    const store = new TurnChangesStore(path.join(root, 'state'));
    store.begin('preview', workspace, await store.capture(workspace));
    await unlink(path.join(workspace, 'deleted.txt'));
    await writeFile(path.join(workspace, 'hello.py'), 'print("你好")');
    await writeFile(path.join(workspace, 'empty.txt'), '');
    await writeFile(path.join(workspace, 'large.txt'), 'x'.repeat(128 * 1024 + 1));
    await writeFile(path.join(workspace, 'binary.dat'), Buffer.from([0, 1, 2]));
    await writeFile(path.join(workspace, 'invalid.txt'), Buffer.from([255]));
    await store.complete('preview');
    const restored = new TurnChangesStore(path.join(root, 'state'));
    await writeFile(path.join(workspace, 'hello.py'), 'print("current")');
    await expect(restored.readPreview('preview', 'hello.py')).resolves.toBe('print("current")');
    await expect(restored.readPreview('preview', './hello.py')).resolves.toBe('print("current")');
    await expect(restored.readPreview('preview', 'empty.txt')).resolves.toBe('');
    await expect(restored.readPreview('preview', 'large.txt')).rejects.toThrow('128 KB');
    await expect(restored.readPreview('preview', 'binary.dat')).rejects.toThrow('不支持文本预览');
    await expect(restored.readPreview('preview', 'invalid.txt')).rejects.toThrow('UTF-8');
    await expect(restored.readPreview('preview', 'deleted.txt')).rejects.toThrow('文件已删除');
    await expect(restored.readPreview('preview', '../outside.txt')).rejects.toThrow('只能预览当前项目内');
    await expect(restored.readPreview('unknown', 'hello.py')).rejects.toThrow('找不到本轮任务工作目录');

    await writeFile(path.join(root, 'outside.txt'), 'outside');
    await unlink(path.join(workspace, 'hello.py'));
    await symlink(path.join(root, 'outside.txt'), path.join(workspace, 'hello.py'));
    await expect(restored.readPreview('preview', 'hello.py')).rejects.toThrow('只能预览当前项目内');
  });

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
