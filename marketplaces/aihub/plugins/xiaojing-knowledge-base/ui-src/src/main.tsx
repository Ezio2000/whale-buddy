import { StrictMode, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  getState,
  invokeTool,
  setState as persistState,
  usePluginContext,
  type JsonValue,
  type ToolCallContext,
} from '@whale-buddy/plugin-sdk/ui';
import { definePluginRuntime } from '@whale-buddy/plugin-sdk/runtime';
import './styles.css';

interface Dataset {
  id: string;
  name: string;
  description: string;
}

interface SelectorState {
  datasets: Dataset[];
  selectedIds: string[];
}

definePluginRuntime({
  'list-knowledge-bases': (_input, services) => services.callMcp(
    'xiaojing-knowledge-base',
    'gac_kb_list_datasets',
    {},
  ),
  'set-knowledge-scope': async (input, services) => {
    const raw = record(input)?.datasets;
    const datasets = normalizeDatasets(raw);
    const saved = await services.getState<SelectorState & JsonValue>('thread');
    await services.setState('thread', {
      datasets: saved && typeof saved === 'object' && !Array.isArray(saved)
        ? normalizeDatasets((saved as unknown as SelectorState).datasets)
        : datasets,
      selectedIds: datasets.map((dataset) => dataset.id),
    } as unknown as JsonValue);
    await services.setComposerContext('knowledge-composer-action', {
      label: `知识库 ${datasets.length}`,
      value: {
        dataset_ids: datasets.map((dataset) => dataset.id),
        datasets: datasets.map(({ id, name }) => ({ id, name })),
      },
      explicitTools: [{ server: 'xiaojing-knowledge-base', name: 'gac_kb_search' }],
    });
    return { selected: datasets.length };
  },
  'clear-knowledge-scope': async (_input, services) => {
    const saved = await services.getState<SelectorState & JsonValue>('thread');
    const datasets = saved && typeof saved === 'object' && !Array.isArray(saved)
      ? normalizeDatasets((saved as unknown as SelectorState).datasets)
      : [];
    await services.setState('thread', { datasets, selectedIds: [] } as unknown as JsonValue);
    await services.clearComposerContext('knowledge-composer-action');
    return { selected: 0 };
  },
});

function App() {
  const context = usePluginContext();
  if (!context) return <div className="loading-line">正在连接 Whale…</div>;
  if (context.surface.kind === 'runtime') return null;
  switch (`${context.surface.contributionType}:${context.surface.placement}`) {
    case 'action:composerToolbar':
      return <KnowledgeSelector threadId={context.threadId} />;
    case 'page:navigation':
      return <KnowledgeBrowser title="小鲸知识库" description="浏览当前账号获授权的广汽知识库。" />;
    case 'action:commandPalette':
      return <KnowledgeBrowser title="浏览小鲸知识库" description="从命令面板快速读取知识库目录。" />;
    case 'action:threadToolbar':
      return (
        <KnowledgeBrowser
          title="线程知识库"
          description={context.thread ? `当前线程：${context.thread.name}` : '当前未选择线程'}
        />
      );
    case 'card:message':
      return <KnowledgeCard toolCall={context.toolCall} />;
  }
}

