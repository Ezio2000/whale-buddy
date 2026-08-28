import { EventEmitter, once } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptions } from 'node:child_process';
import {
  AppServerClient,
  AppServerExitedError,
  AppServerRpcError,
  type AppServerWireEvent,
} from '../../src/main/app-server-client';
import { DiagnosticLog } from '../../src/main/diagnostic-log';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

class FakeChild extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  pid = 4242;
  killed = false;
  requestCount = new Map<string, number>();
  received: Array<Record<string, unknown>> = [];
  overloadReads = true;
  overloadWrites = false;
  noResponseMethods = new Set<string>();
  capturedEnv: NodeJS.ProcessEnv | undefined;
  capturedArgs: string[];
  private inputBuffer = '';

  constructor(args: readonly string[], options?: SpawnOptions) {
    super();
    this.capturedArgs = [...args];
    this.capturedEnv = options?.env as NodeJS.ProcessEnv | undefined;
    this.stdin.setEncoding('utf8');
    this.stdin.on('data', (chunk: string) => {
      this.inputBuffer += chunk;
      const lines = this.inputBuffer.split('\n');
      this.inputBuffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line) continue;
        const message = JSON.parse(line) as Record<string, unknown>;
        this.received.push(message);
        this.handle(message);
      }
    });
  }

  send(message: unknown): void {
    this.stdout.write(`${JSON.stringify(message)}\n`);
  }

  sendMalformed(line: string): void {
    this.stdout.write(`${line}\n`);
  }

  kill(signal: NodeJS.Signals = 'SIGTERM'): boolean {
    if (this.killed) return false;
    this.killed = true;
    queueMicrotask(() => {
      this.stdout.end();
      this.stderr.end();
      this.emit('exit', 0, signal);
    });
    return true;
  }

  private handle(message: Record<string, unknown>): void {
    const method = typeof message.method === 'string' ? message.method : null;
    const id = message.id;
    if (!method || typeof id !== 'number') return;
    const count = (this.requestCount.get(method) ?? 0) + 1;
    this.requestCount.set(method, count);
    if (this.noResponseMethods.has(method)) return;
    if (method === 'initialize') {
      this.send({
        id,
        result: {
          userAgent: 'codex-cli/0.0.0 whale_buddy/0.1.0',
          codexHome: this.capturedEnv?.CODEX_HOME,
          platformFamily: 'unix',
          platformOs: 'macos',
        },
      });
    } else if (method === 'model/list' && this.overloadReads && count < 3) {
      this.send({ id, error: { code: -32001, message: 'Server overloaded; retry later.' } });
    } else if (method === 'turn/start' && this.overloadWrites) {
      this.send({ id, error: { code: -32001, message: 'Server overloaded; retry later.' } });
    } else {
      this.send({ id, result: { ok: true, method, count } });
    }
  }
}

async function createClient(
  launchConfiguration?: () => {
    environment: NodeJS.ProcessEnv;
    configOverrides: readonly string[];
  },
  binaryOptions: Pick<
    ConstructorParameters<typeof AppServerClient>[0],
    'binaryArguments' | 'binaryEnvironment'
  > = {},
) {
  const root = await mkdtemp(path.join(tmpdir(), 'whale-client-'));
  temporaryRoots.push(root);
  const children: FakeChild[] = [];
  const spawnFactory = ((_command: string, args: readonly string[], options: SpawnOptions) => {
    const child = new FakeChild(args, options);
    children.push(child);
    return child as unknown as ChildProcessWithoutNullStreams;
  }) as typeof spawn;
  const client = new AppServerClient({
    binaryPath: '/fake/codex',
    sidecarHome: path.join(root, 'sidecar-home'),
    codexHome: path.join(root, 'codex-home'),
    diagnosticLog: new DiagnosticLog(path.join(root, 'diagnostic.log'), 8_192, 2),
    clientVersion: '0.1.0',
    protocolVersion: 'fixture',
    spawnFactory,
    requestTimeoutMs: 80,
    random: () => 0,
    restartDelaysMs: [1, 1, 1],
    stableConnectionMs: 1_000,
    launchConfiguration,
    ...binaryOptions,
  });
  await client.start();
  return { client, children };
}

