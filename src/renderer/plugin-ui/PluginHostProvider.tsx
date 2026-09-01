import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import type {
  PluginComposerContextValue, PluginDescriptor, PluginHostEvent, PluginStateScope,
  PluginUiContribution,
} from '../../shared/plugin';
import type { JsonValue, LocalAttachment, WhaleEvent } from '../../shared/types';
import { useAppStore } from '../state/store';
import { PluginRuntimeFrame } from './PluginUiFrame';

export interface PluginUiTarget { pluginId: string; contributionId: string }
type RuntimeInvoker = (toolId: string, input: JsonValue, threadId: string | null) => Promise<JsonValue>;
type HostEventListener = (event: PluginHostEvent) => void;
interface RuntimeWaiter { resolve(invoke: RuntimeInvoker): void; reject(error: Error): void; timer: number }

interface PluginHostContextValue {
  descriptors: PluginDescriptor[];
  composerContexts: Record<string, PluginComposerContextValue>;
  activeNavigation: PluginUiTarget | null;
  activeAction: PluginUiTarget | null;
  selectNavigation(target: PluginUiTarget | null): void;
  openAction(target: PluginUiTarget): void;
  closeAction(): void;
  setComposerContext(pluginId: string, sourceId: string, threadId: string, value: PluginComposerContextValue | null): void;
  getState(pluginId: string, scope: PluginStateScope, scopeId: string): JsonValue | null;
  setState(pluginId: string, scope: PluginStateScope, scopeId: string, value: JsonValue | null): void;
  callMcp(input: Parameters<typeof window.whale.plugins.callMcp>[0]): Promise<JsonValue>;
  invokeTool(pluginId: string, toolId: string, input: JsonValue, threadId?: string | null): Promise<JsonValue>;
  startTask(input: { pluginId: string; contributionId: string; toolName: string; title: string; prompt: string; attachments: LocalAttachment[]; context: JsonValue }): Promise<{ threadId: string }>;
  registerRuntime(pluginId: string, invoke: RuntimeInvoker): () => void;
  subscribe(listener: HostEventListener): () => void;
  reload(): Promise<void>;
}

const PluginHostContext = createContext<PluginHostContextValue | null>(null);
const STORAGE_PREFIX = 'whale.plugin.v2.';
const EMPTY_HOST: PluginHostContextValue = {
  descriptors: [], composerContexts: {}, activeNavigation: null, activeAction: null,
  selectNavigation: () => undefined, openAction: () => undefined, closeAction: () => undefined,
  setComposerContext: () => undefined, getState: () => null, setState: () => undefined,
  callMcp: () => Promise.reject(new Error('PluginHostProvider 尚未挂载')),
  invokeTool: () => Promise.reject(new Error('PluginHostProvider 尚未挂载')),
  startTask: () => Promise.reject(new Error('PluginHostProvider 尚未挂载')),
  registerRuntime: () => () => undefined, subscribe: () => () => undefined,
  reload: async () => undefined,
};

