import { Download, ExternalLink, FileArchive, LoaderCircle, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ArtifactRecord } from '../../shared/types';
import { useAppStore } from '../state/store';

export function ArtifactsPage() {
  const [artifacts, setArtifacts] = useState<ArtifactRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const setNotice = useAppStore((state) => state.setNotice);
  const load = async () => {
    setLoading(true);
    try {
      const records = await window.whale.artifacts.list();
      setArtifacts(records.sort((left, right) => right.createdAt - left.createdAt));
    } catch (error) {
      setNotice(`读取成果库失败：${errorMessage(error)}`);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); }, []);

  return <div className="artifacts-page">
    <header className="artifacts-header">
      <div><h1><FileArchive size={22} /> 成果库</h1><p>员工确认生成的 HTML、Word 和 Excel 成果永久保存在本机。</p></div>
      <button className="button secondary" disabled={loading} onClick={() => void load()}>
        {loading ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />} 刷新
      </button>
    </header>
    {loading && artifacts.length === 0 ? <div className="artifacts-empty"><LoaderCircle className="spin" /> 正在读取成果…</div>
      : artifacts.length === 0 ? <div className="artifacts-empty"><FileArchive size={30} /><strong>还没有成果</strong><span>从办公任务生成并确认后，文件会出现在这里。</span></div>
        : <div className="artifact-grid">{artifacts.map((artifact) => <article className="artifact-card" key={artifact.id}>
          <div className={`artifact-format ${artifact.format}`}>{artifact.format.toUpperCase()}</div>
          <div className="artifact-copy"><strong>{artifact.name}</strong><span>{formatBytes(artifact.size)} · {new Date(artifact.createdAt).toLocaleString()}</span><code title={artifact.sha256}>{artifact.sha256.slice(0, 16)}…</code></div>
          <div className="artifact-actions">
            <button aria-label={`打开 ${artifact.name}`} onClick={() => void window.whale.artifacts.open(artifact.id).catch((error) => setNotice(errorMessage(error)))}><ExternalLink size={14} /> 打开</button>
            <button aria-label={`另存为 ${artifact.name}`} onClick={() => void window.whale.artifacts.saveAs(artifact.id).catch((error) => setNotice(errorMessage(error)))}><Download size={14} /> 另存为</button>
          </div>
        </article>)}</div>}
  </div>;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
