import { contextBridge, ipcRenderer } from 'electron';
import { WECOM_AUTH_IPC, type WecomAuthApi } from './types';

export function exposeWecomAuthApi(): void {
  const api: WecomAuthApi = {
    status: () => ipcRenderer.invoke(WECOM_AUTH_IPC.status),
    login: () => ipcRenderer.invoke(WECOM_AUTH_IPC.login),
    logout: () => ipcRenderer.invoke(WECOM_AUTH_IPC.logout),
  };
  contextBridge.exposeInMainWorld('whaleWecom', Object.freeze(api));
}