function KnowledgeSelector({ threadId }: { threadId: string | null }) {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getState<SelectorState & JsonValue>('thread').then((saved) => {
      if (cancelled || !saved || typeof saved !== 'object' || Array.isArray(saved)) return;
      const normalized = normalizeDatasets((saved as unknown as SelectorState).datasets);
      const ids = Array.isArray((saved as unknown as SelectorState).selectedIds)
        ? (saved as unknown as SelectorState).selectedIds.filter((id): id is string => typeof id === 'string')
        : [];
      setDatasets(normalized);
      setSelectedIds(ids);
    }).finally(() => {
      if (!cancelled) setRestored(true);
    });
    return () => { cancelled = true; };
  }, [threadId]);

  useEffect(() => {
    if (!restored) return;
    if (!threadId) return;
    const selected = datasets.filter((dataset) => selectedIds.includes(dataset.id));
    void persistState('thread', { datasets, selectedIds } as unknown as JsonValue);
    if (selected.length === 0) {
      void invokeTool('clear-knowledge-scope').catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
      return;
    }
    void invokeTool('set-knowledge-scope', {
      datasets: selected.map((dataset) => ({ id: dataset.id, name: dataset.name })),
    }).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, [datasets, restored, selectedIds]);

  const refresh = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await invokeTool<JsonValue>('list-knowledge-bases');
      const next = extractDatasets(response);
      setDatasets(next);
      setSelectedIds((current) => current.filter((id) => next.some((dataset) => dataset.id === id)));
      if (next.length === 0) setError('当前账号没有返回可用知识库');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (datasets.length === 0 && !loading && !error) void refresh();
  }, [datasets.length, error, loading]);

  const visible = datasets.filter((dataset) =>
    `${dataset.name} ${dataset.description}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));

  return (
    <main className="selector-root">
      <header className="selector-search">
        <input
          value={query}
          placeholder="搜索知识库"
          onChange={(event) => setQuery(event.target.value)}
        />
        <button disabled={loading} onClick={() => void refresh()}>{loading ? '读取中' : '刷新'}</button>
      </header>
      <p className="selector-help">默认不选择；勾选后只搜索已选知识库。</p>
      <div className="selector-actions">
        <span>
          {datasets.length ? `共 ${datasets.length} 个知识库` : '尚未读取知识库'}
          {' · '}
          {selectedIds.length ? `已选择 ${selectedIds.length} 个` : '未选择'}
        </span>
        <div>
          <button
            disabled={loading || datasets.length === 0 || selectedIds.length === datasets.length}
            onClick={() => setSelectedIds(datasets.map((dataset) => dataset.id))}
          >
            全选
          </button>
          <button disabled={selectedIds.length === 0} onClick={() => setSelectedIds([])}>清空</button>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="dataset-list">
        {visible.map((dataset) => (
          <label key={dataset.id}>
            <input
              type="checkbox"
              checked={selectedIds.includes(dataset.id)}
              onChange={(event) => setSelectedIds((current) => event.target.checked
                ? [...new Set([...current, dataset.id])]
                : current.filter((id) => id !== dataset.id))}
            />
            <span>
              <strong>{dataset.name}</strong>
              {dataset.description && <small>{dataset.description}</small>}
            </span>
          </label>
        ))}
        {!loading && !error && visible.length === 0 && <p className="empty">没有匹配的知识库</p>}
      </div>
    </main>
  );
}

function KnowledgeBrowser({ title, description }: { title: string; description: string }) {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const refresh = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await invokeTool<JsonValue>('list-knowledge-bases');
      const next = extractDatasets(response);
      setDatasets(next);
      if (next.length === 0) setError('当前账号没有返回可用知识库');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, []);
  const visible = useMemo(() => datasets.filter((dataset) =>
    `${dataset.name} ${dataset.description}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())), [datasets, query]);

  return (
    <main className="browser-root">
      <header className="browser-heading">
        <div>
          <strong>{title}</strong>
          <p>{description}</p>
        </div>
        <button disabled={loading} onClick={() => void refresh()}>{loading ? '读取中' : '刷新'}</button>
      </header>
      <input value={query} placeholder="筛选知识库" onChange={(event) => setQuery(event.target.value)} />
      <div className="browser-summary">{datasets.length ? `共 ${datasets.length} 个知识库` : '尚未读取知识库'}</div>
      {error && <p className="error">{error}</p>}
      <section className="browser-list">
        {visible.map((dataset) => (
          <article key={dataset.id}>
            <KnowledgeIcon />
            <div><strong>{dataset.name}</strong><p>{dataset.description || '暂无描述'}</p></div>
          </article>
        ))}
        {!loading && !error && visible.length === 0 && <p className="empty">没有匹配的知识库</p>}
      </section>
    </main>
  );
}

function KnowledgeIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M3 5v14c0 1.7 4 3 9 3s9-1.3 9-3V5" />
      <path d="M3 12c0 1.7 4 3 9 3s9-1.3 9-3" />
    </svg>
  );
}

