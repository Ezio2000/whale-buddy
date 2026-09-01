import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { createServer, type Server, type ServerResponse } from 'node:http';
import path from 'node:path';
import type { IdentityContext, WhaleAuthState, WhaleUser } from '../shared/types';
import { PRIVATE_FILE_MODE, hardenPrivateFile } from './filesystem-security';

export interface WhaleAuthConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scope: string;
}

export const WHALE_AUTH_CONFIG: WhaleAuthConfig = Object.freeze({
  issuer: 'http://127.0.0.1:8001',
  clientId: 'whale-buddy-desktop',
  clientSecret: 'whale-buddy-desktop-secret',
  redirectUri: 'http://127.0.0.1:17891/oauth/callback',
  scope: 'openid profile email offline_access',
});

interface OidcDiscovery {
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}

interface StoredAuthSession {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
  sessionId: string;
  authenticatedAt: number;
  user: WhaleUser;
}

interface ActiveLogin {
  state: string;
  verifier: string;
  server: Server;
  timeout: ReturnType<typeof setTimeout>;
  completing: boolean;
}

interface WhaleAuthManagerOptions {
  stateRoot: string;
  config?: WhaleAuthConfig;
  openExternal: (url: string) => Promise<void>;
  fetch?: typeof fetch;
  loginTimeoutMs?: number;
}

type AuthListener = (state: WhaleAuthState) => void;

const LOGIN_TIMEOUT_MS = 5 * 60_000;
const EXPIRY_SKEW_MS = 30_000;

export class WhaleAuthManager {
  private readonly config: WhaleAuthConfig;
  private readonly sessionPath: string;
  private readonly openExternal: (url: string) => Promise<void>;
  private readonly request: typeof fetch;
  private readonly loginTimeoutMs: number;
  private readonly listeners = new Set<AuthListener>();
  private session: StoredAuthSession | null;
  private state: WhaleAuthState;
  private activeLogin: ActiveLogin | null = null;
  private discovery: OidcDiscovery | null = null;

  constructor(options: WhaleAuthManagerOptions) {
    this.config = normalizeConfig(options.config ?? WHALE_AUTH_CONFIG);
    this.sessionPath = path.join(options.stateRoot, 'auth-session.json');
    this.openExternal = options.openExternal;
    this.request = options.fetch ?? fetch;
    this.loginTimeoutMs = options.loginTimeoutMs ?? LOGIN_TIMEOUT_MS;
    this.session = this.readSession();
    this.state = this.session
      ? { status: 'logged-in', user: this.session.user, message: null }
      : { status: 'logged-out', user: null, message: null };
  }

