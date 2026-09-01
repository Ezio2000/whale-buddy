import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ArtifactCreateInput, ArtifactRecord } from '../shared/types';

interface ArtifactState { version: 1; artifacts: ArtifactRecord[] }
const MAX_ARTIFACT_BYTES = 50 * 1024 * 1024;

export class ArtifactStore {
  private readonly indexPath: string;
  private state: ArtifactState;

  constructor(private readonly root: string) {
    mkdirSync(root, { recursive: true, mode: 0o700 });
    this.indexPath = path.join(root, 'artifacts.json');
    this.state = this.read();
  }

  create(input: ArtifactCreateInput): ArtifactRecord {
    const data = Buffer.from(input.dataBase64, 'base64');
    if (data.length === 0 || data.length > MAX_ARTIFACT_BYTES) throw new Error('成果文件为空或超过 50 MB');
    const extension = extensionFor(input.format);
    const requestedName = path.basename(input.name).replace(/[\u0000-\u001f\u007f]/g, '_').trim();
    const base = (requestedName || `办公成果.${extension}`).replace(new RegExp(`\\.${extension}$`, 'i'), '');
    const id = randomUUID();
    const name = `${base.slice(0, 220)}.${extension}`;
    const filePath = path.join(this.root, `${Date.now()}-${id}-${name}`);
    writeFileSync(filePath, data, { flag: 'wx', mode: 0o600 });
    const record: ArtifactRecord = {
      id, name, path: filePath, format: input.format, mimeType: mimeFor(input.format),
      size: data.length, sha256: createHash('sha256').update(data).digest('hex'),
      threadId: input.threadId, taskId: input.taskId, createdAt: Date.now(),
    };
    this.state.artifacts.push(record);
    this.persist();
    return structuredClone(record);
  }

  list(threadId?: string): ArtifactRecord[] {
    return this.state.artifacts
      .filter((artifact) => !threadId || artifact.threadId === threadId)
      .filter((artifact) => existsSync(artifact.path))
      .map((artifact) => structuredClone(artifact));
  }

  require(id: string): ArtifactRecord {
    const artifact = this.state.artifacts.find((entry) => entry.id === id);
    if (!artifact || !existsSync(artifact.path)) throw new Error('成果文件不存在');
    return structuredClone(artifact);
  }

  private read(): ArtifactState {
    try {
      const value = JSON.parse(readFileSync(this.indexPath, 'utf8')) as ArtifactState;
      if (value.version !== 1 || !Array.isArray(value.artifacts)) throw new Error('invalid artifact state');
      return value;
    } catch { return { version: 1, artifacts: [] }; }
  }

  private persist(): void {
    const temporary = `${this.indexPath}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(this.state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    renameSync(temporary, this.indexPath);
  }
}

function extensionFor(format: ArtifactCreateInput['format']): string { return format; }
function mimeFor(format: ArtifactCreateInput['format']): string {
  if (format === 'html') return 'text/html';
  if (format === 'docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (format === 'xlsx') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
}
