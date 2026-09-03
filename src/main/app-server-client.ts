import { EventEmitter } from 'node:events';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import type { RuntimeStatus } from '../shared/types';
import { DiagnosticLog } from './diagnostic-log';
import { experimentalApi } from './experimental-api';
import { JsonlFramer } from './jsonl';

type RequestId = number;

interface RpcErrorShape {
  code: number;
  message: string;
  data?: unknown;
}

interface PendingRequest {
  method: string;
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export class AppServerRpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = 'AppServerRpcError';
  }
}

export class AppServerExitedError extends Error {
  constructor(message = 'app-server 已退出') {
    super(message);
    this.name = 'AppServerExitedError';
  }
}

export interface AppServerClientOptions {
  binaryPath: string;
  binaryArguments?: readonly string[];
  binaryEnvironment?: NodeJS.ProcessEnv;
  sidecarHome: string;
  codexHome: string;
  diagnosticLog: DiagnosticLog;
  clientVersion: string;
  clientTitle?: () => string;
  protocolVersion: string | null;
  expectedCodexVersion?: string | null;
  requestTimeoutMs?: number;
  spawnFactory?: typeof spawn;
  random?: () => number;
  restartDelaysMs?: readonly number[];
  stableConnectionMs?: number;
  launchConfiguration?: () => {
    environment: NodeJS.ProcessEnv;
    configOverrides: readonly string[];
  };
}

const READ_ONLY_METHODS = new Set([
  'account/read',
  'account/rateLimits/read',
  'account/usage/read',
  'config/read',
  'configRequirements/read',
  'model/list',
  'mcpServerStatus/list',
  'plugin/list',
  'plugin/read',
  'skills/list',
  'thread/list',
  'thread/loaded/list',
  'thread/read',
  'thread/turns/list',
  'thread/items/list',
]);

const RESTART_DELAYS = [500, 1_000, 2_000] as const;
const STABLE_CONNECTION_MS = 30_000;

export interface AppServerWireEvent {
  generation: number;
  sequence: number;
  message: Record<string, unknown>;
  kind: 'notification' | 'serverRequest';
}

