import { useEffect, useState } from 'react';

export const WHALE_PLUGIN_MESSAGE_CHANNEL = 'whale-plugin-ui-v1';

export type JsonValue = string | number | boolean | null | JsonValue[] | {
  [key: string]: JsonValue;
};

export interface ToolCallContext {
  itemId: string;
  server: string;
  tool: string;
  status: string;
  arguments: JsonValue | null;
  result: JsonValue | null;
  error: JsonValue | null;
  readOnlyHint: boolean | null;
}

export interface WhalePluginContext {
  apiVersion: 1;
  pluginId: string;
  pluginName: string;
  contributionId: string;
  contributionType: 'composer.widget' | 'mcp.toolCard';
  locale: string;
  theme: 'light' | 'dark';
  threadId: string;
  toolCall?: ToolCallContext;
}

interface InitMessage {
  channel: typeof WHALE_PLUGIN_MESSAGE_CHANNEL;
  nonce: string;
  type: 'host:init' | 'host:context';
  context: WhalePluginContext;
}

interface ResponseMessage {
  channel: typeof WHALE_PLUGIN_MESSAGE_CHANNEL;
  nonce: string;
  type: 'host:response';
  requestId: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

let nonce = '';
let context: WhalePluginContext | null = null;
const contextListeners = new Set<(value: WhalePluginContext) => void>();
const pending = new Map<string, {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
}>();

window.addEventListener('message', (event: MessageEvent<InitMessage | ResponseMessage>) => {
  if (event.source !== window.parent || event.data?.channel !== WHALE_PLUGIN_MESSAGE_CHANNEL) return;
  if (event.data.type === 'host:init' || event.data.type === 'host:context') {
    nonce = event.data.nonce;
    context = event.data.context;
    document.documentElement.dataset.theme = context.theme;
    document.documentElement.lang = context.locale;
    for (const listener of contextListeners) listener(context);
    post({ type: 'plugin:ready' });
    reportHeight();
    return;
  }
  if (event.data.type === 'host:response' && event.data.nonce === nonce) {
    const request = pending.get(event.data.requestId);
    if (!request) return;
    pending.delete(event.data.requestId);
    if (event.data.ok) request.resolve(event.data.result);
    else request.reject(new Error(event.data.error ?? 'Whale 插件请求失败'));
  }
});

let observedContributionRoot: Element | null = null;
const resizeObserver = new ResizeObserver(() => reportHeight());
const mutationObserver = new MutationObserver(() => {
  observeContributionRoot();
  window.requestAnimationFrame(reportHeight);
});

observeContributionRoot();
mutationObserver.observe(document.body, {
  attributes: true,
  characterData: true,
  childList: true,
  subtree: true,
});

export function useWhalePlugin(): WhalePluginContext | null {
  const [value, setValue] = useState(context);
  useEffect(() => {
    contextListeners.add(setValue);
    if (context) setValue(context);
    return () => { contextListeners.delete(setValue); };
  }, []);
  return value;
}

export async function callOwnMcp<T = unknown>(
  server: string,
  tool: string,
  args: JsonValue = {},
): Promise<T> {
  return request('mcp.callOwn', { server, tool, arguments: args }) as Promise<T>;
}

export async function getState<T extends JsonValue = JsonValue>(): Promise<T | null> {
  return request('state.get', {}) as Promise<T | null>;
}

export async function setState(value: JsonValue | null): Promise<void> {
  await request('state.set', { value });
}

export async function setComposerContext(input: {
  label: string;
  value: JsonValue;
  explicitTools?: Array<{ server: string; name: string }>;
}): Promise<void> {
  await request('composer.setContext', input);
}

export async function clearComposerContext(): Promise<void> {
  await request('composer.clearContext', {});
}

export function reportHeight(): void {
  const target = contributionRoot();
  const bounds = target.getBoundingClientRect();
  const overflowY = window.getComputedStyle(target).overflowY;
  const clipsOrScrolls = ['auto', 'scroll', 'hidden', 'clip'].includes(overflowY);
  post({
    type: 'plugin:resize',
    height: Math.ceil(Math.max(1, bounds.height, clipsOrScrolls ? 0 : target.scrollHeight)),
    width: Math.ceil(Math.max(1, bounds.width, target.scrollWidth)),
  });
}

function contributionRoot(): HTMLElement {
  return document.querySelector<HTMLElement>('#root > *')
    ?? document.getElementById('root')
    ?? document.body;
}

function observeContributionRoot(): void {
  const target = contributionRoot();
  if (target === observedContributionRoot) return;
  if (observedContributionRoot) resizeObserver.unobserve(observedContributionRoot);
  observedContributionRoot = target;
  resizeObserver.observe(target);
}

function request(method: string, payload: unknown): Promise<unknown> {
  if (!nonce || !context) return Promise.reject(new Error('Whale 插件宿主尚未就绪'));
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    pending.set(requestId, { resolve, reject });
    post({ type: 'plugin:request', requestId, method, payload });
  });
}

function post(message: Record<string, unknown>): void {
  window.parent.postMessage({
    channel: WHALE_PLUGIN_MESSAGE_CHANNEL,
    nonce,
    ...message,
  }, '*');
}
