import { randomUUID } from 'node:crypto';
import {
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import type { LocalProject } from '../shared/types';

interface ProjectState {
  version: 1;
  projects: LocalProject[];
}

export function normalizeProjectPath(input: string): string {
  const canonical = realpathSync.native(path.resolve(input));
  if (!statSync(canonical).isDirectory()) throw new Error('选择的路径不是目录');
  return canonical.replace(/\/$/, '') || '/';
}

export function projectForCwd(projects: LocalProject[], cwd: string): LocalProject | null {
  const normalizedCwd = path.resolve(cwd);
  return (
    projects
      .filter((project) => isPathInside(normalizedCwd, project.path))
      .sort((a, b) => b.path.length - a.path.length)[0] ?? null
  );
}

function isPathInside(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export class ProjectStore {
  private readonly filePath: string;

  constructor(uiStateRoot: string) {
    mkdirSync(uiStateRoot, { recursive: true });
    this.filePath = path.join(uiStateRoot, 'projects.json');
  }

  list(): LocalProject[] {
    return [...this.read().projects].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
  }

  add(directory: string): LocalProject {
    const normalized = normalizeProjectPath(directory);
    const state = this.read();
    const existing = state.projects.find((project) => project.path === normalized);
    if (existing) {
      existing.lastOpenedAt = Date.now();
      this.write(state);
      return existing;
    }
    const project: LocalProject = {
      id: randomUUID(),
      path: normalized,
      name: path.basename(normalized) || normalized,
      lastOpenedAt: Date.now(),
    };
    state.projects.push(project);
    this.write(state);
    return project;
  }

  remove(projectId: string): void {
    const state = this.read();
    state.projects = state.projects.filter((project) => project.id !== projectId);
    this.write(state);
  }

  private read(): ProjectState {
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as ProjectState;
      if (parsed.version !== 1 || !Array.isArray(parsed.projects)) throw new Error('invalid project state');
      return parsed;
    } catch {
      return { version: 1, projects: [] };
    }
  }

  private write(state: ProjectState): void {
    const temporaryPath = `${this.filePath}.tmp`;
    writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    renameSync(temporaryPath, this.filePath);
  }
}
