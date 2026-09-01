import { ArrowRight, KeyRound, RotateCcw, ShieldCheck } from 'lucide-react';
import { useAppStore } from '../state/store';
import { BrandMark } from './BrandMark';
import { AccountButton } from './AccountButton';

export function Welcome() {
  const runtime = useAppStore((state) => state.runtime);
  const setSettingsOpen = useAppStore((state) => state.setSettingsOpen);
  const notice = useAppStore((state) => state.notice);
  const brandName = useAppStore((state) => state.branding.name);

  if (runtime && runtime.phase !== 'ready') {
    return (
      <main className="welcome-screen">
        <div className="welcome-card runtime-card">
          <BrandMark size={55} />
          <h1>Codex sidecar 尚未就绪</h1>
          <p>{runtime.message ?? `${brandName}正在等待本地 app-server。`}</p>
          <dl className="runtime-paths">
            <div>
              <dt>隔离 HOME</dt>
              <dd>{runtime.sidecarHome}</dd>
            </div>
            <div>
              <dt>隔离 CODEX_HOME</dt>
              <dd>{runtime.codexHome}</dd>
            </div>
            <div>
              <dt>诊断日志</dt>
              <dd>{runtime.diagnosticLog}</dd>
            </div>
          </dl>
          <button className="button primary large" onClick={() => void window.whale.runtime.restart()}>
            <RotateCcw size={16} /> 重新连接
          </button>
          {notice && <p className="inline-notice error-notice">{notice}</p>}
        </div>
      </main>
    );
  }

  return (
    <main className="welcome-screen">
      <div className="welcome-card">
        <div className="welcome-logo-wrap">
          <BrandMark size={61} />
        </div>
        <p className="eyebrow">你的本地 Codex 工作台</p>
        <h1>欢迎使用 {brandName}</h1>
        <p className="welcome-copy">
          打开本地项目，让 Codex 阅读代码、执行命令并提交清晰可审阅的文件变更。
        </p>
        <div className="welcome-actions">
          <button className="button primary large full" onClick={() => setSettingsOpen(true)}>
            <KeyRound size={16} /> 配置 Provider 与 API Key <ArrowRight size={16} />
          </button>
          <AccountButton welcome />
        </div>
        <div className="privacy-note">
          <ShieldCheck size={15} />
          <span>
            使用独立的 HOME 与 CODEX_HOME，不会发现你的 <code>~/.agents</code> 或读取、修改
            <code> ~/.codex</code>。
          </span>
        </div>
        {notice && <p className="inline-notice">{notice}</p>}
      </div>
    </main>
  );
}
