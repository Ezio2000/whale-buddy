import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  WHALE_PLUGIN_MESSAGE_CHANNEL,
  type PluginComposerContextValue,
  type PluginDescriptor,
  type PluginFrameContext,
  type PluginFrameSurface,
  type PluginMessageContext,
  type PluginStateScope,
  type PluginToolCardContext,
  type PluginUiContribution,
} from '../../shared/plugin';
import type { ArtifactCreateInput, JsonValue, LocalAttachment } from '../../shared/types';
import { useAppStore } from '../state/store';
import { contextKey, usePluginHost } from './PluginHostProvider';

interface PluginUiFrameProps {
  descriptor: PluginDescriptor;
  contribution: PluginUiContribution;
  threadId: string | null;
  toolCall?: PluginToolCardContext;
  message?: PluginMessageContext;
  className?: string;
  fallback?: ReactNode;
}

export function PluginUiFrame(props: PluginUiFrameProps) {
  const { descriptor, contribution, threadId, toolCall, message, className, fallback = null } = props;
  const surface = useMemo<PluginFrameSurface>(() => ({
    kind: 'ui', contributionId: contribution.id,
    contributionType: contribution.type, placement: contribution.placement,
  }), [contribution.id, contribution.placement, contribution.type]);
  const isFullSurface = contribution.type === 'page' || contribution.type === 'action';
  const [height, setHeight] = useState(contribution.type === 'widget' ? 26 : 120);
  const [width, setWidth] = useState(contribution.type === 'widget' ? 26 : 0);
  const frame = usePluginFrame(descriptor, contribution.entryUrl, surface, threadId, toolCall, message);

  useEffect(() => frame.setResizeHandler((requestedHeight, requestedWidth) => {
    if (isFullSurface) return;
    setHeight(Math.max(contribution.type === 'widget' ? 26 : 40, Math.min(640, Math.ceil(requestedHeight))));
    if (contribution.type === 'widget') setWidth(Math.max(26, Math.min(380, Math.ceil(requestedWidth ?? 26))));
  }), [contribution.type, frame, isFullSurface]);

  if (frame.failed) return fallback;
  return <iframe
    ref={frame.iframeRef}
    className={`plugin-ui-frame ${className ?? ''} ${frame.ready ? 'ready' : 'loading'}`}
    src={contribution.entryUrl}
    title={`${descriptor.displayName} · ${contribution.id}`}
    sandbox="allow-scripts allow-same-origin"
    scrolling="no"
    style={{ height: isFullSurface ? '100%' : height, ...(contribution.type === 'widget' ? { width } : {}) }}
    onLoad={frame.initialize}
    onError={() => frame.setFailed(true)}
  />;
}

export function PluginRuntimeFrame({ descriptor }: { descriptor: PluginDescriptor }) {
  const runtime = descriptor.webMcp;
  const threadId = useAppStore((state) => state.selectedThreadId);
  const surface = useMemo<PluginFrameSurface>(() => ({ kind: 'runtime' }), []);
  const frame = usePluginFrame(descriptor, runtime?.entryUrl ?? '', surface, threadId);
  if (!runtime) return null;
  return <iframe
    ref={frame.iframeRef}
    src={runtime.entryUrl}
    title={`${descriptor.displayName} WebMCP runtime`}
    sandbox="allow-scripts allow-same-origin"
    onLoad={frame.initialize}
    onError={() => frame.setFailed(true)}
  />;
}

