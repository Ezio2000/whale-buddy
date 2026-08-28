import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { codeModeHostFilename, codexFilename, projectRoot } from './lib.mjs';

const codexRepoRoot = path.join(projectRoot, 'codex-source');
const codexRoot = path.join(projectRoot, 'codex-source/codex-rs');
const v8EnvironmentResult = spawnSync(
  'uv',
  [
    'run',
    '--no-project',
    '--python',
    '3.12',
    'python',
    '-c',
    [
      'import json',
      'from codex_package.targets import TARGET_SPECS, default_target',
      'from codex_package.v8 import resolve_codex_v8_cargo_env',
      'print(json.dumps(resolve_codex_v8_cargo_env(TARGET_SPECS[default_target()])))',
    ].join('; '),
  ],
  {
    cwd: codexRepoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      CODEX_REPO_ROOT: codexRepoRoot,
      PYTHONPATH: path.join(codexRepoRoot, 'scripts'),
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  },
);

if (v8EnvironmentResult.error) throw v8EnvironmentResult.error;
if (v8EnvironmentResult.status !== 0) process.exit(v8EnvironmentResult.status ?? 1);

const v8Environment = JSON.parse(v8EnvironmentResult.stdout.trim());
const result = spawnSync(
  'cargo',
  ['build', '--release', '--bin', 'codex', '--bin', 'codex-code-mode-host'],
  {
    cwd: codexRoot,
    stdio: 'inherit',
    env: { ...process.env, ...v8Environment },
  },
);

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

console.log(path.join(codexRoot, 'target', 'release', codexFilename));
console.log(path.join(codexRoot, 'target', 'release', codeModeHostFilename));
