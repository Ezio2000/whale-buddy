import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WhaleAuthManager, type WhaleAuthConfig } from '../../src/main/auth';
import type { WhaleAuthState } from '../../src/shared/types';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('WhaleAuthManager', () => {
  it('completes authorization code + PKCE and restores the persisted user', async () => {
    const port = await availablePort();
    const stateRoot = temporaryStateRoot();
    const config = testConfig(port);
    let authorizationUrl = '';
    let expectedChallenge = '';
    const states: WhaleAuthState[] = [];

    const request = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/.well-known/openid-configuration')) {
        return jsonResponse({
          authorization_endpoint: 'https://casdoor.test/login/oauth/authorize',
          token_endpoint: 'https://casdoor.test/api/login/oauth/access_token',
          userinfo_endpoint: 'https://casdoor.test/api/userinfo',
        });
      }
      if (url.endsWith('/api/login/oauth/access_token')) {
        const body = init?.body as URLSearchParams;
        expect(body.get('grant_type')).toBe('authorization_code');
        expect(body.get('client_id')).toBe(config.clientId);
        expect(body.get('client_secret')).toBe(config.clientSecret);
        expect(body.get('code')).toBe('casdoor-code');
        expect(body.get('redirect_uri')).toBe(config.redirectUri);
        const verifier = body.get('code_verifier');
        expect(verifier).toBeTruthy();
        const challenge = await sha256Base64Url(verifier!);
        expect(challenge).toBe(expectedChallenge);
        return jsonResponse({
          access_token: 'access-token',
          refresh_token: 'refresh-token',
          expires_in: 3600,
        });
      }
      if (url.endsWith('/api/userinfo')) {
        expect(init?.headers).toEqual({ Authorization: 'Bearer access-token' });
        return jsonResponse({
          sub: 'built-in/alice',
          name: 'alice',
          displayName: 'Alice',
          email: 'alice@mock.wecom.local',
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    }) as typeof fetch;

    const manager = new WhaleAuthManager({
      stateRoot,
      config,
      fetch: request,
      openExternal: async (url) => { authorizationUrl = url; },
      loginTimeoutMs: 10_000,
    });
    manager.subscribe((state) => states.push(state));

    expect(await manager.login()).toEqual({ status: 'waiting', user: null, message: null });
    const authorize = new URL(authorizationUrl);
    expect(authorize.origin + authorize.pathname).toBe('https://casdoor.test/login/oauth/authorize');
    expect(authorize.searchParams.get('client_id')).toBe(config.clientId);
    expect(authorize.searchParams.get('redirect_uri')).toBe(config.redirectUri);
    expect(authorize.searchParams.get('scope')).toBe(config.scope);
    expect(authorize.searchParams.get('response_type')).toBe('code');
    expect(authorize.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authorize.searchParams.has('provider_hint')).toBe(false);
    expectedChallenge = authorize.searchParams.get('code_challenge')!;

    const callback = new URL(config.redirectUri);
    callback.searchParams.set('code', 'casdoor-code');
    callback.searchParams.set('state', authorize.searchParams.get('state')!);
    const completion = await fetch(callback);
    expect(completion.status).toBe(200);
    expect(await completion.text()).toContain('登录完成');

    await vi.waitFor(() => expect(states.at(-1)?.status).toBe('logged-in'));
    expect(states.at(-1)).toEqual({
      status: 'logged-in',
      user: {
        id: 'built-in/alice',
        username: 'alice',
        displayName: 'Alice',
        email: 'alice@mock.wecom.local',
        avatar: null,
      },
      message: null,
    });
    expect(JSON.parse(readFileSync(path.join(stateRoot, 'auth-session.json'), 'utf8')))
      .toMatchObject({ accessToken: 'access-token', refreshToken: 'refresh-token' });
    const identity = await manager.identityContext();
    expect(identity).toMatchObject({
      userId: 'built-in/alice',
      username: 'alice',
      displayName: 'Alice',
      sessionId: expect.any(String),
    });

    const restored = new WhaleAuthManager({
      stateRoot,
      config,
      fetch: request,
      openExternal: async () => undefined,
    });
    expect(await restored.status()).toEqual(states.at(-1));
    expect(await restored.identityContext()).toEqual(identity);
    expect(await restored.logout()).toEqual({ status: 'logged-out', user: null, message: null });
    expect(await restored.identityContext()).toBeNull();

    await manager.dispose();
    await restored.dispose();
  });

  it('rejects a callback whose state does not match the active login', async () => {
    const port = await availablePort();
    const manager = new WhaleAuthManager({
      stateRoot: temporaryStateRoot(),
      config: testConfig(port),
      fetch: async () => jsonResponse({
        authorization_endpoint: 'https://casdoor.test/login/oauth/authorize',
        token_endpoint: 'https://casdoor.test/api/login/oauth/access_token',
        userinfo_endpoint: 'https://casdoor.test/api/userinfo',
      }),
      openExternal: async () => undefined,
      loginTimeoutMs: 10_000,
    });
    await manager.login();

    const response = await fetch(`http://127.0.0.1:${port}/oauth/callback?code=code&state=wrong`);
    expect(response.status).toBe(400);
    expect(await response.text()).toContain('登录状态校验失败');
    await vi.waitFor(async () => {
      expect(await manager.status()).toEqual({
        status: 'error', user: null, message: '登录状态校验失败。',
      });
    });
    await manager.dispose();
  });
});

function temporaryStateRoot(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'whale-auth-test-'));
  temporaryDirectories.push(directory);
  return directory;
}

function testConfig(port: number): WhaleAuthConfig {
  return {
    issuer: 'https://casdoor.test',
    clientId: 'whale-buddy-desktop',
    clientSecret: 'whale-buddy-desktop-secret',
    redirectUri: `http://127.0.0.1:${port}/oauth/callback`,
    scope: 'openid profile email offline_access',
  };
}

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Failed to allocate a test port');
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Buffer.from(digest).toString('base64url');
}
