export const WHALE_PLUGIN_MESSAGE_CHANNEL = 'whale-plugin-v2';
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type PluginStateScope = 'global' | 'project' | 'thread';
export interface HostAttachment {
  id?: string; name: string; path: string; kind: 'image' | 'file'; mimeType?: string;
  size?: number; sha256?: string; originalPath?: string | null;
}
export interface HostArtifact {
  id: string; name: string; path: string; format: 'html' | 'docx' | 'xlsx'; mimeType: string;
  size: number; sha256: string; threadId: string; taskId: string; createdAt: number;
}

export interface ToolCallContext {
  itemId: string; server: string; tool: string; status: string;
  arguments: JsonValue | null; result: JsonValue | null; error: JsonValue | null;
  readOnlyHint: boolean | null;
}
export interface MessageContext { itemId: string; itemType: string; status: string; data: JsonValue }
export interface PluginCredential {
  id: string; key: string; credentialType: 'apiKey' | 'bearerToken'; label: string;
  description: string; env: string; required: boolean; scope: 'marketplace';
  mcpServers: string[]; value: string | null;
}
export type PluginSurface =
  | { kind: 'ui'; contributionId: string; contributionType: 'page' | 'action' | 'widget' | 'card'; placement: 'navigation' | 'commandPalette' | 'threadToolbar' | 'composerToolbar' | 'composer' | 'message' }
  | { kind: 'runtime' };
export interface PluginContext {
  apiVersion: 2; pluginId: string; pluginName: string; surface: PluginSurface;
  locale: string; theme: 'light' | 'dark'; threadId: string | null;
  project: { id: string; name: string; path: string } | null;
  thread: { id: string; name: string; cwd: string } | null;
  credentials: PluginCredential[]; toolCall?: ToolCallContext; message?: MessageContext;
}
export type HostEvent = { type: string; [key: string]: unknown };

let nonce = '';
let context: PluginContext | null = null;
const contextListeners = new Set<(value: PluginContext) => void>();
const eventListeners = new Set<(value: HostEvent) => void>();
const readyListeners = new Set<() => void>();
const toolListeners = new Set<(call: { callId: string; toolId: string; input: JsonValue; context: PluginContext }) => void>();
const pending = new Map<string, { resolve(value: unknown): void; reject(reason: Error): void }>();

window.addEventListener('message', (event: MessageEvent) => {
  if (event.source !== window.parent || event.data?.channel !== WHALE_PLUGIN_MESSAGE_CHANNEL) return;
  const data = event.data as Record<string, unknown>;
  if (data.type === 'host:init' || data.type === 'host:context') {
    nonce = String(data.nonce ?? '');
    context = data.context as PluginContext;
    document.documentElement.dataset.theme = context.theme;
    document.documentElement.lang = context.locale;
    for (const listener of contextListeners) listener(context);
    for (const listener of readyListeners) listener();
    if (context.surface.kind === 'ui') { post({ type: 'plugin:ready' }); reportSize(); }
    return;
  }
  if (data.nonce !== nonce) return;
  if (data.type === 'host:response') {
    const requestId = String(data.requestId ?? '');
    const request = pending.get(requestId);
    if (!request) return;
    pending.delete(requestId);
    if (data.ok === true) request.resolve(data.result);
    else request.reject(new Error(typeof data.error === 'string' ? data.error : 'Whale 插件请求失败'));
  } else if (data.type === 'host:event') {
    for (const listener of eventListeners) listener(data.event as HostEvent);
  } else if (data.type === 'host:toolCall') {
    const call = data as unknown as { callId: string; toolId: string; input: JsonValue; context: PluginContext };
    for (const listener of toolListeners) listener(call);
  }
});

export function currentContext(): PluginContext | null { return context; }
export function onContext(listener: (value: PluginContext) => void): () => void {
  contextListeners.add(listener); if (context) listener(context);
  return () => contextListeners.delete(listener);
}
export function onHostEvent(listener: (value: HostEvent) => void): () => void {
  eventListeners.add(listener); return () => eventListeners.delete(listener);
}
export function onReady(listener: () => void): () => void {
  readyListeners.add(listener); if (context) listener(); return () => readyListeners.delete(listener);
}
export function onToolCall(listener: (call: { callId: string; toolId: string; input: JsonValue; context: PluginContext }) => void): () => void {
  toolListeners.add(listener); return () => toolListeners.delete(listener);
}
export function request<T = unknown>(method: string, payload: unknown): Promise<T> {
  if (!nonce || !context) return Promise.reject(new Error('Whale 插件宿主尚未就绪'));
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    pending.set(requestId, { resolve, reject });
    post({ type: 'plugin:request', requestId, method, payload });
  }) as Promise<T>;
}
export function post(message: Record<string, unknown>): void {
  window.parent.postMessage({ channel: WHALE_PLUGIN_MESSAGE_CHANNEL, nonce, ...message }, '*');
}
export function reportSize(): void {
  const target = document.querySelector<HTMLElement>('#root > *') ?? document.getElementById('root') ?? document.body;
  const bounds = target.getBoundingClientRect();
  post({ type: 'plugin:resize', height: Math.ceil(Math.max(1, bounds.height, target.scrollHeight)), width: Math.ceil(Math.max(1, bounds.width, target.scrollWidth)) });
}
