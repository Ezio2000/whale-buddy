import { useEffect } from 'react';
import { AlertCircle, RotateCcw, Settings2, X } from 'lucide-react';
import { CommandPalette } from './components/CommandPalette';
import { SettingsDialog } from './components/SettingsDialog';
import { Welcome } from './components/Welcome';
import { Workspace } from './components/Workspace';
import { PluginActionDialog } from './plugin-ui/PluginUiSurfaces';
import { useAppStore } from './state/store';

export function App() {
  const initialize = useAppStore((state) => state.initialize);
  const handleEvent = useAppStore((state) => state.handleEvent);
  const connectionSettings = useAppStore((state) => state.connectionSettings);
  const runtime = useAppStore((state) => state.runtime);
  const preferences = useAppStore((state) => state.preferences);
  const brandName = useAppStore((state) => state.branding.name);
  const notice = useAppStore((state) => state.notice);
  const setNotice = useAppStore((state) => state.setNotice);
  const setSettingsOpen = useAppStore((state) => state.setSettingsOpen);

  useEffect(() => {
    const unsubscribe = window.whale.events.subscribe(handleEvent);
    void initialize();
    return unsubscribe;
  }, [handleEvent, initialize]);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      document.documentElement.dataset.theme =
        preferences.theme === 'system' ? (media.matches ? 'dark' : 'light') : preferences.theme;
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [preferences.theme]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 3_000);
    return () => window.clearTimeout(timer);
  }, [notice, setNotice]);

  if (!runtime || !connectionSettings) {
    return (
      <div className="splash-screen">
        <span className="large-spinner" />
        <p>正在连接本地 {brandName}…</p>
      </div>
    );
  }

  const providerConfigured = Boolean(
    connectionSettings.provider.hasApiKey
    && connectionSettings.provider.baseUrl
    && connectionSettings.provider.model,
  );
  return (
    <>
      {providerConfigured ? <Workspace /> : <Welcome />}
      {runtime.phase !== 'ready' && (
        <div className="reconnect-banner">
          <AlertCircle size={14} />
          <span>{runtime.message ?? `${brandName} 服务连接中断，正在恢复…`}</span>
          <button onClick={() => setSettingsOpen(true)}>
            <Settings2 size={13} /> 连接设置
          </button>
          <button onClick={() => void window.whale.runtime.restart()}>
            <RotateCcw size={13} /> 重试
          </button>
        </div>
      )}
      {providerConfigured && notice && (
        <div className="toast" role="status">
          <span>{notice}</span>
          <button aria-label="关闭提示" onClick={() => setNotice(null)}>
            <X size={14} />
          </button>
        </div>
      )}
      {!providerConfigured && <SettingsDialog />}
      <CommandPalette />
      <PluginActionDialog />
    </>
  );
}