  subscribe(listener: AuthListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async status(): Promise<WhaleAuthState> {
    if (!this.session || this.session.expiresAt > Date.now() + EXPIRY_SKEW_MS) return this.state;
    if (!this.session.refreshToken) {
      this.clearSession();
      return this.state;
    }

    try {
      await this.refreshSession(this.session.refreshToken);
    } catch {
      this.clearSession();
    }
    return this.state;
  }

  async identityContext(): Promise<IdentityContext | null> {
    const state = await this.status();
    if (state.status !== 'logged-in' || !this.session) return null;
    return {
      userId: state.user.id,
      username: state.user.username,
      displayName: state.user.displayName,
      sessionId: this.session.sessionId,
    };
  }

  async login(): Promise<WhaleAuthState> {
    if (this.activeLogin) return this.state;

    const callback = new URL(this.config.redirectUri);
    const state = randomBase64Url(32);
    const verifier = randomBase64Url(64);
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const server = createServer((request, response) => {
      void this.handleCallback(request.url ?? '/', response);
    });

    try {
      await listen(server, callback);
      const timeout = setTimeout(() => {
        this.failLogin('登录等待超时，请重新发起登录。');
      }, this.loginTimeoutMs);
      this.activeLogin = { state, verifier, server, timeout, completing: false };
      this.setState({ status: 'waiting', user: null, message: null });

      const discovery = await this.getDiscovery();
      const authorizeUrl = new URL(discovery.authorization_endpoint);
      authorizeUrl.searchParams.set('client_id', this.config.clientId);
      authorizeUrl.searchParams.set('response_type', 'code');
      authorizeUrl.searchParams.set('redirect_uri', this.config.redirectUri);
      authorizeUrl.searchParams.set('scope', this.config.scope);
      authorizeUrl.searchParams.set('state', state);
      authorizeUrl.searchParams.set('code_challenge', challenge);
      authorizeUrl.searchParams.set('code_challenge_method', 'S256');
      await this.openExternal(authorizeUrl.toString());
      return this.state;
    } catch (error) {
      if (this.activeLogin?.server === server) await this.finishActiveLogin();
      else await closeServer(server);
      const message = errorMessage(error, '无法启动登录。');
      this.setState({ status: 'error', user: null, message });
      throw new Error(message);
    }
  }

  async logout(): Promise<WhaleAuthState> {
    await this.cancelActiveLogin();
    this.clearSession();
    return this.state;
  }

  async dispose(): Promise<void> {
    await this.cancelActiveLogin();
    this.listeners.clear();
  }

  private async handleCallback(rawUrl: string, response: ServerResponse): Promise<void> {
    const active = this.activeLogin;
    const callback = new URL(rawUrl, this.config.redirectUri);
    if (callback.pathname !== new URL(this.config.redirectUri).pathname) {
      sendHtml(response, 404, completionPage('页面不存在', '请返回 Whale 重新发起登录。', false));
      return;
    }
    if (!active || active.completing) {
      sendHtml(response, 409, completionPage('登录请求已失效', '请返回 Whale 重新发起登录。', false));
      return;
    }
    active.completing = true;

    const providerError = callback.searchParams.get('error');
    const code = callback.searchParams.get('code');
    const state = callback.searchParams.get('state');
    if (providerError) {
      const description = callback.searchParams.get('error_description') ?? providerError;
      sendHtml(response, 400, completionPage('登录未完成', description, false));
      this.failLogin(description);
      return;
    }
    if (!code || state !== active.state) {
      const message = !code ? '回调中缺少授权码。' : '登录状态校验失败。';
      sendHtml(response, 400, completionPage('登录未完成', message, false));
      this.failLogin(message);
      return;
    }

    try {
      const token = await this.exchangeCode(code, active.verifier);
      const user = await this.loadUser(token.access_token);
      this.saveSession(token, user);
      sendHtml(response, 200, completionPage('登录完成', `已成功登录为 ${user.displayName}，可以关闭此页面。`, true));
      await this.finishActiveLogin();
      this.setState({ status: 'logged-in', user, message: null });
    } catch (error) {
      const message = errorMessage(error, 'Casdoor 登录失败。');
      sendHtml(response, 502, completionPage('登录未完成', message, false));
      this.failLogin(message);
    }
  }

  private async exchangeCode(code: string, verifier: string): Promise<TokenResponse> {
    const discovery = await this.getDiscovery();
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      code,
      redirect_uri: this.config.redirectUri,
      code_verifier: verifier,
    });
    return this.fetchToken(discovery.token_endpoint, body);
  }

  private async refreshSession(refreshToken: string): Promise<void> {
    const discovery = await this.getDiscovery();
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      refresh_token: refreshToken,
      scope: this.config.scope,
    });
    const token = await this.fetchToken(discovery.token_endpoint, body);
    const user = await this.loadUser(token.access_token);
    this.saveSession({ ...token, refresh_token: token.refresh_token ?? refreshToken }, user);
    this.setState({ status: 'logged-in', user, message: null });
  }

  private async fetchToken(endpoint: string, body: URLSearchParams): Promise<TokenResponse> {
    const response = await this.request(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const payload = await readJson(response);
    const accessToken = stringValue(payload.access_token);
    if (!response.ok || !accessToken) throw new Error(oauthError(payload, response.status));
    return {
      access_token: accessToken,
      refresh_token: optionalString(payload.refresh_token),
      expires_in: optionalPositiveNumber(payload.expires_in),
    };
  }

  private async loadUser(accessToken: string): Promise<WhaleUser> {
    const discovery = await this.getDiscovery();
    const response = await this.request(discovery.userinfo_endpoint, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const payload = await readJson(response);
    if (!response.ok) throw new Error(oauthError(payload, response.status));
    return normalizeUser(payload);
  }

  private async getDiscovery(): Promise<OidcDiscovery> {
    if (this.discovery) return this.discovery;
    const response = await this.request(`${this.config.issuer}/.well-known/openid-configuration`);
    const payload = await readJson(response);
    if (!response.ok) throw new Error(oauthError(payload, response.status));
    const discovery = {
      authorization_endpoint: httpUrl(payload.authorization_endpoint, 'authorization_endpoint'),
      token_endpoint: httpUrl(payload.token_endpoint, 'token_endpoint'),
      userinfo_endpoint: httpUrl(payload.userinfo_endpoint, 'userinfo_endpoint'),
    };
    this.discovery = discovery;
    return discovery;
  }

  private saveSession(token: TokenResponse, user: WhaleUser): void {
    const session: StoredAuthSession = {
      accessToken: token.access_token,
      refreshToken: token.refresh_token ?? null,
      expiresAt: Date.now() + (token.expires_in ?? 3600) * 1000,
      sessionId: this.session?.sessionId ?? randomBase64Url(24),
      authenticatedAt: this.session?.authenticatedAt ?? Date.now(),
      user,
    };
    const temporaryPath = `${this.sessionPath}.tmp`;
    writeFileSync(temporaryPath, `${JSON.stringify(session, null, 2)}\n`, {
      encoding: 'utf8',
      mode: PRIVATE_FILE_MODE,
    });
    renameSync(temporaryPath, this.sessionPath);
    hardenPrivateFile(this.sessionPath);
    this.session = session;
  }

  private readSession(): StoredAuthSession | null {
    if (!existsSync(this.sessionPath)) return null;
    try {
      const value = JSON.parse(readFileSync(this.sessionPath, 'utf8')) as Partial<StoredAuthSession>;
      if (
        typeof value.accessToken !== 'string'
        || typeof value.expiresAt !== 'number'
        || !value.user
        || typeof value.user.id !== 'string'
        || typeof value.user.displayName !== 'string'
      ) return null;
      return {
        accessToken: value.accessToken,
        refreshToken: typeof value.refreshToken === 'string' ? value.refreshToken : null,
        expiresAt: value.expiresAt,
        sessionId: typeof value.sessionId === 'string'
          ? value.sessionId
          : createHash('sha256').update(value.accessToken).digest('base64url').slice(0, 32),
        authenticatedAt: typeof value.authenticatedAt === 'number'
          ? value.authenticatedAt
          : Math.max(0, value.expiresAt - 3_600_000),
        user: value.user,
      };
    } catch {
      return null;
    }
  }

  private clearSession(): void {
    this.session = null;
    if (existsSync(this.sessionPath)) unlinkSync(this.sessionPath);
    this.setState({ status: 'logged-out', user: null, message: null });
  }

  private setState(state: WhaleAuthState): void {
    this.state = state;
    for (const listener of this.listeners) listener(state);
  }

  private failLogin(message: string): void {
    void this.finishActiveLogin();
    this.setState({ status: 'error', user: null, message });
  }

  private async finishActiveLogin(): Promise<void> {
    const active = this.activeLogin;
    if (!active) return;
    this.activeLogin = null;
    clearTimeout(active.timeout);
    await closeServer(active.server);
  }

  private async cancelActiveLogin(): Promise<void> {
    await this.finishActiveLogin();
  }
}

function normalizeConfig(config: WhaleAuthConfig): WhaleAuthConfig {
  const issuer = new URL(config.issuer);
  const redirect = new URL(config.redirectUri);
  if (!['http:', 'https:'].includes(issuer.protocol)) throw new Error('Casdoor issuer 必须使用 HTTP(S)。');
  if (redirect.protocol !== 'http:' || redirect.hostname !== '127.0.0.1') {
    throw new Error('Whale OAuth 回调必须使用 127.0.0.1 HTTP 地址。');
  }
  if (!redirect.port) throw new Error('Whale OAuth 回调必须使用固定端口。');
  return {
    issuer: issuer.toString().replace(/\/$/, ''),
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    redirectUri: redirect.toString(),
    scope: config.scope,
  };
}

function listen(server: Server, callback: URL): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once('error', onError);
    server.listen(Number(callback.port), callback.hostname, () => {
      server.off('error', onError);
      resolve();
    });
  });
}

