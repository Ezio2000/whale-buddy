import { readFile, rm, stat, writeFile } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { importAttachmentFromPath, saveClipboardAttachment } from '../../src/main/clipboard-attachments';
import { currentPlatformStrategy } from '../../src/platform';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('clipboard attachments', () => {
  it('stores a regular file in the private attachment directory', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'whale-attachment-'));
    temporaryRoots.push(root);
    const contents = Buffer.from('hello whale');

    const saved = await saveClipboardAttachment(root, {
      name: 'notes.txt',
      dataUrl: `data:text/plain;base64,${contents.toString('base64')}`,
    });

    expect(saved).toMatchObject({ name: 'notes.txt', kind: 'file' });
    expect(path.dirname(saved.path)).toBe(root);
    expect(await readFile(saved.path)).toEqual(contents);
    if (currentPlatformStrategy().enforcesPrivateMode) {
      expect((await stat(saved.path)).mode & 0o777).toBe(0o600);
    }
  });

  it('recognizes a validated image as an image attachment', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'whale-attachment-'));
    temporaryRoots.push(root);
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

    const saved = await saveClipboardAttachment(root, {
      name: 'pasted.png',
      dataUrl: `data:image/png;base64,${png.toString('base64')}`,
    });

    expect(saved).toMatchObject({ name: 'pasted.png', kind: 'image' });
  });

  it('rejects data whose bytes do not match the declared image type', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'whale-attachment-'));
    temporaryRoots.push(root);
    await expect(saveClipboardAttachment(root, {
      name: 'bad.png',
      dataUrl: `data:image/png;base64,${Buffer.from('not an image').toString('base64')}`,
    })).rejects.toThrow('图片内容与格式不匹配');
  });

  it('copies a picked office file into Whale storage with provenance and a hash', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'whale-attachment-'));
    temporaryRoots.push(root);
    const source = path.join(root, 'source.docx');
    await writeFile(source, Buffer.from('fixture-docx'));
    const attachmentRoot = path.join(root, 'saved');

    const saved = await importAttachmentFromPath(attachmentRoot, source);

    expect(saved).toMatchObject({ name: 'source.docx', kind: 'file', originalPath: source, size: 12 });
    expect(saved.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(path.dirname(saved.path)).toBe(attachmentRoot);
    expect(await readFile(saved.path)).toEqual(Buffer.from('fixture-docx'));
  });
});
