import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type { TurnChangesSnapshot, TurnFileChange } from '../shared/types';

interface FileMetadata {
  size: number;
  mtimeMs: number;
  birthtimeMs: number;
}

interface ActiveTurnSnapshot {
  cwd: string;
  before: Map<string, FileMetadata>;
}

interface TurnChangesState {
  version: 1;
  turns: Record<string, TurnChangesSnapshot>;
}

const MAX_STORED_TURNS = 2_000;
const IGNORED_DIRECTORIES = new Set([
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  '.pnpm-store',
  '__pycache__',
  '.venv',
  'target',
]);
const BINARY_EXTENSIONS = new Set([
  '.7z', '.avi', '.bmp', '.doc', '.docx', '.dmg', '.exe', '.gif', '.gz', '.ico',
  '.jpeg', '.jpg', '.mov', '.mp3', '.mp4', '.pdf', '.png', '.ppt', '.pptx', '.rar',
  '.sqlite', '.tar', '.tif', '.tiff', '.wav', '.webp', '.xls', '.xlsx', '.zip',
]);

export class TurnChangesStore {
  private readonly filePath: string;
  private readonly active = new Map<string, ActiveTurnSnapshot>();
  private state: TurnChangesState;

  constructor(uiStateRoot: string) {
    mkdirSync(uiStateRoot, { recursive: true });
    this.filePath = path.join(uiStateRoot, 'turn-changes.json');
    this.state = this.read();
  }

  async capture(cwd: string): Promise<Map<string, FileMetadata>> {
    return scanWorkspace(cwd);
  }

  begin(turnId: string, cwd: string, before: Map<string, FileMetadata>): void {
    this.active.set(turnId, { cwd, before });
  }

  async complete(turnId: string): Promise<TurnChangesSnapshot | null> {
    const active = this.active.get(turnId);
    if (!active) return null;
    this.active.delete(turnId);
    const after = await scanWorkspace(active.cwd);
    const files = compareWorkspace(active.before, after);
    const previous = this.state.turns[turnId];
    const snapshot: TurnChangesSnapshot = {
      turnId,
      cwd: active.cwd,
      files,
      diff: previous?.diff ?? '',
      updatedAt: Date.now(),
    };
    this.save(snapshot);
    return structuredClone(snapshot);
  }

  saveDiff(turnId: string, diff: string): void {
    const previous = this.state.turns[turnId];
    this.save({
      turnId,
      cwd: previous?.cwd ?? this.active.get(turnId)?.cwd ?? '',
      files: previous?.files ?? [],
      diff,
      updatedAt: Date.now(),
    });
  }

  find(turnIds: Iterable<string>): TurnChangesSnapshot[] {
    const snapshots: TurnChangesSnapshot[] = [];
    for (const turnId of new Set(turnIds)) {
      const snapshot = this.state.turns[turnId];
      if (snapshot) snapshots.push(structuredClone(snapshot));
    }
    return snapshots;
  }

  private save(snapshot: TurnChangesSnapshot): void {
    delete this.state.turns[snapshot.turnId];
    this.state.turns[snapshot.turnId] = snapshot;
    const entries = Object.entries(this.state.turns);
    if (entries.length > MAX_STORED_TURNS) {
      this.state.turns = Object.fromEntries(entries.slice(-MAX_STORED_TURNS));
    }
    const temporaryPath = `${this.filePath}.tmp`;
    writeFileSync(temporaryPath, `${JSON.stringify(this.state, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    renameSync(temporaryPath, this.filePath);
  }

  private read(): TurnChangesState {
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as TurnChangesState;
      if (parsed.version !== 1 || !isSnapshotRecord(parsed.turns)) throw new Error('invalid turn changes state');
      return parsed;
    } catch {
      return { version: 1, turns: {} };
    }
  }
}

async function scanWorkspace(root: string): Promise<Map<string, FileMetadata>> {
  const files = new Map<string, FileMetadata>();
  await scanDirectory(root, '', files);
  return files;
}

async function scanDirectory(
  root: string,
  relativeDirectory: string,
  files: Map<string, FileMetadata>,
): Promise<void> {
  const directory = path.join(root, relativeDirectory);
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }
  await Promise.all(entries.map(async (entry) => {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRECTORIES.has(entry.name)) await scanDirectory(root, relativePath, files);
      return;
    }
    if (!entry.isFile()) return;
    try {
      const metadata = await stat(path.join(root, relativePath));
      files.set(relativePath, {
        size: metadata.size,
        mtimeMs: metadata.mtimeMs,
        birthtimeMs: metadata.birthtimeMs,
      });
    } catch {
      // The file changed again while the snapshot was being collected.
    }
  }));
}

function compareWorkspace(
  before: Map<string, FileMetadata>,
  after: Map<string, FileMetadata>,
): TurnFileChange[] {
  const changes: TurnFileChange[] = [];
  const paths = new Set([...before.keys(), ...after.keys()]);
  for (const filePath of [...paths].sort((left, right) => left.localeCompare(right))) {
    const previous = before.get(filePath);
    const current = after.get(filePath);
    if (!previous && current) {
      changes.push(fileChange(filePath, 'created', current));
    } else if (previous && !current) {
      changes.push(fileChange(filePath, 'deleted', previous));
    } else if (previous && current
      && (previous.size !== current.size || previous.mtimeMs !== current.mtimeMs)) {
      changes.push(fileChange(filePath, 'modified', current));
    }
  }
  return changes;
}

function fileChange(
  filePath: string,
  kind: TurnFileChange['kind'],
  metadata: FileMetadata,
): TurnFileChange {
  return {
    path: filePath,
    kind,
    size: metadata.size,
    binary: BINARY_EXTENSIONS.has(path.extname(filePath).toLowerCase()),
    createdAt: metadata.birthtimeMs,
    modifiedAt: metadata.mtimeMs,
  };
}

function isSnapshotRecord(value: unknown): value is Record<string, TurnChangesSnapshot> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return Object.values(value).every((snapshot) => {
    if (typeof snapshot !== 'object' || snapshot === null || Array.isArray(snapshot)) return false;
    const candidate = snapshot as Partial<TurnChangesSnapshot>;
    return typeof candidate.turnId === 'string'
      && typeof candidate.cwd === 'string'
      && typeof candidate.diff === 'string'
      && typeof candidate.updatedAt === 'number'
      && Array.isArray(candidate.files);
  });
}
