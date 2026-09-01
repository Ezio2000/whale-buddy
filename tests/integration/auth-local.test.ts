import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { WhaleAuthManager, WHALE_AUTH_CONFIG } from '../../src/main/auth';
import type { WhaleAuthState } from '../../src/shared/types';

const integration = process.env.WHALE_AUTH_INTEGRATION === '1' ? describe : describe.skip;
const stateRoot = mkdtempSync(path.join(tmpdir(), 'whale-auth-local-'));

afterAll(() => rmSync(stateRoot, { recursive: true, force: true }));

integration('local Casdoor + OAuth Mock', () => {
  it('completes provider selection, mock scan, Casdoor code exchange and Whale callback', async () => {
    let authorizeUrl = '';
    const states: WhaleAuthState[] = [];
    const manager = new WhaleAuthManager({
      stateRoot,
      config: WHALE_AUTH_CONFIG,
      openExternal: async (url) => { authorizeUrl = url; },
      loginTimeoutMs: 30_000,
    });
    manager.subscribe((state) => states.push(state));

    await manager.login();
    const whaleAuthorize = new URL(authorizeUrl);
    expect(whaleAuthorize.origin).toBe('http://127.0.0.1:8001');
    expect(whaleAuthorize.searchParams.has('provider_hint')).toBe(false);

    const appLogin = await fetch(appLoginUrl(whaleAuthorize));
    const appPayload = await json(appLogin);
    expect(appPayload.status).toBe('ok');
    expect(record(appPayload.data).name).toBe('app-whale');
    expect(JSON.stringify(record(appPayload.data).providers)).toContain('provider_oauth_mock');

    const providerState = Buffer.from(
      `${whaleAuthorize.search}&application=app-whale&provider=provider_oauth_mock&method=signin`,
      'utf8',
    ).toString('base64');
    const providerAuthorize = new URL('http://127.0.0.1:9000/api/v1/authorize');
    providerAuthorize.searchParams.set('client_id', 'casdoor-mock-client');
    providerAuthorize.searchParams.set('redirect_uri', 'http://127.0.0.1:8001/callback');
    providerAuthorize.searchParams.set('response_type', 'code');
    providerAuthorize.searchParams.set('scope', 'openid profile email');
    providerAuthorize.searchParams.set('state', providerState);
    const providerPage = await fetch(providerAuthorize).then((response) => response.text());
    const transaction = providerPage.match(/data-transaction="([^"]+)"/)?.[1];
    expect(transaction).toBeTruthy();

    await fetch(`http://127.0.0.1:9000/scan/${transaction}`);
    const approval = await fetch(`http://127.0.0.1:9000/scan/${transaction}/approve`, {
      method: 'POST',
      redirect: 'manual',
    });
    expect([200, 302, 303]).toContain(approval.status);
    const providerComplete = await fetch(
      `http://127.0.0.1:9000/api/scan/complete?id=${transaction}`,
      { redirect: 'manual' },
    );
    expect(providerComplete.status).toBe(302);
    const providerCallback = new URL(requiredHeader(providerComplete, 'location'));
    const providerCode = providerCallback.searchParams.get('code');
    expect(providerCode).toBeTruthy();

    const casdoorLogin = new URL('http://127.0.0.1:8001/api/login');
    casdoorLogin.searchParams.set('clientId', whaleAuthorize.searchParams.get('client_id')!);
    casdoorLogin.searchParams.set('responseType', 'code');
    casdoorLogin.searchParams.set('redirectUri', whaleAuthorize.searchParams.get('redirect_uri')!);
    casdoorLogin.searchParams.set('type', 'code');
    casdoorLogin.searchParams.set('scope', whaleAuthorize.searchParams.get('scope')!);
    casdoorLogin.searchParams.set('state', whaleAuthorize.searchParams.get('state')!);
    casdoorLogin.searchParams.set('nonce', '');
    casdoorLogin.searchParams.set('code_challenge_method', 'S256');
    casdoorLogin.searchParams.set('code_challenge', whaleAuthorize.searchParams.get('code_challenge')!);
    const loginResponse = await fetch(casdoorLogin, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'code',
        application: 'app-whale',
        provider: 'provider_oauth_mock',
        code: providerCode,
        state: 'app-whale',
        invitationCode: '',
        redirectUri: 'http://127.0.0.1:8001/callback',
        method: 'signin',
        userCode: '',
        codeVerifier: null,
        language: 'zh',
      }),
    });
    const loginPayload = await json(loginResponse);
    if (loginPayload.status !== 'ok') {
      throw new Error(`Casdoor login failed: ${JSON.stringify(loginPayload)}`);
    }
    expect(typeof loginPayload.data).toBe('string');

    const whaleCallback = new URL(WHALE_AUTH_CONFIG.redirectUri);
    whaleCallback.searchParams.set('code', String(loginPayload.data));
    whaleCallback.searchParams.set('state', whaleAuthorize.searchParams.get('state')!);
    const completion = await fetch(whaleCallback);
    expect(completion.status).toBe(200);
    expect(await completion.text()).toContain('登录完成');

    await vi.waitFor(() => expect(states.at(-1)?.status).toBe('logged-in'));
    const signedIn = states.at(-1);
    expect(signedIn?.status).toBe('logged-in');
    if (signedIn?.status === 'logged-in') {
      expect(signedIn.user.username).toBe('alice');
      expect(signedIn.user.email).toBe('alice@mock.wecom.local');
    }
    await manager.dispose();
  }, 30_000);
});

function appLoginUrl(authorize: URL): URL {
  const url = new URL('http://127.0.0.1:8001/api/get-app-login');
  url.searchParams.set('clientId', authorize.searchParams.get('client_id')!);
  url.searchParams.set('responseType', 'code');
  url.searchParams.set('redirectUri', authorize.searchParams.get('redirect_uri')!);
  url.searchParams.set('type', 'code');
  url.searchParams.set('scope', authorize.searchParams.get('scope')!);
  url.searchParams.set('state', authorize.searchParams.get('state')!);
  url.searchParams.set('nonce', '');
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('code_challenge', authorize.searchParams.get('code_challenge')!);
  return url;
}

async function json(response: Response): Promise<Record<string, unknown>> {
  const payload: unknown = await response.json();
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error(`Expected JSON object from ${response.url}`);
  }
  return payload as Record<string, unknown>;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function requiredHeader(response: Response, name: string): string {
  const value = response.headers.get(name);
  if (!value) throw new Error(`Missing ${name} header`);
  return value;
}