describe('AppServerClient', () => {
  it('performs initialize/initialized with isolated HOME and CODEX_HOME and routes events', async () => {
    const { client, children } = await createClient();
    const child = children[0];
    expect(client.status().phase).toBe('ready');
    expect(child.capturedEnv?.HOME).toBe(client.status().sidecarHome);
    expect(child.capturedEnv?.USERPROFILE).toBe(client.status().sidecarHome);
    expect(child.capturedEnv?.CODEX_HOME).toBe(client.status().codexHome);
    expect(child.capturedEnv?.XDG_CONFIG_HOME).toBe(
      path.join(client.status().sidecarHome, '.config'),
    );
    expect(child.capturedEnv?.XDG_CACHE_HOME).toBe(
      path.join(client.status().sidecarHome, '.cache'),
    );
    expect(child.capturedEnv?.ZDOTDIR).toBe(path.join(client.status().sidecarHome, '.config'));
    expect(child.capturedArgs).toEqual(['app-server', '--stdio']);
    expect(child.received).toContainEqual(expect.objectContaining({ method: 'initialized' }));

    const wirePromise = once(client, 'wire');
    child.send({ method: 'item/started', params: { threadId: 't', turnId: 'u' } });
    const [wire] = (await wirePromise) as [AppServerWireEvent];
    expect(wire.kind).toBe('notification');
    expect(wire.message.method).toBe('item/started');

    const requestPromise = once(client, 'wire');
    child.send({ id: 99, method: 'item/fileChange/requestApproval', params: { threadId: 't' } });
    const [request] = (await requestPromise) as [AppServerWireEvent];
    expect(request.kind).toBe('serverRequest');
    client.respond(99, { decision: 'accept' });
    expect(child.received).toContainEqual({ id: 99, result: { decision: 'accept' } });
    await client.stop();
  });

  it('passes proxy, provider environment, and safe CLI overrides to the sidecar', async () => {
    const secret = 'provider-secret-not-for-argv';
    const { client, children } = await createClient(() => ({
      environment: {
        PATH: '/usr/bin',
        HOME: '/Users/shared-system-home',
        USERPROFILE: '/Users/shared-system-profile',
        XDG_CONFIG_HOME: '/Users/shared-system-home/.config',
        HTTPS_PROXY: 'http://127.0.0.1:7890',
        WHALE_CUSTOM_PROVIDER_API_KEY: secret,
      },
      configOverrides: [
        'model_provider="fixture"',
        'model_providers.fixture.base_url="https://gateway.example/v1"',
      ],
    }));
    const child = children[0];
    expect(child.capturedEnv).toMatchObject({
      HTTPS_PROXY: 'http://127.0.0.1:7890',
      WHALE_CUSTOM_PROVIDER_API_KEY: secret,
      HOME: client.status().sidecarHome,
      USERPROFILE: client.status().sidecarHome,
      CODEX_HOME: client.status().codexHome,
      XDG_CONFIG_HOME: path.join(client.status().sidecarHome, '.config'),
    });
    expect(child.capturedArgs).toEqual([
      '--config',
      'model_provider="fixture"',
      '--config',
      'model_providers.fixture.base_url="https://gateway.example/v1"',
      'app-server',
      '--stdio',
    ]);
    expect(JSON.stringify(child.capturedArgs)).not.toContain(secret);
    await client.stop();
  });

  it('supports a shell-free executable prefix for the cross-platform E2E sidecar', async () => {
    const { client, children } = await createClient(undefined, {
      binaryArguments: ['C:\\fixtures\\codex.js'],
      binaryEnvironment: { ELECTRON_RUN_AS_NODE: '1' },
    });
    expect(children[0].capturedArgs).toEqual([
      'C:\\fixtures\\codex.js',
      'app-server',
      '--stdio',
    ]);
    expect(children[0].capturedEnv?.ELECTRON_RUN_AS_NODE).toBe('1');
    await client.stop();
  });

  it('retries overloaded read-only calls at most three attempts', async () => {
    const { client, children } = await createClient();
    const result = await client.request('model/list', {});
    expect(result).toMatchObject({ ok: true, count: 3 });
    expect(children[0].requestCount.get('model/list')).toBe(3);
    await client.stop();
  });

  it('never replays a write operation after an overload response', async () => {
    const { client, children } = await createClient();
    children[0].overloadWrites = true;
    await expect(client.request('turn/start', {})).rejects.toBeInstanceOf(AppServerRpcError);
    expect(children[0].requestCount.get('turn/start')).toBe(1);
    await client.stop();
  });

  it('restarts intentionally with a fresh sidecar generation', async () => {
    const { client, children } = await createClient();
    const generation = client.status().generation;
    await client.restart();
    expect(children).toHaveLength(2);
    expect(client.status()).toMatchObject({ phase: 'ready', generation: generation + 1 });
    await client.stop();
  });

  it('times out an unanswered request without replaying it', async () => {
    const { client, children } = await createClient();
    children[0].noResponseMethods.add('thread/read');
    await expect(client.request('thread/read', { threadId: 'missing' })).rejects.toThrow(
      'thread/read 请求超时',
    );
    expect(children[0].requestCount.get('thread/read')).toBe(1);
    await client.stop();
  });

  it('rejects an in-flight write when the process exits and never replays it', async () => {
    const { client, children } = await createClient();
    children[0].noResponseMethods.add('turn/start');
    const pending = client.request('turn/start', {});
    await Promise.resolve();
    children[0].kill('SIGTERM');
    await expect(pending).rejects.toBeInstanceOf(AppServerExitedError);
    expect(children[0].requestCount.get('turn/start')).toBe(1);
    await client.stop();
  });

  it('stops after three consecutive crash-loop restarts', async () => {
    const { client, children } = await createClient();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const generation = client.status().generation;
      children.at(-1)!.kill('SIGTERM');
      await waitForStatus(
        client,
        (status) => status.phase === 'ready' && status.generation > generation,
      );
    }
    children.at(-1)!.kill('SIGTERM');
    await waitForStatus(client, (status) => status.phase === 'faulted');
    expect(children).toHaveLength(4);
    expect(client.status().restartAttempt).toBe(3);
    await client.stop();
  });

  it('treats malformed non-empty stdout as a protocol fault and schedules recovery', async () => {
    const { client, children } = await createClient();
    children[0].sendMalformed('this is not json');
    await once(children[0], 'exit');
    expect(client.status().phase).toBe('reconnecting');
    expect(client.status().restartAttempt).toBe(1);
    await client.stop();
  });
});

function waitForStatus(
  client: AppServerClient,
  predicate: (status: ReturnType<AppServerClient['status']>) => boolean,
): Promise<void> {
  if (predicate(client.status())) return Promise.resolve();
  return new Promise((resolve) => {
    const listener = (status: ReturnType<AppServerClient['status']>) => {
      if (!predicate(status)) return;
      client.off('status', listener);
      resolve();
    };
    client.on('status', listener);
  });
}
