import { readdir, readFile, rm } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DiagnosticLog } from '../../src/main/diagnostic-log';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('diagnostic log retention', () => {
  it('archives every full raw log without deleting older archives', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'whale-log-'));
    temporaryRoots.push(root);
    const logPath = path.join(root, 'app-server.log');
    const log = new DiagnosticLog(logPath, 1, 1);
    log.write('runtime', 'first');
    log.write('stderr', 'second');
    log.write('protocol', 'third');

    const names = await readdir(root);
    const archives = names.filter((name) => name.startsWith('app-server.log.') && !name.endsWith('.tmp'));
    expect(archives).toHaveLength(2);
    const archivedContents = await Promise.all(archives.map((name) => readFile(path.join(root, name), 'utf8')));
    expect(archivedContents.join('\n')).toContain('first');
    expect(archivedContents.join('\n')).toContain('second');
    expect(await readFile(logPath, 'utf8')).toContain('third');
  });
});