function usePluginFrame(
  descriptor: PluginDescriptor,
  entryUrl: string,
  surface: PluginFrameSurface,
  threadId: string | null,
  toolCall?: PluginToolCardContext,
  message?: PluginMessageContext,
) {
  const selectedProject = useAppStore((state) => state.projects.find((project) => project.id === state.selectedProjectId) ?? null);
  const selectedThread = useAppStore((state) => state.threads.find((thread) => thread.id === threadId) ?? null);
  const host = usePluginHost();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const nonce = useMemo(() => crypto.randomUUID(), []);
  const pending = useRef(new Map<string, { resolve(value: JsonValue): void; reject(error: Error): void; timer: number }>());
  const executions = useRef(new Map<string, { threadId: string | null; toolId: string }>());
  const resizeHandler = useRef<(height: number, width?: number) => void>(() => undefined);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');

  const context = useCallback((): PluginFrameContext => ({
    apiVersion: 2, pluginId: descriptor.pluginId, pluginName: descriptor.pluginName, surface,
    locale: document.documentElement.lang || 'zh-CN', theme, threadId,
    project: selectedProject ? { id: selectedProject.id, name: selectedProject.name, path: selectedProject.path } : null,
    thread: selectedThread ? { id: selectedThread.id, name: selectedThread.name || selectedThread.preview || '未命名线程', cwd: selectedThread.cwd } : null,
    credentials: descriptor.credentials, ...(toolCall ? { toolCall } : {}), ...(message ? { message } : {}),
  }), [descriptor.credentials, descriptor.pluginId, descriptor.pluginName, message, selectedProject, selectedThread, surface, theme, threadId, toolCall]);
  const post = useCallback((data: Record<string, unknown>) => iframeRef.current?.contentWindow?.postMessage({ channel: WHALE_PLUGIN_MESSAGE_CHANNEL, nonce, ...data }, '*'), [nonce]);
  const sendContext = useCallback((type: 'host:init' | 'host:context') => post({ type, context: context() }), [context, post]);
  const initialize = useCallback(() => sendContext('host:init'), [sendContext]);

  useEffect(() => { if (ready) { sendContext('host:context'); post({ type: 'host:event', event: { type: 'context.changed', context: context() } }); } }, [context, post, ready, sendContext]);
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);
  useEffect(() => host.subscribe((event) => post({ type: 'host:event', event })), [host, post]);
  useEffect(() => {
    if (ready || surface.kind === 'runtime') return;
    const timer = window.setTimeout(() => setFailed(true), 5_000);
    return () => window.clearTimeout(timer);
  }, [ready, surface.kind]);

  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const packet = asRecord(event.data);
      if (packet?.channel !== WHALE_PLUGIN_MESSAGE_CHANNEL || packet.nonce !== nonce) return;
      if ((surface.kind === 'ui' && packet.type === 'plugin:ready')
        || (surface.kind === 'runtime' && packet.type === 'plugin:runtimeReady')) {
        if (surface.kind === 'runtime' && !matchesRuntimeTools(packet.toolIds, descriptor)) {
          setFailed(true);
          return;
        }
        setReady(true);
        return;
      }
      if (packet.type === 'plugin:resize') {
        resizeHandler.current(numberValue(packet.height), optionalNumber(packet.width));
        return;
      }
      if (packet.type === 'plugin:toolResult') {
        const callId = stringValue(packet.callId);
        const call = callId ? pending.current.get(callId) : null;
        if (!callId || !call) return;
        window.clearTimeout(call.timer);
        pending.current.delete(callId);
        executions.current.delete(callId);
        if (packet.ok === true) call.resolve(toJsonValue(packet.result) ?? null);
        else call.reject(new Error(stringValue(packet.error) ?? 'WebMCP 工具执行失败'));
        return;
      }
      if (packet.type !== 'plugin:request') return;
      const requestId = stringValue(packet.requestId);
      const method = stringValue(packet.method);
      if (!requestId || !method) return;
      const requestPayload = asRecord(packet.payload);
      const executionId = stringValue(requestPayload?.executionId);
      const execution = surface.kind === 'runtime' && executionId
        ? executions.current.get(executionId) ?? null
        : null;
      const effectiveThreadId = surface.kind === 'runtime' ? execution?.threadId ?? null : threadId;
      void handleRequest(host, descriptor, surface, effectiveThreadId, method, packet.payload, execution?.toolId ?? null, selectedProject?.id ?? null)
        .then((result) => post({ type: 'host:response', requestId, ok: true, result }))
        .catch((error) => post({ type: 'host:response', requestId, ok: false, error: error instanceof Error ? error.message : String(error) }));
    };
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, [descriptor, host, nonce, post, selectedProject?.id, surface, threadId]);

  useEffect(() => {
    if (surface.kind !== 'runtime' || !ready) return;
    return host.registerRuntime(descriptor.pluginId, (toolId, input, requestedThreadId) => new Promise((resolve, reject) => {
      const callId = crypto.randomUUID();
      const timer = window.setTimeout(() => {
        pending.current.delete(callId);
        executions.current.delete(callId);
        reject(new Error(`WebMCP 工具 ${toolId} 执行超时`));
      }, 60_000);
      pending.current.set(callId, { resolve, reject, timer });
      executions.current.set(callId, { threadId: requestedThreadId, toolId });
      const baseContext = context();
      const callContext = {
        ...baseContext,
        threadId: requestedThreadId,
        thread: baseContext.thread?.id === requestedThreadId ? baseContext.thread : null,
      };
      post({ type: 'host:toolCall', callId, toolId, input, context: callContext });
    }));
  }, [context, descriptor.pluginId, host, post, ready, surface.kind]);

  useEffect(() => () => {
    for (const call of pending.current.values()) { window.clearTimeout(call.timer); call.reject(new Error('插件 runtime 已卸载')); }
    pending.current.clear();
    executions.current.clear();
  }, []);
  return { iframeRef, ready, failed, setFailed, initialize, setResizeHandler: (handler: typeof resizeHandler.current) => { resizeHandler.current = handler; return () => { resizeHandler.current = () => undefined; }; } };
}

