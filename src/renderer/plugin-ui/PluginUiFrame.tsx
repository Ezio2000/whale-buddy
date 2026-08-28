import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type {
  PluginComposerContextValue,
  PluginToolCardContext,
  PluginUiContribution,
  PluginUiDescriptor,
  PluginUiFrameContext,
} from '../../shared/plugin-ui';
import { WHALE_PLUGIN_MESSAGE_CHANNEL } from '../../shared/plugin-ui';
import { contextKey, pluginStateKey, usePluginUi } from './PluginUiProvider';

interface PluginUiFrameProps {
  descriptor: PluginUiDescriptor;
  contribution: PluginUiContribution;
  threadId: string;
  toolCall?: PluginToolCardContext;
  className?: string;
  fallback?: ReactNode;
}

export function PluginUiFrame({
  descriptor,
  contribution,
  threadId,
  toolCall,
  className,
  fallback = null,
}: PluginUiFrameProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const nonce = useMemo(() => crypto.randomUUID(), []);
  const [height, setHeight] = useState(contribution.type === 'composer.widget' ? 26 : 120);
  const [width, setWidth] = useState(contribution.type === 'composer.widget' ? 26 : 0);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>(
    document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light',
  );
  const { setComposerContext } = usePluginUi();

  const frameContext = useCallback((): PluginUiFrameContext => ({
    apiVersion: 1,
    pluginId: descriptor.pluginId,
    pluginName: descriptor.pluginName,
    contributionId: contribution.id,
    contributionType: contribution.type,
    locale: document.documentElement.lang || 'zh-CN',
    theme,
    threadId,
    ...(toolCall ? { toolCall } : {}),
  }), [contribution.id, contribution.type, descriptor.pluginId, descriptor.pluginName, theme, threadId, toolCall]);

  const sendContext = useCallback((type: 'host:init' | 'host:context') => {
    iframeRef.current?.contentWindow?.postMessage({
      channel: WHALE_PLUGIN_MESSAGE_CHANNEL,
      nonce,
      type,
      context: frameContext(),
    }, '*');
  }, [frameContext, nonce]);

  useEffect(() => {
    if (ready) sendContext('host:context');
  }, [ready, sendContext]);

  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(
      document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light',
    ));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (ready) return;
    const timer = window.setTimeout(() => setFailed(true), 5_000);
    return () => window.clearTimeout(timer);
  }, [ready]);

  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const message = asRecord(event.data);
      if (message?.channel !== WHALE_PLUGIN_MESSAGE_CHANNEL || message.nonce !== nonce) return;
      if (message.type === 'plugin:ready') {
        setReady(true);
        return;
      }
      if (message.type === 'plugin:resize') {
        const requested = typeof message.height === 'number' ? message.height : 0;
        const min = contribution.type === 'composer.widget' ? 26 : 40;
        const max = contribution.type === 'composer.widget' ? 360 : 640;
        setHeight(Math.max(min, Math.min(max, Math.ceil(requested))));
        if (contribution.type === 'composer.widget') {
          const requestedWidth = typeof message.width === 'number' ? message.width : 26;
          setWidth(Math.max(26, Math.min(380, Math.ceil(requestedWidth))));
        }
        return;
      }
      if (message.type !== 'plugin:request') return;
      const requestId = typeof message.requestId === 'string' ? message.requestId : null;
      const method = typeof message.method === 'string' ? message.method : null;
      if (!requestId || !method) return;
      void handleRequest(method, message.payload)
        .then((result) => respond(requestId, true, result))
        .catch((error) => respond(
          requestId,
          false,
          undefined,
          error instanceof Error ? error.message : String(error),
        ));
    };

    const respond = (
      requestId: string,
      ok: boolean,
      result?: unknown,
      error?: string,
    ) => iframeRef.current?.contentWindow?.postMessage({
      channel: WHALE_PLUGIN_MESSAGE_CHANNEL,
      nonce,
      type: 'host:response',
      requestId,
      ok,
      result,
      error,
    }, '*');

    const handleRequest = async (method: string, raw: unknown): Promise<unknown> => {
      const payload = asRecord(raw) ?? {};
      if (method === 'state.get') {
        return readPluginState(descriptor.pluginId, contribution.id, threadId);
      }
      if (method === 'state.set') {
        writePluginState(descriptor.pluginId, contribution.id, threadId, payload.value);
        return null;
      }
      if (method === 'mcp.callOwn') {
        const server = requiredString(payload.server);
        const tool = requiredString(payload.tool);
        return window.whale.plugins.uiCallTool({
          pluginId: descriptor.pluginId,
          contributionId: contribution.id,
          threadId,
          server,
          tool,
          arguments: jsonValue(payload.arguments) ?? {},
        });
      }
      if (method === 'composer.setContext') {
        if (contribution.type !== 'composer.widget') throw new Error('只有输入区 Widget 可以设置上下文');
        const value = parseComposerContext(payload);
        assertOwnTools(value, descriptor);
        setComposerContext(descriptor.pluginId, contribution.id, threadId, value);
        return null;
      }
      if (method === 'composer.clearContext') {
        if (contribution.type !== 'composer.widget') throw new Error('只有输入区 Widget 可以清除上下文');
        setComposerContext(descriptor.pluginId, contribution.id, threadId, null);
        return null;
      }
      throw new Error(`不支持的插件 UI 请求：${method}`);
    };

    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, [contribution, descriptor, nonce, setComposerContext, threadId]);

  if (failed) return fallback;

  return (
    <iframe
      ref={iframeRef}
      className={`plugin-ui-frame ${className ?? ''} ${ready ? 'ready' : 'loading'}`}
      src={contribution.entryUrl}
      title={`${descriptor.displayName} · ${contribution.id}`}
      sandbox="allow-scripts allow-same-origin"
      scrolling="no"
      style={{
        height,
        ...(contribution.type === 'composer.widget' ? { width } : {}),
      }}
      onLoad={() => sendContext('host:init')}
      onError={() => setFailed(true)}
    />
  );
}

