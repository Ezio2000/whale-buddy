export const WECOM_AUTH_IPC = Object.freeze({
  status: 'whale-wecom-auth:status',
  login: 'whale-wecom-auth:login',
  logout: 'whale-wecom-auth:logout',
});

export interface WecomIdentity {
  corpId: string;
  userId: string;
  name: string;
  avatar: string;
  email: string;
  mobile: string;
  departmentIds: number[];
  authenticatedAt: string;
}

export interface WecomAuthStatus {
  configured: boolean;
  identity: WecomIdentity | null;
}

export interface WecomAuthApi {
  status(): Promise<WecomAuthStatus>;
  login(): Promise<WecomIdentity>;
  logout(): Promise<WecomAuthStatus>;
}

declare global {
  interface Window {
    whaleWecom: WecomAuthApi;
  }
}
