import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type {
  PluginComposerContextValue,
  PluginUiContribution,
  PluginUiDescriptor,
} from '../../shared/plugin-ui';
import { useAppStore } from '../state/store';

export interface PluginUiTarget {
  pluginId: string;
  contributionId: string;
}

interface PluginUiContextValue {
  descriptors: PluginUiDescriptor[];
  composerContexts: Record<string, PluginComposerContextValue>;
  activeNavigation: PluginUiTarget | null;
  activeAction: PluginUiTarget | null;
  selectNavigation(target: PluginUiTarget | null): void;
  openAction(target: PluginUiTarget): void;
  closeAction(): void;
  setComposerContext(
    pluginId: string,
    contributionId: string,
    threadId: string,
    value: PluginComposerContextValue | null,
  ): void;
  reload(): Promise<void>;
}

const PluginUiContext = createContext<PluginUiContextValue | null>(null);
const STORAGE_PREFIX = 'whale.plugin-ui.v1.';
const emptyPluginUiContext: PluginUiContextValue = {
  descriptors: [],
  composerContexts: {},
  activeNavigation: null,
  activeAction: null,
  selectNavigation: () => undefined,
  openAction: () => undefined,
  closeAction: () => undefined,
  setComposerContext: () => undefined,
  reload: async () => undefined,
};

export function PluginUiProvider({ children }: { children: React.ReactNode }) {
  const runtime = useAppStore((state) => state.runtime);
  const workspaceView = useAppStore((state) => state.workspaceView);
  const setWorkspaceView = useAppStore((state) => state.setWorkspaceView);
  const [descriptors, setDescriptors] = useState<PluginUiDescriptor[]>([]);
  const [composerContexts, setComposerContexts] = useState<Record<string, PluginComposerContextValue>>(
    () => readComposerContexts(),
  );
  const [activeNavigation, selectNavigation] = useState<PluginUiTarget | null>(null);
  const [activeAction, setActiveAction] = useState<PluginUiTarget | null>(null);

  const reload = useCallback(async () => {
    if (runtime?.phase !== 'ready') {
      setDescriptors([]);
      return;
    }
    try {
      setDescriptors(await window.whale.plugins.uiList());
    } catch {
      setDescriptors([]);
    }
  }, [runtime?.phase]);

  useEffect(() => {
    void reload();
  }, [reload, runtime?.generation]);

  useEffect(() => {
    const listener = () => void reload();
    window.addEventListener('whale-plugin-ui-refresh', listener);
    return () => window.removeEventListener('whale-plugin-ui-refresh', listener);
  }, [reload]);

  useEffect(() => {
    if (activeNavigation && !findPluginUiContribution(
      descriptors,
      activeNavigation,
      'navigation.page',
    )) {
      selectNavigation(null);
      if (workspaceView === 'plugin') setWorkspaceView('conversation');
    }
    if (activeAction) {
      const resolved = findPluginUiContribution(descriptors, activeAction);
      if (!resolved || !isActionContribution(resolved.contribution)) setActiveAction(null);
    }
  }, [activeAction, activeNavigation, descriptors, setWorkspaceView, workspaceView]);

  useEffect(() => {
    const listener = (event: Event) => {
      const pluginId = (event as CustomEvent<{ pluginId?: string }>).detail?.pluginId;
      if (!pluginId) return;
      selectNavigation((current) => current?.pluginId === pluginId ? null : current);
      setActiveAction((current) => current?.pluginId === pluginId ? null : current);
      setComposerContexts((current) => {
        const prefix = `${pluginId}\u0000`;
        const next = Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith(prefix)));
        persistComposerContexts(next);
        return next;
      });
      for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
        const key = window.localStorage.key(index);
        if (key?.startsWith(`${STORAGE_PREFIX}state.${encodeURIComponent(pluginId)}.`)) {
          window.localStorage.removeItem(key);
        }
      }
    };
    window.addEventListener('whale-plugin-ui-uninstall', listener);
    return () => window.removeEventListener('whale-plugin-ui-uninstall', listener);
  }, []);

  const setComposerContext = useCallback((
    pluginId: string,
    contributionId: string,
    threadId: string,
    value: PluginComposerContextValue | null,
  ) => {
    const key = contextKey(pluginId, contributionId, threadId);
    setComposerContexts((current) => {
      const next = { ...current };
      if (value) next[key] = value;
      else delete next[key];
      persistComposerContexts(next);
      return next;
    });
  }, []);

  const openAction = useCallback((target: PluginUiTarget) => setActiveAction(target), []);
  const closeAction = useCallback(() => setActiveAction(null), []);

  const value = useMemo(() => ({
    descriptors,
    composerContexts,
    activeNavigation,
    activeAction,
    selectNavigation,
    openAction,
    closeAction,
    setComposerContext,
    reload,
  }), [activeAction, activeNavigation, closeAction, composerContexts, descriptors, openAction, reload, setComposerContext]);

  return <PluginUiContext.Provider value={value}>{children}</PluginUiContext.Provider>;
}

export function usePluginUi(): PluginUiContextValue {
  return useContext(PluginUiContext) ?? emptyPluginUiContext;
}

export function findPluginUiContribution(
  descriptors: PluginUiDescriptor[],
  target: PluginUiTarget,
  type?: PluginUiContribution['type'],
): { descriptor: PluginUiDescriptor; contribution: PluginUiContribution } | null {
  const descriptor = descriptors.find((entry) => entry.pluginId === target.pluginId);
  const contribution = descriptor?.contributions.find((entry) =>
    entry.id === target.contributionId && (!type || entry.type === type));
  return descriptor && contribution ? { descriptor, contribution } : null;
}

function isActionContribution(contribution: PluginUiContribution): boolean {
  return contribution.type === 'command.action'
    || contribution.type === 'thread.toolbarAction'
    || contribution.type === 'composer.action';
}

export function contextKey(pluginId: string, contributionId: string, threadId: string): string {
  return `${pluginId}\u0000${contributionId}\u0000${threadId}`;
}

export function pluginStateKey(pluginId: string, contributionId: string, threadId: string): string {
  return `${STORAGE_PREFIX}state.${encodeURIComponent(pluginId)}.${encodeURIComponent(contributionId)}.${encodeURIComponent(threadId)}`;
}

function readComposerContexts(): Record<string, PluginComposerContextValue> {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(`${STORAGE_PREFIX}composer`) ?? '{}') as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, PluginComposerContextValue>
      : {};
  } catch {
    return {};
  }
}

function persistComposerContexts(value: Record<string, PluginComposerContextValue>): void {
  try {
    window.localStorage.setItem(`${STORAGE_PREFIX}composer`, JSON.stringify(value));
  } catch {
    // Plugin UI state is best effort and must not block conversation input.
  }
}