export function PluginHostProvider({ children }: { children: React.ReactNode }) {
  const runtime = useAppStore((state) => state.runtime);
  const workspaceView = useAppStore((state) => state.workspaceView);
  const setWorkspaceView = useAppStore((state) => state.setWorkspaceView);
  const selectedThreadId = useAppStore((state) => state.selectedThreadId);
  const [descriptors, setDescriptors] = useState<PluginDescriptor[]>([]);
  const [composerContexts, setComposerContexts] = useState<Record<string, PluginComposerContextValue>>(() => readComposerContexts());
  const [activeNavigation, selectNavigation] = useState<PluginUiTarget | null>(null);
  const [activeAction, setActiveAction] = useState<PluginUiTarget | null>(null);
  const runtimes = useRef(new Map<string, RuntimeInvoker>());
  const runtimeWaiters = useRef(new Map<string, Set<RuntimeWaiter>>());
  const listeners = useRef(new Set<HostEventListener>());
  const invokeToolRef = useRef<PluginHostContextValue['invokeTool']>(() => Promise.reject(new Error('插件宿主尚未就绪')));

  const emit = useCallback((event: PluginHostEvent) => {
    for (const listener of listeners.current) listener(event);
  }, []);
  const reload = useCallback(async () => {
    if (runtime?.phase !== 'ready') return setDescriptors([]);
    try { setDescriptors(await window.whale.plugins.descriptors()); } catch { setDescriptors([]); }
  }, [runtime?.phase]);

  useEffect(() => { void reload(); }, [reload, runtime?.generation]);
  useEffect(() => window.whale.events.subscribe((event) => {
    if (event.kind === 'runtime' && event.event.type === 'pluginsChanged') {
      if (event.event.clearPluginId) clearPluginData(event.event.clearPluginId, setComposerContexts);
      void reload();
    }
  }), [reload]);
  useEffect(() => {
    if (activeNavigation && !findPluginUiContribution(descriptors, activeNavigation, 'page')) {
      selectNavigation(null);
      if (workspaceView === 'plugin') setWorkspaceView('conversation');
    }
    if (activeAction) {
      const resolved = findPluginUiContribution(descriptors, activeAction);
      if (!resolved || resolved.contribution.type !== 'action') setActiveAction(null);
    }
  }, [activeAction, activeNavigation, descriptors, setWorkspaceView, workspaceView]);

  const setComposerContext = useCallback((pluginId: string, sourceId: string, threadId: string, value: PluginComposerContextValue | null) => {
    const key = contextKey(pluginId, sourceId, threadId);
    setComposerContexts((current) => {
      const next = { ...current };
      if (value) next[key] = value; else delete next[key];
      persistComposerContexts(next);
      return next;
    });
    emit({ type: 'composerContext.changed', pluginId, sourceId, threadId, value });
  }, [emit]);
  const getState = useCallback((pluginId: string, scope: PluginStateScope, scopeId: string) => {
    try {
      const raw = window.localStorage.getItem(pluginStateKey(pluginId, scope, scopeId));
      return raw ? JSON.parse(raw) as JsonValue : null;
    } catch { return null; }
  }, []);
  const setState = useCallback((pluginId: string, scope: PluginStateScope, scopeId: string, value: JsonValue | null) => {
    const key = pluginStateKey(pluginId, scope, scopeId);
    if (value === null) window.localStorage.removeItem(key);
    else {
      const encoded = JSON.stringify(value);
      if (encoded.length > 2_097_152) throw new Error('插件状态超过 2 MB');
      window.localStorage.setItem(key, encoded);
    }
    emit({ type: 'state.changed', pluginId, scope, scopeId, value });
  }, [emit]);
  const registerRuntime = useCallback((pluginId: string, invoke: RuntimeInvoker) => {
    runtimes.current.set(pluginId, invoke);
    for (const waiter of runtimeWaiters.current.get(pluginId) ?? []) {
      window.clearTimeout(waiter.timer);
      waiter.resolve(invoke);
    }
    runtimeWaiters.current.delete(pluginId);
    return () => { if (runtimes.current.get(pluginId) === invoke) runtimes.current.delete(pluginId); };
  }, []);
  const invokeTool = useCallback(async (pluginId: string, toolId: string, input: JsonValue, requestedThreadId = selectedThreadId) => {
    const invoke = runtimes.current.get(pluginId) ?? await new Promise<RuntimeInvoker>((resolve, reject) => {
      const waiter: RuntimeWaiter = {
        resolve, reject,
        timer: window.setTimeout(() => {
          runtimeWaiters.current.get(pluginId)?.delete(waiter);
          reject(new Error(`插件 ${pluginId} 的 WebMCP runtime 尚未就绪`));
        }, 5_000),
      };
      const waiters = runtimeWaiters.current.get(pluginId) ?? new Set<RuntimeWaiter>();
      waiters.add(waiter);
      runtimeWaiters.current.set(pluginId, waiters);
    });
    const callId = crypto.randomUUID();
    emit({ type: 'tool.started', pluginId, toolId, callId });
    try {
      const result = await invoke(toolId, input, requestedThreadId);
      emit({ type: 'tool.completed', pluginId, toolId, callId, result });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      emit({ type: 'tool.failed', pluginId, toolId, callId, error: message });
      throw error;
    }
  }, [emit, selectedThreadId]);
  const startTask = useCallback(async (input: {
    pluginId: string; contributionId: string; toolName: string; title: string; prompt: string;
    attachments: LocalAttachment[]; context: JsonValue;
  }) => {
    await useAppStore.getState().newThread();
    const threadId = useAppStore.getState().selectedThreadId;
    if (!threadId) throw new Error('无法创建办公任务线程，请先打开项目');
    await useAppStore.getState().renameThread(input.title, threadId);
    const sent = await useAppStore.getState().sendComposer(
      input.prompt,
      input.attachments,
      undefined,
      undefined,
      undefined,
      [{ pluginId: input.pluginId, name: input.toolName }],
      [{
        pluginId: input.pluginId,
        contributionId: input.contributionId,
        label: input.title,
        value: input.context,
      }],
    );
    if (!sent) throw new Error('办公任务未能启动');
    setWorkspaceView('conversation');
    return { threadId };
  }, [setWorkspaceView]);
  useEffect(() => { invokeToolRef.current = invokeTool; }, [invokeTool]);

  useEffect(() => () => {
    for (const waiters of runtimeWaiters.current.values()) for (const waiter of waiters) {
      window.clearTimeout(waiter.timer);
      waiter.reject(new Error('插件宿主已卸载'));
    }
    runtimeWaiters.current.clear();
  }, []);

  useEffect(() => window.whale.events.subscribe((event: WhaleEvent) => {
    if (event.kind !== 'serverRequest' || event.message.method !== 'item/tool/call') return;
    const params = asRecord(event.message.params);
    const toolName = typeof params?.tool === 'string' ? params.tool : '';
    const resolved = descriptors.flatMap((descriptor) => (descriptor.webMcp?.tools ?? []).map((tool) => ({ descriptor, tool })))
      .find(({ tool }) => tool.name === toolName);
    if (!resolved) {
      void window.whale.approvals.respond({
        requestId: event.message.id, method: event.message.method,
        response: { contentItems: [{ type: 'inputText', text: `WebMCP 工具 ${toolName || '（未知名称）'} 不存在或所属插件已停用` }], success: false },
      }).catch(() => undefined);
      return;
    }
    void invokeTool(resolved.descriptor.pluginId, resolved.tool.id, toJsonValue(params?.arguments) ?? {}, typeof params?.threadId === 'string' ? params.threadId : null)
      .then(
        (result) => window.whale.approvals.respond({
          requestId: event.message.id, method: event.message.method,
          response: { contentItems: [{ type: 'inputText', text: resultText(result) }], success: true },
        }).catch(() => undefined),
        (error) => window.whale.approvals.respond({
          requestId: event.message.id, method: event.message.method,
          response: { contentItems: [{ type: 'inputText', text: error instanceof Error ? error.message : String(error) }], success: false },
        }).catch(() => undefined),
      );
  }), [descriptors, invokeTool]);

  useEffect(() => {
    const modelContext = webMcpModelContext(document);
    if (!modelContext) return;
    const controller = new AbortController();
    for (const descriptor of descriptors) for (const tool of descriptor.webMcp?.tools ?? []) {
      void modelContext.registerTool({
        name: tool.name, title: tool.title, description: tool.description,
        inputSchema: tool.inputSchema, annotations: tool.annotations,
        execute: (input) => invokeToolRef.current(descriptor.pluginId, tool.id, toJsonValue(input) ?? {}),
      }, { signal: controller.signal }).catch(() => undefined);
    }
    return () => controller.abort();
  }, [descriptors]);

  const value = useMemo<PluginHostContextValue>(() => ({
    descriptors, composerContexts, activeNavigation, activeAction, selectNavigation,
    openAction: setActiveAction, closeAction: () => setActiveAction(null), setComposerContext,
    getState, setState, callMcp: (input) => window.whale.plugins.callMcp(input), invokeTool, startTask,
    registerRuntime, subscribe: (listener) => { listeners.current.add(listener); return () => listeners.current.delete(listener); }, reload,
  }), [activeAction, activeNavigation, composerContexts, descriptors, getState, invokeTool, registerRuntime, reload, setComposerContext, setState, startTask]);

  return <PluginHostContext.Provider value={value}>{children}<div hidden aria-hidden="true">
    {descriptors.filter((entry) => entry.webMcp).map((descriptor) => <PluginRuntimeFrame key={descriptor.pluginId} descriptor={descriptor} />)}
  </div></PluginHostContext.Provider>;
}

