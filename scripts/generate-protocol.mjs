import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { projectRoot, resolveCodexBinary } from './lib.mjs';

const binary = resolveCodexBinary();
const generatedRoot = path.join(projectRoot, 'src/generated/protocol');
const typescriptRoot = path.join(generatedRoot, 'typescript');
const jsonRoot = path.join(generatedRoot, 'json');

rmSync(generatedRoot, { recursive: true, force: true });
mkdirSync(typescriptRoot, { recursive: true });
mkdirSync(jsonRoot, { recursive: true });

execFileSync(binary, ['app-server', 'generate-ts', '--out', typescriptRoot], {
  cwd: projectRoot,
  stdio: 'inherit',
});
execFileSync(binary, ['app-server', 'generate-json-schema', '--out', jsonRoot], {
  cwd: projectRoot,
  stdio: 'inherit',
});

const versionOutput = execFileSync(binary, ['--version'], { encoding: 'utf8' }).trim();
const submoduleHead = execFileSync('git', ['-C', 'codex-source', 'rev-parse', 'HEAD'], {
  cwd: projectRoot,
  encoding: 'utf8',
}).trim();
const packageJson = JSON.parse(readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));

writeFileSync(
  path.join(generatedRoot, 'manifest.json'),
  `${JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      codexVersion: versionOutput,
      codexCommit: submoduleHead,
      clientVersion: packageJson.version,
      experimentalApi: false,
    },
    null,
    2,
  )}\n`,
);

console.log(`稳定协议已生成到 ${path.relative(projectRoot, generatedRoot)}`);