export function composerContextFor(
  contexts: Record<string, PluginComposerContextValue>,
  descriptor: PluginUiDescriptor,
  contribution: PluginUiContribution,
  threadId: string,
): PluginComposerContextValue | null {
  return contexts[contextKey(descriptor.pluginId, contribution.id, threadId)] ?? null;
}

function readPluginState(pluginId: string, contributionId: string, threadId: string): unknown {
  try {
    const raw = window.localStorage.getItem(pluginStateKey(pluginId, contributionId, threadId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writePluginState(
  pluginId: string,
  contributionId: string,
  threadId: string,
  value: unknown,
): void {
  const key = pluginStateKey(pluginId, contributionId, threadId);
  if (value === null || value === undefined) {
    window.localStorage.removeItem(key);
    return;
  }
  const normalized = jsonValue(value);
  if (normalized === null && value !== null) throw new Error('插件状态必须是 JSON');
  const encoded = JSON.stringify(normalized);
  if (encoded.length > 65_536) throw new Error('插件状态超过 64 KB');
  window.localStorage.setItem(key, encoded);
}

function parseComposerContext(value: Record<string, unknown>): PluginComposerContextValue {
  const label = requiredString(value.label);
  const parsed = jsonValue(value.value);
  if (parsed === null && value.value !== null) throw new Error('插件上下文必须是 JSON');
  const explicitTools = Array.isArray(value.explicitTools)
    ? value.explicitTools.flatMap((entry) => {
        const tool = asRecord(entry);
        return typeof tool?.server === 'string' && typeof tool.name === 'string'
          ? [{ server: tool.server, name: tool.name }]
          : [];
      }).slice(0, 20)
    : undefined;
  return { label, value: parsed, ...(explicitTools ? { explicitTools } : {}) };
}

function assertOwnTools(value: PluginComposerContextValue, descriptor: PluginUiDescriptor): void {
  for (const tool of value.explicitTools ?? []) {
    const declaredByCard = descriptor.contributions.some((entry) =>
      entry.type === 'mcp.toolCard'
      && entry.server === tool.server
      && entry.tools.includes(tool.name));
    if (!declaredByCard) {
      throw new Error(`插件不能附加未授权工具 ${tool.server}.${tool.name}`);
    }
  }
}

function jsonValue(value: unknown): PluginComposerContextValue['value'] | null {
  try {
    return JSON.parse(JSON.stringify(value)) as PluginComposerContextValue['value'];
  } catch {
    return null;
  }
}

function requiredString(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 512) {
    throw new Error('插件请求包含无效名称');
  }
  return value.trim();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