async function handleRequest(
  host: ReturnType<typeof usePluginHost>, descriptor: PluginDescriptor, surface: PluginFrameSurface,
  threadId: string | null, method: string, raw: unknown, executionToolId: string | null,
  projectId: string | null,
): Promise<JsonValue> {
  const payload = asRecord(raw) ?? {};
  const runtimePrincipal = surface.kind === 'runtime'
    ? assertRuntimePrincipal(payload.principalId, executionToolId)
    : null;
  if (method === 'state.get' || method === 'state.set') {
    const scope = parseScope(payload.scope);
    if (surface.kind === 'runtime') {
      const tool = descriptor.webMcp?.tools.find((entry) => entry.id === runtimePrincipal);
      if (!tool || tool.scope !== scope) throw new Error('WebMCP 工具不能访问声明范围之外的状态');
    }
    const scopeId = resolveScopeId(scope, payload.scopeId, threadId, projectId);
    if (method === 'state.get') return host.getState(descriptor.pluginId, scope, scopeId);
    const value = toJsonValue(payload.value);
    if (value === null && payload.value !== null) throw new Error('插件状态必须是 JSON');
    host.setState(descriptor.pluginId, scope, scopeId, value);
    return null;
  }
  if (method === 'mcp.call') {
    const principalId = surface.kind === 'ui' ? surface.contributionId : runtimePrincipal!;
    return host.callMcp({
      pluginId: descriptor.pluginId, principal: `${surface.kind === 'ui' ? 'ui' : 'webMcp'}:${principalId}`,
      threadId, server: requiredString(payload.server), tool: requiredString(payload.tool), arguments: toJsonValue(payload.arguments) ?? {},
    });
  }
  if (method === 'tool.invoke' && surface.kind === 'ui') {
    return host.invokeTool(descriptor.pluginId, requiredString(payload.toolId), toJsonValue(payload.arguments) ?? {}, threadId);
  }
  if ((method === 'composer.setContext' || method === 'composer.clearContext') && surface.kind === 'runtime') {
    if (!threadId) throw new Error('请先选择线程');
    const principalId = runtimePrincipal!;
    if (!descriptor.webMcp?.tools.some((tool) => tool.id === principalId && tool.scope === 'thread')) {
      throw new Error('只有 thread 范围的 WebMCP 工具可以修改输入上下文');
    }
    const sourceId = requiredString(payload.sourceId);
    const composerSource = descriptor.uiContributions.some((entry) =>
      entry.id === sourceId
      && (
        (entry.type === 'widget' && entry.placement === 'composer')
        || (entry.type === 'action' && entry.placement === 'composerToolbar')
      ));
    if (!composerSource) {
      throw new Error('WebMCP 只能写入已声明的输入区贡献上下文');
    }
    if (method === 'composer.clearContext') host.setComposerContext(descriptor.pluginId, sourceId, threadId, null);
    else {
      const value = parseComposerContext(payload);
      assertComposerTools(descriptor, principalId, value);
      host.setComposerContext(descriptor.pluginId, sourceId, threadId, value);
    }
    return null;
  }
  if (method === 'attachments.pick' && surface.kind === 'ui') {
    return toJsonValue(await window.whale.files.pickAttachments()) ?? [];
  }
  if (method === 'attachments.read') {
    return window.whale.files.readAttachment(requiredString(payload.path));
  }
  if (method === 'tasks.start' && surface.kind === 'ui') {
    const toolName = requiredString(payload.toolName);
    if (!descriptor.webMcp?.tools.some((tool) => tool.name === toolName)) throw new Error('办公任务指定了未声明的插件工具');
    return host.startTask({
      pluginId: descriptor.pluginId,
      contributionId: surface.contributionId,
      toolName,
      title: requiredString(payload.title),
      prompt: requiredString(payload.prompt),
      attachments: Array.isArray(payload.attachments)
        ? payload.attachments as unknown as LocalAttachment[]
        : [],
      context: toJsonValue(payload.context) ?? {},
    });
  }
  if (method === 'artifacts.create') {
    const input: ArtifactCreateInput = {
      name: requiredString(payload.name),
      format: requiredArtifactFormat(payload.format),
      dataBase64: requiredString(payload.dataBase64, 70_000_000),
      threadId: requiredString(payload.threadId),
      taskId: requiredString(payload.taskId),
    };
    return toJsonValue(await window.whale.artifacts.create(input)) ?? null;
  }
  if (method === 'artifacts.list') {
    return toJsonValue(await window.whale.artifacts.list(typeof payload.threadId === 'string' ? payload.threadId : undefined)) ?? [];
  }
  if (method === 'artifacts.open') { await window.whale.artifacts.open(requiredString(payload.id)); return null; }
  if (method === 'artifacts.saveAs') return window.whale.artifacts.saveAs(requiredString(payload.id));
  throw new Error(`不支持的插件宿主请求：${method}`);
}

