export interface WecomAuthConfig {
  corpId: string;
  agentId: string;
  secret: string;
  redirectUri: string;
}

export interface WecomMemberProfile {
  userId: string;
  name: string;
  avatar: string;
  email: string;
  mobile: string;
  departmentIds: number[];
}

interface WecomResponse {
  errcode?: number;
  errmsg?: string;
  [key: string]: unknown;
}

type FetchLike = typeof fetch;

const API_ORIGIN = 'https://qyapi.weixin.qq.com';
const LOGIN_ORIGIN = 'https://open.work.weixin.qq.com';

export function readWecomAuthConfig(
  environment: NodeJS.ProcessEnv = process.env,
): WecomAuthConfig | null {
  const config = {
    corpId: environment.WHALE_WECOM_CORP_ID?.trim() ?? '',
    agentId: environment.WHALE_WECOM_AGENT_ID?.trim() ?? '',
    secret: environment.WHALE_WECOM_SECRET?.trim() ?? '',
    redirectUri: environment.WHALE_WECOM_REDIRECT_URI?.trim() ?? '',
  };
  if (!config.corpId || !config.agentId || !config.secret || !config.redirectUri) return null;
  const redirect = new URL(config.redirectUri);
  if (redirect.protocol !== 'https:') {
    throw new Error('WHALE_WECOM_REDIRECT_URI 必须使用 HTTPS');
  }
  return config;
}

export function buildWecomLoginUrl(config: WecomAuthConfig, state: string): string {
  const url = new URL('/wwopen/sso/qrConnect', LOGIN_ORIGIN);
  url.searchParams.set('appid', config.corpId);
  url.searchParams.set('agentid', config.agentId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('state', state);
  url.searchParams.set('lang', 'zh');
  return url.toString();
}

export function isWecomCallbackUrl(candidate: string, redirectUri: string): boolean {
  try {
    const actual = new URL(candidate);
    const expected = new URL(redirectUri);
    return actual.origin === expected.origin
      && normalizePath(actual.pathname) === normalizePath(expected.pathname);
  } catch {
    return false;
  }
}

export async function exchangeWecomCode(
  config: WecomAuthConfig,
  code: string,
  fetcher: FetchLike = fetch,
): Promise<WecomMemberProfile> {
  const token = await requestWecom(
    '/cgi-bin/gettoken',
    { corpid: config.corpId, corpsecret: config.secret },
    fetcher,
  );
  const accessToken = requiredString(token, 'access_token', '企业微信未返回 access_token');

  const identity = await requestWecom(
    '/cgi-bin/user/getuserinfo',
    { access_token: accessToken, code },
    fetcher,
  );
  const userId = optionalString(identity, 'UserId') || optionalString(identity, 'userid');
  if (!userId) throw new Error('扫码用户不是当前企业成员，无法获取企业身份');

  try {
    const detail = await requestWecom(
      '/cgi-bin/user/get',
      { access_token: accessToken, userid: userId },
      fetcher,
    );
    return normalizeMember(userId, detail);
  } catch {
    // 应用没有通讯录可见范围时，登录身份仍然有效，只返回可靠的 UserID。
    return normalizeMember(userId, {});
  }
}

async function requestWecom(
  pathname: string,
  params: Record<string, string>,
  fetcher: FetchLike,
): Promise<WecomResponse> {
  const url = new URL(pathname, API_ORIGIN);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetcher(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`企业微信接口请求失败（HTTP ${response.status}）`);
  const payload = await response.json() as WecomResponse;
  if (payload.errcode && payload.errcode !== 0) {
    throw new Error(`企业微信接口错误 ${payload.errcode}: ${payload.errmsg ?? '未知错误'}`);
  }
  return payload;
}

function normalizeMember(userId: string, detail: WecomResponse): WecomMemberProfile {
  const departments = Array.isArray(detail.department)
    ? detail.department.filter((item): item is number => Number.isInteger(item))
    : [];
  return {
    userId,
    name: optionalString(detail, 'name') || userId,
    avatar: optionalString(detail, 'avatar') || optionalString(detail, 'thumb_avatar'),
    email: optionalString(detail, 'email') || optionalString(detail, 'biz_mail'),
    mobile: optionalString(detail, 'mobile'),
    departmentIds: departments,
  };
}

function requiredString(source: WecomResponse, key: string, message: string): string {
  const value = optionalString(source, key);
  if (!value) throw new Error(message);
  return value;
}

function optionalString(source: WecomResponse, key: string): string {
  const value = source[key];
  return typeof value === 'string' ? value.trim() : '';
}

function normalizePath(pathname: string): string {
  return pathname.replace(/\/+$/, '') || '/';
}
