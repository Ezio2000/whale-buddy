import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type {
  PluginComposerContextValue,
  PluginUiDescriptor,
} from '../../shared/plugin-ui';
import { useAppStore } from '../state/store';

interface PluginUiContextValue {
  descriptors: PluginUiDescriptor[];
  composerContexts: Record<string, PluginComposerContextValue>;
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
  setComposerContext: () => undefined,
  reload: async () => undefined,
};

export function PluginUiProvider({ children }: { children: React.ReactNode }) {
  const runtime = useAppStore((state) => state.runtime);
  const [descriptors, setDescriptors] = useState<PluginUiDescriptor[]>([]);
  const [composerContexts, setComposerContexts] = useState<Record<string, PluginComposerContextValue>>(
    () => readComposerContexts(),
  );

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
    const listener = (event: Event) => {
      const pluginId = (event as CustomEvent<{ pluginId?: string }>).detail?.pluginId;
      if (!pluginId) return;
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

  const value = useMemo(() => ({
    descriptors,
    composerContexts,
    setComposerContext,
    reload,
  }), [composerContexts, descriptors, reload, setComposerContext]);

  return <PluginUiContext.Provider value={value}>{children}</PluginUiContext.Provider>;
}

export function usePluginUi(): PluginUiContextValue {
  return useContext(PluginUiContext) ?? emptyPluginUiContext;
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