function KnowledgeCard({ toolCall }: { toolCall?: ToolCallContext }) {
  if (!toolCall || ['inProgress', 'running', 'pending'].includes(toolCall.status)) {
    return <div className="card-state"><span className="pulse" />正在访问小鲸知识库…</div>;
  }
  if (toolCall.error) return <div className="card-error">{textFrom(toolCall.error) || '知识库调用失败'}</div>;
  if (toolCall.tool === 'gac_kb_list_datasets') {
    const datasets = extractDatasets(toolCall.result);
    return (
      <div className="result-card">
        <strong>可用知识库 · {datasets.length}</strong>
        <div className="dataset-chips">
          {datasets.map((dataset) => <span key={dataset.id}>{dataset.name}</span>)}
        </div>
        {datasets.length === 0 && <p>当前结果中没有可展示的知识库。</p>}
      </div>
    );
  }
  const snippets = extractSnippets(toolCall.result);
  return (
    <div className="result-card">
      <strong>知识库检索结果 · {snippets.length}</strong>
      <div className="snippet-list">
        {snippets.slice(0, 8).map((snippet, index) => (
          <article key={`${snippet.title}:${index}`}>
            <b>{snippet.title || `结果 ${index + 1}`}</b>
            <p>{snippet.text}</p>
            {snippet.source && <small>{snippet.source}</small>}
          </article>
        ))}
      </div>
      {snippets.length === 0 && <pre>{truncate(textFrom(toolCall.result), 2_000) || '工具已完成，但没有可预览的结构化结果。'}</pre>}
    </div>
  );
}

function extractDatasets(value: unknown): Dataset[] {
  const candidates: unknown[] = [];
  walk(value, (entry) => {
    if (Array.isArray(entry)) candidates.push(entry);
    if (typeof entry === 'string') {
      try { walk(JSON.parse(entry), (parsed) => { if (Array.isArray(parsed)) candidates.push(parsed); }); }
      catch { /* Plain text is handled by result fallback. */ }
    }
  });
  const scored = candidates
    .map((array) => normalizeDatasets(array))
    .sort((left, right) => right.length - left.length);
  return scored[0] ?? [];
}

function normalizeDatasets(value: unknown): Dataset[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((raw) => {
    const entry = record(raw);
    const id = string(entry?.id) ?? string(entry?.dataset_id) ?? string(entry?.datasetId);
    const name = string(entry?.name) ?? string(entry?.dataset_name) ?? string(entry?.title);
    if (!id || !name || seen.has(id)) return [];
    seen.add(id);
    return [{
      id,
      name,
      description: string(entry?.description) ?? string(entry?.summary) ?? '',
    }];
  });
}

function extractSnippets(value: unknown): Array<{ title: string; text: string; source: string }> {
  const result: Array<{ title: string; text: string; source: string }> = [];
  walk(value, (raw) => {
    const entry = record(raw);
    if (!entry) return;
    const text = string(entry.text) ?? string(entry.content) ?? string(entry.snippet) ?? string(entry.chunk);
    if (!text || text.length < 8) return;
    result.push({
      title: string(entry.title) ?? string(entry.document_name) ?? string(entry.name) ?? '',
      text: truncate(text, 900),
      source: string(entry.source) ?? string(entry.url) ?? string(entry.dataset_name) ?? '',
    });
  });
  return result.filter((entry, index) => result.findIndex((item) => item.text === entry.text) === index);
}

function walk(value: unknown, visit: (entry: unknown) => void, depth = 0): void {
  if (depth > 7) return;
  visit(value);
  if (Array.isArray(value)) for (const entry of value) walk(entry, visit, depth + 1);
  else {
    const entry = record(value);
    if (entry) for (const child of Object.values(entry)) walk(child, visit, depth + 1);
  }
}

function textFrom(value: unknown): string {
  if (typeof value === 'string') return value;
  const entry = record(value);
  if (entry && typeof entry.text === 'string') return entry.text;
  try { return value == null ? '' : JSON.stringify(value, null, 2); }
  catch { return ''; }
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function string(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root');
createRoot(root).render(<StrictMode><App /></StrictMode>);