export class AppServerClient extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null;
  private readonly framer = new JsonlFramer();
  private readonly pending = new Map<RequestId, PendingRequest>();
  private readonly spawnFactory: typeof spawn;
  private readonly requestTimeoutMs: number;
  private readonly random: () => number;
  private readonly restartDelays: readonly number[];
  private readonly stableConnectionMs: number;
  private nextRequestId = 1;
  private sequence = 0;
  private generation = 0;
  private restartAttempt = 0;
  private intentionalStop = false;
  private protocolFault = false;
  private startPromise: Promise<void> | null = null;
  private restartTimer: NodeJS.Timeout | null = null;
  private stabilityTimer: NodeJS.Timeout | null = null;
  private currentStatus: RuntimeStatus;

  constructor(private readonly options: AppServerClientOptions) {
    super();
    this.spawnFactory = options.spawnFactory ?? spawn;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
    this.random = options.random ?? Math.random;
    this.restartDelays = options.restartDelaysMs ?? RESTART_DELAYS;
    this.stableConnectionMs = options.stableConnectionMs ?? STABLE_CONNECTION_MS;
    this.currentStatus = {
      phase: 'stopped',
      generation: 0,
      pid: null,
      codexVersion: null,
      protocolVersion: options.protocolVersion,
      sidecarHome: options.sidecarHome,
      codexHome: options.codexHome,
      diagnosticLog: options.diagnosticLog.filePath,
      restartAttempt: 0,
      message: null,
    };
  }

  status(): RuntimeStatus {
    return { ...this.currentStatus };
  }

  async start(): Promise<void> {
    if (this.currentStatus.phase === 'ready') return;
    if (this.startPromise) return this.startPromise;
    this.intentionalStop = false;
    this.startPromise = this.startConnection().finally(() => {
      this.startPromise = null;
    });
    return this.startPromise;
  }

  async restart(): Promise<void> {
    this.clearRestartTimer();
    this.clearStabilityTimer();
    this.intentionalStop = true;
    await this.stopChild();
    this.setStatus({ phase: 'stopped', pid: null, message: null });
    this.intentionalStop = false;
    this.restartAttempt = 0;
    await this.start();
  }

  async stop(): Promise<void> {
    this.intentionalStop = true;
    this.clearRestartTimer();
    this.clearStabilityTimer();
    await this.stopChild();
    this.setStatus({ phase: 'stopped', pid: null, message: null });
  }

  async request(method: string, params?: unknown): Promise<unknown> {
    await this.start();
    if (this.currentStatus.phase !== 'ready') {
      throw new Error(this.currentStatus.message ?? `${this.brandName()} app-server 尚未就绪`);
    }

    const maxAttempts = READ_ONLY_METHODS.has(method) ? 3 : 1;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await this.rawRequest(method, params);
      } catch (error) {
        const retryable = error instanceof AppServerRpcError && error.code === -32001;
        if (!retryable || attempt >= maxAttempts) throw error;
        const exponential = 120 * 2 ** (attempt - 1);
        const jitter = Math.round(this.random() * 80);
        await new Promise((resolve) => setTimeout(resolve, exponential + jitter));
      }
    }
    throw new Error(`请求 ${method} 失败`);
  }

  respond(id: string | number, result: unknown): void {
    this.write({ id, result });
  }

  reject(id: string | number, code: number, message: string): void {
    this.write({ id, error: { code, message } });
  }

  private async startConnection(): Promise<void> {
    this.setStatus({
      phase: this.restartAttempt > 0 ? 'reconnecting' : 'starting',
      message: null,
      restartAttempt: this.restartAttempt,
    });
    this.protocolFault = false;
    this.clearStabilityTimer();
    this.framer.reset();
    this.sequence = 0;
    this.generation += 1;

    let child: ChildProcessWithoutNullStreams;
    try {
      const launch = this.options.launchConfiguration?.() ?? {
        environment: process.env,
        configOverrides: [],
      };
      const args: string[] = [...(this.options.binaryArguments ?? [])];
      for (const override of launch.configOverrides) args.push('--config', override);
      args.push('app-server', '--stdio');
      child = this.spawnFactory(this.options.binaryPath, args, {
        env: isolatedSidecarEnvironment(
          { ...launch.environment, ...this.options.binaryEnvironment },
          this.options.sidecarHome,
          this.options.codexHome,
        ),
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (error) {
      const message = `无法启动 ${this.brandName()} sidecar：${error instanceof Error ? error.message : String(error)}`;
      this.options.diagnosticLog.write('runtime', message);
      this.setStatus({ phase: 'unavailable', pid: null, message });
      throw new Error(message);
    }

    this.child = child;
    this.attachChild(child);
    this.setStatus({ generation: this.generation, pid: child.pid ?? null });

    try {
      const initialized = (await this.rawRequest('initialize', {
        clientInfo: {
          name: 'whale_buddy',
          title: this.brandName(),
          version: this.options.clientVersion,
        },
        capabilities: {
          experimentalApi: experimentalApi.enabled,
          requestAttestation: false,
        },
      })) as { userAgent?: unknown; codexHome?: unknown };

      const returnedHome = typeof initialized.codexHome === 'string' ? initialized.codexHome : null;
      if (!returnedHome || path.resolve(returnedHome) !== path.resolve(this.options.codexHome)) {
        throw new Error('sidecar 返回了非隔离的 CODEX_HOME，已拒绝连接');
      }

      this.write({ method: 'initialized' });
      this.setStatus({
        phase: 'ready',
        codexVersion:
          typeof initialized.userAgent === 'string'
            ? initialized.userAgent
            : this.options.expectedCodexVersion ?? null,
        restartAttempt: this.restartAttempt,
        message: null,
      });
      if (this.restartAttempt > 0) {
        const connectedChild = child;
        this.stabilityTimer = setTimeout(() => {
          this.stabilityTimer = null;
          if (this.child !== connectedChild || this.currentStatus.phase !== 'ready') return;
          this.restartAttempt = 0;
          this.setStatus({ restartAttempt: 0 });
        }, this.stableConnectionMs);
      }
      this.options.diagnosticLog.write('runtime', 'app-server initialize 握手完成');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.options.diagnosticLog.write('protocol', `初始化失败：${message}`);
      this.protocolFault = true;
      child.kill('SIGTERM');
      throw error;
    }
  }

  private attachChild(child: ChildProcessWithoutNullStreams): void {
    child.stdout.on('data', (chunk: Buffer) => {
      for (const line of this.framer.push(chunk)) this.handleLine(line);
    });
    child.stdout.on('end', () => {
      for (const line of this.framer.finish()) this.handleLine(line);
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      this.options.diagnosticLog.write('stderr', chunk);
    });
    child.on('error', (error) => {
      this.options.diagnosticLog.write('runtime', `sidecar 进程错误：${error.message}`);
    });
    child.on('exit', (code, signal) => this.handleExit(child, code, signal));
  }

  private handleLine(line: string): void {
    if (!line.trim()) return;
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch (error) {
      this.failProtocol(`stdout 包含无法解析的 JSONL：${line.slice(0, 500)}`);
      return;
    }

    if (!isRecord(message)) {
      this.failProtocol('stdout JSONL 顶层值不是对象');
      return;
    }

    if ('method' in message && typeof message.method === 'string') {
      this.sequence += 1;
      const kind = 'id' in message ? 'serverRequest' : 'notification';
      this.emit('wire', {
        kind,
        generation: this.generation,
        sequence: this.sequence,
        message,
      } satisfies AppServerWireEvent);
      return;
    }

    if ('id' in message) {
      const numericId = typeof message.id === 'number' ? message.id : Number(message.id);
      const pending = this.pending.get(numericId);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(numericId);
      if ('error' in message && isRpcError(message.error)) {
        pending.reject(new AppServerRpcError(message.error.code, message.error.message, message.error.data));
      } else if ('result' in message) {
        pending.resolve(message.result);
      } else {
        pending.reject(new Error(`${pending.method} 收到无效响应`));
      }
      return;
    }

    this.failProtocol('stdout JSONL 不是有效的请求、响应或通知');
  }

  private failProtocol(message: string): void {
    if (this.protocolFault) return;
    this.protocolFault = true;
    this.options.diagnosticLog.write('protocol', message);
    this.emit('diagnostic', { level: 'error', message });
    this.child?.kill('SIGTERM');
  }

  private handleExit(
    exitedChild: ChildProcessWithoutNullStreams,
    code: number | null,
    signal: NodeJS.Signals | null,
  ): void {
    if (this.child !== exitedChild) return;
    this.clearStabilityTimer();
    this.child = null;
    const reason = `sidecar 已退出（code=${String(code)}, signal=${String(signal)}）`;
    this.options.diagnosticLog.write('runtime', reason);
    this.rejectAllPending(new AppServerExitedError(reason));

    if (this.intentionalStop) return;
    if (this.restartAttempt >= this.restartDelays.length) {
      this.setStatus({ phase: 'faulted', pid: null, message: `${reason}，自动重启次数已用尽` });
      return;
    }

    const delay = this.restartDelays[this.restartAttempt];
    this.restartAttempt += 1;
    this.setStatus({
      phase: 'reconnecting',
      pid: null,
      restartAttempt: this.restartAttempt,
      message: `${reason}，${delay / 1_000} 秒后重连`,
    });
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      void this.start().catch((error) => {
        this.options.diagnosticLog.write(
          'runtime',
          `重连失败：${error instanceof Error ? error.message : String(error)}`,
        );
      });
    }, delay);
  }

  private rawRequest(method: string, params?: unknown): Promise<unknown> {
    const id = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} 请求超时`));
      }, this.requestTimeoutMs);
      this.pending.set(id, { method, resolve, reject, timer });
      try {
        this.write(params === undefined ? { method, id } : { method, id, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private brandName(): string {
    return this.options.clientTitle?.() ?? 'AI小鲸';
  }

  private write(message: unknown): void {
    if (!this.child || !this.child.stdin.writable) {
      throw new AppServerExitedError(`${this.brandName()} app-server 已退出`);
    }
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private rejectAllPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private async stopChild(): Promise<void> {
    const child = this.child;
    if (!child) return;
    await new Promise<void>((resolve) => {
      const forceKill = setTimeout(() => {
        child.kill('SIGKILL');
      }, 2_000);
      const giveUp = setTimeout(resolve, 4_000);
      child.once('exit', () => {
        clearTimeout(forceKill);
        clearTimeout(giveUp);
        resolve();
      });
      child.kill('SIGTERM');
    });
    if (this.child === child) {
      this.child = null;
      this.rejectAllPending(new AppServerExitedError(`${this.brandName()} app-server 未能及时退出`));
    }
  }

  private clearRestartTimer(): void {
    if (!this.restartTimer) return;
    clearTimeout(this.restartTimer);
    this.restartTimer = null;
  }

  private clearStabilityTimer(): void {
    if (!this.stabilityTimer) return;
    clearTimeout(this.stabilityTimer);
    this.stabilityTimer = null;
  }

  private setStatus(patch: Partial<RuntimeStatus>): void {
    this.currentStatus = { ...this.currentStatus, ...patch };
    this.emit('status', this.status());
  }
}

export function isolatedSidecarEnvironment(
  baseEnvironment: NodeJS.ProcessEnv,
  sidecarHome: string,
  codexHome: string,
): NodeJS.ProcessEnv {
  const isolatedHome = path.resolve(sidecarHome);
  const isolatedCodexHome = path.resolve(codexHome);
  return {
    ...baseEnvironment,
    HOME: isolatedHome,
    USERPROFILE: isolatedHome,
    CODEX_HOME: isolatedCodexHome,
    XDG_CONFIG_HOME: path.join(isolatedHome, '.config'),
    XDG_CACHE_HOME: path.join(isolatedHome, '.cache'),
    XDG_DATA_HOME: path.join(isolatedHome, '.local', 'share'),
    XDG_STATE_HOME: path.join(isolatedHome, '.local', 'state'),
    ZDOTDIR: path.join(isolatedHome, '.config'),
    LOG_FORMAT: 'json',
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRpcError(value: unknown): value is RpcErrorShape {
  return (
    isRecord(value) &&
    typeof value.code === 'number' &&
    typeof value.message === 'string'
  );
}
