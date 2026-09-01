import { statSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { prepareDataDirectories } from '../../src/main/data-directories';
import { currentPlatformStrategy } from '../../src/platform';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('isolated application data', () => {
  it('places the sidecar home, Codex home, and UI state in separate private directories', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'whale-data-'));
    temporaryRoots.push(root);
    const directories = prepareDataDirectories(root);

    expect(directories.sidecarHome).toBe(path.join(root, 'sidecar-home'));
    expect(directories.codexHome).toBe(path.join(root, 'codex-home'));
    expect(directories.uiStateRoot).toBe(path.join(root, 'ui-state'));
    expect(directories.attachmentsRoot).toBe(path.join(root, 'ui-state', 'attachments'));
    expect(directories.artifactsRoot).toBe(path.join(root, 'ui-state', 'artifacts'));
    expect(directories.codexHome).not.toBe(path.join(process.env.HOME ?? '', '.codex'));
    for (const directory of Object.values(directories)) {
      if (currentPlatformStrategy().enforcesPrivateMode) {
        expect(statSync(directory).mode & 0o777).toBe(0o700);
      }
    }
    for (const directory of [
      path.join(directories.sidecarHome, '.agents', 'skills'),
      path.join(directories.sidecarHome, '.agents', 'plugins'),
      path.join(directories.sidecarHome, '.cache'),
      path.join(directories.sidecarHome, '.config'),
      path.join(directories.sidecarHome, '.local', 'share'),
      path.join(directories.sidecarHome, '.local', 'state'),
    ]) {
      if (currentPlatformStrategy().enforcesPrivateMode) {
        expect(statSync(directory).mode & 0o777).toBe(0o700);
      }
    }
  });

  it('removes standalone MCP tables before the sidecar starts', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'whale-data-'));
    temporaryRoots.push(root);
    const codexHome = path.join(root, 'codex-home');
    await writeFile(path.join(root, 'seed'), '');
    const directories = prepareDataDirectories(root);
    await writeFile(path.join(codexHome, 'config.toml'), [
      'model = "fixture"',
      '',
      '[mcp_servers.standalone]',
      'url = "https://example.test/mcp"',
      '',
      '[mcp_servers.standalone.tools.search]',
      'enabled = true',
      '',
      '[plugins."fixture@marketplace"]',
      'enabled = true',
      '',
    ].join('\n'));

    prepareDataDirectories(root);

    expect(await readFile(path.join(directories.codexHome, 'config.toml'), 'utf8')).toBe([
      'model = "fixture"',
      '',
      '[plugins."fixture@marketplace"]',
      'enabled = true',
      '',
    ].join('\n'));
  });
});
