import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  projectRoot,
  resolveCodeModeHostBinary,
  resolveCodexBinary,
} from './lib.mjs';

try {
  const binary = resolveCodexBinary();
  const codeModeHost = resolveCodeModeHostBinary(binary);
  const version = execFileSync(binary, ['--version'], { encoding: 'utf8' }).trim();
  const manifest = JSON.parse(
    readFileSync(path.join(projectRoot, 'src/generated/protocol/manifest.json'), 'utf8'),
  );
  if (manifest.experimentalApi !== false || manifest.codexVersion !== version) {
    throw new Error(
      `sidecar 与稳定协议不匹配（sidecar=${version}，protocol=${manifest.codexVersion}）。` +
        '请运行 pnpm protocol:generate。',
    );
  }
  if (!process.env.WHALE_CODEX_BIN) {
    const submoduleHead = execFileSync('git', ['-C', 'codex-source', 'rev-parse', 'HEAD'], {
      cwd: projectRoot,
      encoding: 'utf8',
    }).trim();
    if (submoduleHead !== manifest.codexCommit) {
      throw new Error('codex-source 提交与已生成协议不匹配，请运行 pnpm protocol:generate。');
    }
  }
  console.log(`Codex sidecar: ${binary}`);
  console.log(`Code Mode host: ${codeModeHost}`);
  console.log(`Version: ${version}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