function closeServer(server: Server): Promise<void> {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve) => server.close(() => resolve()));
}

function sendHtml(response: ServerResponse, status: number, html: string): void {
  response.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(html);
}

function completionPage(title: string, message: string, success: boolean): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} · Whale Buddy</title>
  <style>
    :root { color-scheme: light dark; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f4f3ef; color: #252522; }
    main { width: min(420px, calc(100vw - 48px)); padding: 36px; text-align: center; background: #fff; border: 1px solid #dcd9d1; border-radius: 18px; box-shadow: 0 18px 55px rgb(40 38 31 / 12%); }
    .mark { width: 48px; height: 48px; display: grid; place-items: center; margin: 0 auto 18px; border-radius: 50%; background: ${success ? '#dceceb' : '#fae7e5'}; color: ${success ? '#176b69' : '#bd3b35'}; font-size: 24px; }
    h1 { margin: 0 0 10px; font-size: 24px; letter-spacing: -.02em; }
    p { margin: 0; color: #706f68; font-size: 14px; line-height: 1.7; }
  </style>
</head>
<body><main><div class="mark">${success ? '&#10003;' : '!'}</div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></main></body>
</html>`;
}

function normalizeUser(payload: Record<string, unknown>): WhaleUser {
  const id = firstString(payload.sub, payload.id);
  if (!id) throw new Error('Casdoor UserInfo 缺少用户 ID。');
  const username = firstString(payload.name, payload.preferred_username, payload.username, payload.email, id) ?? id;
  const displayName = firstString(payload.displayName, payload.name, payload.preferred_username, payload.email, id) ?? id;
  return {
    id,
    username,
    displayName,
    email: firstString(payload.email),
    avatar: firstString(payload.avatar, payload.picture),
  };
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!text) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // The caller reports a protocol error without echoing arbitrary HTML.
  }
  throw new Error(`认证服务返回了无效响应（HTTP ${response.status}）。`);
}

function oauthError(payload: Record<string, unknown>, status: number): string {
  return firstString(payload.error_description, payload.error, payload.msg)
    ?? `认证服务请求失败（HTTP ${status}）。`;
}

function httpUrl(value: unknown, field: string): string {
  const raw = stringValue(value);
  if (!raw) throw new Error(`OIDC Discovery 缺少 ${field}。`);
  const parsed = new URL(raw);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error(`OIDC ${field} 不是 HTTP(S) 地址。`);
  return parsed.toString();
}

function randomBase64Url(bytes: number): string {
  return randomBytes(bytes).toString('base64url');
}

function stringValue(value: unknown): string {
  return typeof value === 'string' && value.length > 0 ? value : '';
}

function optionalString(value: unknown): string | undefined {
  return stringValue(value) || undefined;
}

function optionalPositiveNumber(value: unknown): number | undefined {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character] ?? character);
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}
