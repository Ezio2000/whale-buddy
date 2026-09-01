import { describe, expect, it, vi } from 'vitest';
import {
  buildWecomLoginUrl,
  exchangeWecomCode,
  isWecomCallbackUrl,
  readWecomAuthConfig,
  type WecomAuthConfig,
} from '../../packages/wecom-auth/src/client';

const config: WecomAuthConfig = {
  corpId: 'ww-test-corp',
  agentId: '1000002',
  secret: 'test-secret',
  redirectUri: 'https://login.example.com/wecom/callback',
};

describe('wecom auth client', () => {
  it('stays disabled until every isolated environment value is configured', () => {
    expect(readWecomAuthConfig({})).toBeNull();
    expect(readWecomAuthConfig({
      WHALE_WECOM_CORP_ID: config.corpId,
      WHALE_WECOM_AGENT_ID: config.agentId,
      WHALE_WECOM_SECRET: config.secret,
      WHALE_WECOM_REDIRECT_URI: config.redirectUri,
    })).toEqual(config);
  });

  it('requires an HTTPS callback', () => {
    expect(() => readWecomAuthConfig({
      WHALE_WECOM_CORP_ID: config.corpId,
      WHALE_WECOM_AGENT_ID: config.agentId,
      WHALE_WECOM_SECRET: config.secret,
      WHALE_WECOM_REDIRECT_URI: 'http://localhost/callback',
    })).toThrow('必须使用 HTTPS');
  });

  it('builds the official qrConnect URL with a CSRF state', () => {
    const url = new URL(buildWecomLoginUrl(config, 'random-state'));
    expect(url.origin).toBe('https://open.work.weixin.qq.com');
    expect(url.pathname).toBe('/wwopen/sso/qrConnect');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      appid: config.corpId,
      agentid: config.agentId,
      redirect_uri: config.redirectUri,
      state: 'random-state',
    });
  });

  it('only accepts the configured callback origin and path', () => {
    expect(isWecomCallbackUrl(
      'https://login.example.com/wecom/callback?code=one&state=two',
      config.redirectUri,
    )).toBe(true);
    expect(isWecomCallbackUrl(
      'https://login.example.com/other?code=one',
      config.redirectUri,
    )).toBe(false);
    expect(isWecomCallbackUrl(
      'https://attacker.example/wecom/callback?code=one',
      config.redirectUri,
    )).toBe(false);
  });

  it('exchanges a code and normalizes the current enterprise member', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ errcode: 0, access_token: 'access-token' }))
      .mockResolvedValueOnce(jsonResponse({ errcode: 0, UserId: 'zhangsan' }))
      .mockResolvedValueOnce(jsonResponse({
        errcode: 0,
        userid: 'zhangsan',
        name: '张三',
        avatar: 'https://example.com/avatar.png',
        email: 'zhangsan@example.com',
        mobile: '13800000000',
        department: [1, 7],
      }));

    await expect(exchangeWecomCode(config, 'single-use-code', fetcher)).resolves.toEqual({
      userId: 'zhangsan',
      name: '张三',
      avatar: 'https://example.com/avatar.png',
      email: 'zhangsan@example.com',
      mobile: '13800000000',
      departmentIds: [1, 7],
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(String(fetcher.mock.calls[1]?.[0])).toContain('code=single-use-code');
  });

  it('keeps a valid UserID when the app cannot read contact details', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ errcode: 0, access_token: 'access-token' }))
      .mockResolvedValueOnce(jsonResponse({ errcode: 0, UserId: 'lisi' }))
      .mockResolvedValueOnce(jsonResponse({ errcode: 60011, errmsg: 'no privilege' }));

    await expect(exchangeWecomCode(config, 'single-use-code', fetcher)).resolves.toEqual({
      userId: 'lisi',
      name: 'lisi',
      avatar: '',
      email: '',
      mobile: '',
      departmentIds: [],
    });
  });

  it('rejects identities outside the configured enterprise', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ errcode: 0, access_token: 'access-token' }))
      .mockResolvedValueOnce(jsonResponse({ errcode: 0, OpenId: 'external-user' }));

    await expect(exchangeWecomCode(config, 'single-use-code', fetcher))
      .rejects.toThrow('不是当前企业成员');
  });
});

function jsonResponse(payload: object): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