export function usePluginHost(): PluginHostContextValue {
  return useContext(PluginHostContext) ?? EMPTY_HOST;
}

export function findPluginUiContribution(descriptors: PluginDescriptor[], target: PluginUiTarget, type?: PluginUiContribution['type']) {
  const descriptor = descriptors.find((entry) => entry.pluginId === target.pluginId);
  const contribution = descriptor?.uiContributions.find((entry) => entry.id === target.contributionId && (!type || entry.type === type));
  return descriptor && contribution ? { descriptor, contribution } : null;
}
export function contextKey(pluginId: string, sourceId: string, threadId: string): string {
  return `${pluginId}\u0000${sourceId}\u0000${threadId}`;
}
export function pluginStateKey(pluginId: string, scope: PluginStateScope, scopeId: string): string {
  return `${STORAGE_PREFIX}state.${encodeURIComponent(pluginId)}.${scope}.${encodeURIComponent(scopeId)}`;
}
function readComposerContexts(): Record<string, PluginComposerContextValue> {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(`${STORAGE_PREFIX}composer`) ?? '{}') as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, PluginComposerContextValue> : {};
  } catch { return {}; }
}
function persistComposerContexts(value: Record<string, PluginComposerContextValue>): void {
  try { window.localStorage.setItem(`${STORAGE_PREFIX}composer`, JSON.stringify(value)); } catch { /* best effort */ }
}
function clearPluginData(
  pluginId: string,
  updateContexts: React.Dispatch<React.SetStateAction<Record<string, PluginComposerContextValue>>>,
): void {
  const contextPrefix = `${pluginId}\u0000`;
  updateContexts((current) => {
    const next = Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith(contextPrefix)));
    persistComposerContexts(next);
    return next;
  });
  const statePrefix = `${STORAGE_PREFIX}state.${encodeURIComponent(pluginId)}.`;
  for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
    const key = window.localStorage.key(index);
    if (key?.startsWith(statePrefix)) window.localStorage.removeItem(key);
  }
}
function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function toJsonValue(value: unknown): JsonValue | null {
  try { return JSON.parse(JSON.stringify(value)) as JsonValue; } catch { return null; }
}
function resultText(value: JsonValue): string { return typeof value === 'string' ? value : JSON.stringify(value); }
interface WebMcpModelContext {
  registerTool(tool: { name: string; title: string; description: string; inputSchema: JsonValue; annotations: { readOnlyHint: boolean; untrustedContentHint: boolean }; execute(input: unknown): Promise<JsonValue> }, options: { signal: AbortSignal }): Promise<void>;
}
function webMcpModelContext(value: Document): WebMcpModelContext | null {
  const candidate = (value as Document & { modelContext?: unknown }).modelContext;
  return candidate && typeof (candidate as WebMcpModelContext).registerTool === 'function' ? candidate as WebMcpModelContext : null;
}