function requiredArtifactFormat(value: unknown): ArtifactCreateInput['format'] {
  if (value === 'html' || value === 'docx' || value === 'xlsx' || value === 'pptx') return value;
  throw new Error('成果格式必须是 html、docx、xlsx 或 pptx');
}

export function composerContextFor(contexts: Record<string, PluginComposerContextValue>, descriptor: PluginDescriptor, contribution: PluginUiContribution, threadId: string) {
  return contexts[contextKey(descriptor.pluginId, contribution.id, threadId)] ?? null;
}
function parseComposerContext(value: Record<string, unknown>): PluginComposerContextValue {
  const label = requiredString(value.label);
  const parsed = toJsonValue(value.value);
  if (parsed === null && value.value !== null) throw new Error('插件上下文必须是 JSON');
  const explicitTools = Array.isArray(value.explicitTools) ? value.explicitTools.flatMap((entry) => {
    const tool = asRecord(entry);
    return typeof tool?.server === 'string' && typeof tool.name === 'string' ? [{ server: tool.server, name: tool.name }] : [];
  }).slice(0, 20) : undefined;
  return { label, value: parsed, ...(explicitTools ? { explicitTools } : {}) };
}
function assertComposerTools(
  descriptor: PluginDescriptor,
  principalId: string,
  value: PluginComposerContextValue,
): void {
  for (const tool of value.explicitTools ?? []) {
    const allowed = descriptor.mcpPermissions.some((permission) =>
      (permission.principal === `webMcp:${principalId}` || permission.principal === 'webMcp:*')
      && permission.server === tool.server
      && permission.tools.includes(tool.name));
    if (!allowed) throw new Error(`WebMCP 工具不能附加未授权工具 ${tool.server}.${tool.name}`);
  }
}
function parseScope(value: unknown): PluginStateScope {
  if (value === 'global' || value === 'project' || value === 'thread') return value;
  throw new Error('无效的插件状态范围');
}
function resolveScopeId(scope: PluginStateScope, requested: unknown, threadId: string | null, projectId: string | null): string {
  if (scope === 'global') return 'global';
  if (scope === 'thread') { if (!threadId) throw new Error('请先选择线程'); return threadId; }
  const explicit = stringValue(requested);
  if (explicit) return explicit;
  if (!projectId) throw new Error('请先选择项目');
  return projectId;
}
function assertRuntimePrincipal(value: unknown, executionToolId: string | null): string {
  if (!executionToolId) throw new Error('WebMCP runtime 请求不属于有效的工具执行');
  if (requiredString(value) !== executionToolId) throw new Error('WebMCP runtime 工具身份与当前执行不一致');
  return executionToolId;
}
function matchesRuntimeTools(value: unknown, descriptor: PluginDescriptor): boolean {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) return false;
  const declared = descriptor.webMcp?.tools.map((tool) => tool.id).sort() ?? [];
  const registered = [...new Set(value)].sort();
  return declared.length === registered.length && declared.every((toolId, index) => toolId === registered[index]);
}
function toJsonValue(value: unknown): JsonValue | null { try { return JSON.parse(JSON.stringify(value)) as JsonValue; } catch { return null; } }
function requiredString(value: unknown, maxLength = 512): string { const parsed = stringValue(value); if (!parsed || parsed.length > maxLength) throw new Error('插件请求包含无效名称'); return parsed; }
function stringValue(value: unknown): string | null { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function numberValue(value: unknown): number { return typeof value === 'number' && Number.isFinite(value) ? value : 0; }
function optionalNumber(value: unknown): number | undefined { return typeof value === 'number' && Number.isFinite(value) ? value : undefined; }
function asRecord(value: unknown): Record<string, unknown> | null { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null; }
