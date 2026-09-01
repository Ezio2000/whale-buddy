import { readFile, rm } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ArtifactStore } from '../../src/main/artifacts';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('artifact store', () => {
  it('stores deterministic office bytes and restores the permanent index', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'whale-artifacts-'));
    temporaryRoots.push(root);
    const bytes = Buffer.from('<!doctype html><title>Whale</title>', 'utf8');
    const created = new ArtifactStore(root).create({
      name: '../quarterly-report.html',
      format: 'html',
      dataBase64: bytes.toString('base64'),
      threadId: 'thread-1',
      taskId: 'task-1',
    });

    expect(created).toMatchObject({
      name: 'quarterly-report.html',
      format: 'html',
      mimeType: 'text/html',
      size: bytes.length,
      threadId: 'thread-1',
    });
    expect(await readFile(created.path)).toEqual(bytes);
    expect(new ArtifactStore(root).list('thread-1')).toEqual([created]);
  });

  it('rejects empty artifacts', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'whale-artifacts-'));
    temporaryRoots.push(root);
    expect(() => new ArtifactStore(root).create({
      name: 'empty.xlsx', format: 'xlsx', dataBase64: '', threadId: 'thread-1', taskId: 'task-1',
    })).toThrow('成果文件为空');
  });

  it('stores PowerPoint artifacts with the correct extension and MIME type', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'whale-artifacts-'));
    temporaryRoots.push(root);
    const bytes = Buffer.from('pptx-bytes');
    const created = new ArtifactStore(root).create({
      name: '季度复盘', format: 'pptx', dataBase64: bytes.toString('base64'), threadId: 'thread-2', taskId: 'task-2',
    });
    expect(created.name).toBe('季度复盘.pptx');
    expect(created.mimeType).toBe('application/vnd.openxmlformats-officedocument.presentationml.presentation');
  });
});
