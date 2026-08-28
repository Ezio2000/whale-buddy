import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { resolveCodexBinary } from './lib.mjs';

const binary = resolveCodexBinary();
const isolatedRoot = mkdtempSync(path.join(tmpdir(), 'whale-sidecar-'));
const sidecarHome = path.join(isolatedRoot, 'sidecar-home');
const codexHome = path.join(isolatedRoot, 'codex-home');
const workspace = path.join(isolatedRoot, 'workspace');
for (const directory of [
  sidecarHome,
  path.join(sidecarHome, '.cache'),
  path.join(sidecarHome, '.config'),
  path.join(sidecarHome, '.local', 'share'),
  path.join(sidecarHome, '.local', 'state'),
  codexHome,
  workspace,
]) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
}
const child = spawn(binary, [
  '--config', 'features.apps=false',
  '--config', 'features.plugins=false',
  '--config', 'features.remote_plugin=false',
  '--config', 'features.recommended_plugins=false',
  '--config', 'features.tool_suggest=false',
  '--config', 'skills.bundled.enabled=false',
  '--config', 'skills.include_instructions=false',
  'app-server',
  '--stdio',
], {
  cwd: workspace,
  env: {
    ...process.env,
    HOME: sidecarHome,
    USERPROFILE: sidecarHome,
    CODEX_HOME: codexHome,
    XDG_CONFIG_HOME: path.join(sidecarHome, '.config'),
    XDG_CACHE_HOME: path.join(sidecarHome, '.cache'),
    XDG_DATA_HOME: path.join(sidecarHome, '.local', 'share'),
    XDG_STATE_HOME: path.join(sidecarHome, '.local', 'state'),
    ZDOTDIR: path.join(sidecarHome, '.config'),
  },
  stdio: ['pipe', 'pipe', 'pipe'],
});
const childExit = new Promise((resolve) => child.once('exit', resolve));

let nextId = 0;
let stdoutBuffer = '';
const pending = new Map();

function request(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(String(id));
      reject(new Error(`${method} timed out`));
    }, 15_000);
    pending.set(String(id), { resolve, reject, timer });
    child.stdin.write(`${JSON.stringify({ method, id, params })}\n`, (error) => {
      if (!error) return;
      clearTimeout(timer);
      pending.delete(String(id));
      reject(error);
    });
  });
}

child.stdout.setEncoding('utf8');
child.stdout.on('data', (chunk) => {
  stdoutBuffer += chunk;
  const lines = stdoutBuffer.split('\n');
  stdoutBuffer = lines.pop() ?? '';
  for (const line of lines) {
    if (!line.trim()) continue;
    const message = JSON.parse(line);
    if (message.id === undefined || message.method) continue;
    const entry = pending.get(String(message.id));
    if (!entry) continue;
    clearTimeout(entry.timer);
    pending.delete(String(message.id));
    if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
    else entry.resolve(message.result);
  }
});
child.stderr.setEncoding('utf8');
child.stderr.on('data', (chunk) => process.stderr.write(chunk));

try {
  const initialized = await request('initialize', {
    clientInfo: { name: 'whale_buddy', title: 'Whale Buddy smoke test', version: '0.1.0' },
    capabilities: { experimentalApi: false, requestAttestation: false },
  });
  child.stdin.write(`${JSON.stringify({ method: 'initialized' })}\n`);
  const account = await request('account/read', { refreshToken: false });
  const models = await request('model/list', { limit: 5, includeHidden: false });
  const skills = await request('skills/list', { cwds: [workspace], forceReload: true });
  const mcp = await request('mcpServerStatus/list', { cursor: null, limit: 100 });
  const plugins = await request('plugin/list', {
    cwds: null,
    marketplaceKinds: ['local'],
    forceRefetch: false,
  });
  const started = await request('thread/start', {
    cwd: workspace,
    approvalPolicy: 'never',
    sandbox: 'read-only',
  });
  // A brand-new thread is intentionally not materialized until it has history.
  // Inject a local Responses API item so pagination can be exercised without
  // credentials, a model call, or any network access.
  await request('thread/inject_items', {
    threadId: started.thread.id,
    items: [
      {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'Whale Buddy smoke history' }],
      },
    ],
  });
  const listed = await request('thread/list', {
    limit: 5,
    cwd: workspace,
    sourceKinds: ['appServer'],
  });
  const turns = await request('thread/turns/list', {
    threadId: started.thread.id,
    limit: 5,
    sortDirection: 'asc',
    itemsView: 'summary',
  });
  const items = await request('thread/items/list', {
    threadId: started.thread.id,
    limit: 5,
    sortDirection: 'asc',
  });
  if (!account || !Array.isArray(models?.data) || !started?.thread?.id || !Array.isArray(listed?.data)) {
    throw new Error('account, model, thread start, or thread list response was malformed');
  }
  if (!Array.isArray(turns?.data) || !Array.isArray(items?.data)) {
    throw new Error('paginated thread history responses were malformed');
  }
  const discoveredSkills = skills?.data?.flatMap((entry) => entry.skills ?? []) ?? [];
  if (discoveredSkills.length || mcp?.data?.length || plugins?.marketplaces?.length) {
    throw new Error('fresh runtime unexpectedly loaded Skills, MCP servers, or plugin catalogs');
  }
  console.log(`Smoke test passed (${initialized.userAgent}, isolated HOME/CODEX_HOME and zero extensions).`);
} finally {
  child.kill('SIGTERM');
  for (const entry of pending.values()) clearTimeout(entry.timer);
  await Promise.race([
    childExit,
    new Promise((resolve) => setTimeout(resolve, 2_000)),
  ]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await childExit;
  }
  rmSync(isolatedRoot, { recursive: true, force: true });
}
