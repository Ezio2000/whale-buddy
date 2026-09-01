import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron';
import {
  buildWecomLoginUrl,
  exchangeWecomCode,
  isWecomCallbackUrl,
  readWecomAuthConfig,
  type WecomAuthConfig,
} from './client';
import {
  WECOM_AUTH_IPC,
  type WecomAuthStatus,
  type WecomIdentity,
} from './types';

const LOGIN_TIMEOUT_MS = 5 * 60 * 1_000;
const IDENTITY_DIRECTORY = 'wecom-auth';
const IDENTITY_FILE = 'identity.json';

export interface RegisterWecomAuthOptions {
  parentWindow: BrowserWindow;
  dataDirectory: string;
  environment?: NodeJS.ProcessEnv;
}

export function registerWecomAuth(options: RegisterWecomAuthOptions): () => void {
  const config = readWecomAuthConfig(options.environment);
  const identityPath = path.join(options.dataDirectory, IDENTITY_DIRECTORY, IDENTITY_FILE);
  let identity = config ? readStoredIdentity(identityPath, config.corpId) : null;
  let pendingLogin: Promise<WecomIdentity> | null = null;

  const assertTrustedSender = (event: IpcMainInvokeEvent) => {
    if (event.sender !== options.parentWindow.webContents) {
      throw new Error('拒绝来自未知窗口的企业微信身份请求');
    }
  };
  const status = (): WecomAuthStatus => ({ configured: Boolean(config), identity });

  ipcMain.handle(WECOM_AUTH_IPC.status, (event) => {
    assertTrustedSender(event);
    return status();
  });
  ipcMain.handle(WECOM_AUTH_IPC.login, async (event) => {
    assertTrustedSender(event);
    if (!config) throw new Error('企业微信身份功能尚未配置');
    pendingLogin ??= performLogin(options.parentWindow, config)
      .then((nextIdentity) => {
        identity = nextIdentity;
        writeStoredIdentity(identityPath, nextIdentity);
        return nextIdentity;
      })
      .finally(() => {
        pendingLogin = null;
      });
    return pendingLogin;
  });
  ipcMain.handle(WECOM_AUTH_IPC.logout, (event) => {
    assertTrustedSender(event);
    identity = null;
    if (existsSync(identityPath)) rmSync(identityPath, { force: true });
    return status();
  });

  return () => {
    for (const channel of Object.values(WECOM_AUTH_IPC)) ipcMain.removeHandler(channel);
  };
}

async function performLogin(
  parentWindow: BrowserWindow,
  config: WecomAuthConfig,
): Promise<WecomIdentity> {
  const state = randomBytes(24).toString('base64url');
  const loginWindow = new BrowserWindow({
    parent: parentWindow,
    modal: true,
    show: false,
    width: 720,
    height: 760,
    minWidth: 620,
    minHeight: 680,
    title: '企业微信扫码登录',
    autoHideMenuBar: true,
    backgroundColor: '#ffffff',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      partition: 'wecom-auth-temporary',
    },
  });
  loginWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  loginWindow.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });

  return new Promise<WecomIdentity>((resolve, reject) => {
    let callbackCaptured = false;
    let settled = false;
    const timeout = setTimeout(() => finish(new Error('企业微信二维码已超时，请重新扫码')), LOGIN_TIMEOUT_MS);

    const finish = (result: WecomIdentity | Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (!loginWindow.isDestroyed()) loginWindow.destroy();
      if (result instanceof Error) reject(result);
      else resolve(result);
    };

    const inspectNavigation = (event: Electron.Event, targetUrl: string) => {
      if (isWecomCallbackUrl(targetUrl, config.redirectUri)) {
        event.preventDefault();
        if (callbackCaptured) return;
        callbackCaptured = true;
        const callback = new URL(targetUrl);
        const callbackState = callback.searchParams.get('state');
        const code = callback.searchParams.get('code');
        if (callbackState !== state) {
          finish(new Error('企业微信登录 state 校验失败，请重新扫码'));
          return;
        }
        if (!code) {
          finish(new Error('企业微信未返回授权 code，登录已取消'));
          return;
        }
        void exchangeWecomCode(config, code)
          .then((member) => finish({
            corpId: config.corpId,
            ...member,
            authenticatedAt: new Date().toISOString(),
          }))
          .catch((error) => finish(asError(error)));
        return;
      }
      if (!isAllowedWecomUrl(targetUrl)) event.preventDefault();
    };

    loginWindow.webContents.on('will-redirect', inspectNavigation);
    loginWindow.webContents.on('will-navigate', inspectNavigation);
    loginWindow.once('ready-to-show', () => loginWindow.show());
    loginWindow.once('closed', () => {
      if (!callbackCaptured) finish(new Error('已取消企业微信扫码登录'));
    });
    void loginWindow.loadURL(buildWecomLoginUrl(config, state)).catch((error) => finish(asError(error)));
  });
}

function isAllowedWecomUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && (
      url.hostname === 'open.work.weixin.qq.com'
      || url.hostname === 'work.weixin.qq.com'
      || url.hostname.endsWith('.work.weixin.qq.com')
    );
  } catch {
    return false;
  }
}

function readStoredIdentity(identityPath: string, corpId: string): WecomIdentity | null {
  try {
    if (!existsSync(identityPath)) return null;
    const value = JSON.parse(readFileSync(identityPath, 'utf8')) as Partial<WecomIdentity>;
    if (value.corpId !== corpId || typeof value.userId !== 'string' || !value.userId) return null;
    return {
      corpId,
      userId: value.userId,
      name: typeof value.name === 'string' && value.name ? value.name : value.userId,
      avatar: typeof value.avatar === 'string' ? value.avatar : '',
      email: typeof value.email === 'string' ? value.email : '',
      mobile: typeof value.mobile === 'string' ? value.mobile : '',
      departmentIds: Array.isArray(value.departmentIds)
        ? value.departmentIds.filter((item): item is number => Number.isInteger(item))
        : [],
      authenticatedAt: typeof value.authenticatedAt === 'string' ? value.authenticatedAt : '',
    };
  } catch {
    return null;
  }
}

function writeStoredIdentity(identityPath: string, identity: WecomIdentity): void {
  mkdirSync(path.dirname(identityPath), { recursive: true });
  writeFileSync(identityPath, `${JSON.stringify(identity, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
