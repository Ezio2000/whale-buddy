import { createHash, randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { LocalAttachment } from '../shared/types';

const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;

const IMAGE_FORMATS = {
  'image/png': { valid: isPng },
  'image/jpeg': { valid: isJpeg },
  'image/gif': { valid: isGif },
  'image/webp': { valid: isWebp },
} as const;

export async function saveClipboardAttachment(
  root: string,
  input: { dataUrl: string; name: string },
): Promise<LocalAttachment> {
  const match = /^data:([^,;]{0,256});base64,([A-Za-z0-9+/=]+)$/.exec(input.dataUrl);
  if (!match) throw new Error('剪贴板文件格式无效');
  const mimeType = match[1].toLowerCase();
  const contents = Buffer.from(match[2], 'base64');
  if (contents.length === 0 || contents.length > MAX_ATTACHMENT_BYTES) {
    throw new Error('剪贴板文件为空或超过 50 MB');
  }

  const imageFormat = IMAGE_FORMATS[mimeType as keyof typeof IMAGE_FORMATS];
  if (imageFormat && !imageFormat.valid(contents)) {
    throw new Error('图片内容与格式不匹配');
  }

  const safeName = sanitizeFileName(input.name);
  const destination = path.join(root, `${Date.now()}-${randomUUID()}-${safeName}`);
  await writeFile(destination, contents, { mode: 0o600, flag: 'wx' });
  return {
    id: randomUUID(),
    name: safeName,
    path: destination,
    kind: imageFormat ? 'image' : 'file',
    mimeType,
    size: contents.length,
    sha256: createHash('sha256').update(contents).digest('hex'),
    originalPath: null,
  };
}

export async function importAttachmentFromPath(root: string, filePath: string): Promise<LocalAttachment> {
  const source = await stat(filePath);
  if (!source.isFile()) throw new Error('只能添加普通文件');
  if (source.size === 0 || source.size > MAX_ATTACHMENT_BYTES) throw new Error('文件为空或超过 50 MB');
  const safeName = sanitizeFileName(path.basename(filePath));
  const id = randomUUID();
  const destination = path.join(root, `${Date.now()}-${id}-${safeName}`);
  await mkdir(root, { recursive: true, mode: 0o700 });
  await copyFile(filePath, destination);
  const contents = await readFile(destination);
  return {
    id,
    name: safeName,
    path: destination,
    kind: /\.(?:png|jpe?g|gif|webp)$/i.test(filePath) ? 'image' : 'file',
    mimeType: inferMimeType(safeName),
    size: source.size,
    sha256: createHash('sha256').update(contents).digest('hex'),
    originalPath: filePath,
  };
}

export function attachmentFromPath(filePath: string): LocalAttachment {
  return {
    name: path.basename(filePath),
    path: filePath,
    kind: /\.(?:png|jpe?g|gif|webp)$/i.test(filePath) ? 'image' : 'file',
  };
}

function inferMimeType(name: string): string {
  const extension = path.extname(name).toLocaleLowerCase();
  return ({
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
    '.webp': 'image/webp', '.pdf': 'application/pdf',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.csv': 'text/csv', '.txt': 'text/plain', '.md': 'text/markdown', '.html': 'text/html',
  } as Record<string, string>)[extension] ?? 'application/octet-stream';
}

function sanitizeFileName(name: string): string {
  const baseName = path.basename(name).replace(/[\u0000-\u001f\u007f]/g, '_').trim();
  return (baseName || 'clipboard-file').slice(-240);
}

function isPng(image: Buffer): boolean {
  return image.length >= 8 && image.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
}

function isJpeg(image: Buffer): boolean {
  return image.length >= 3 && image[0] === 0xff && image[1] === 0xd8 && image[2] === 0xff;
}

function isGif(image: Buffer): boolean {
  const signature = image.subarray(0, 6).toString('ascii');
  return signature === 'GIF87a' || signature === 'GIF89a';
}

function isWebp(image: Buffer): boolean {
  return image.length >= 12
    && image.subarray(0, 4).toString('ascii') === 'RIFF'
    && image.subarray(8, 12).toString('ascii') === 'WEBP';
}
