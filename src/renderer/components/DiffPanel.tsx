import { useEffect, useMemo, useRef, useState } from 'react';
import { Diff, Hunk, parseDiff } from 'react-diff-view';
import { Braces, Columns2, File, FileDiff, FileOutput, Info, ListChecks, Rows3, X } from 'lucide-react';
import { userVisibleText } from '../../shared/display-text';
import { ItemCard } from './ItemCard';
import { useAppStore } from '../state/store';
import type { TurnView } from '../state/conversation';
import { PluginUiFrame } from '../plugin-ui/PluginUiFrame';
import { usePluginHost } from '../plugin-ui/PluginHostProvider';
import { FileInfoDialog } from './FileInfoDialog';
import 'react-diff-view/style/index.css';

type CoreDetailTab = 'changes' | 'plan' | 'execution';
type DetailTab = CoreDetailTab | `plugin:${string}:${string}`;

export function DiffPanel({ turns, width = 360, onResize }: { turns: TurnView[]; width?: number; onResize?: (width: number) => void }) {
  const drag = useRef<{ x: number; width: number } | null>(null);
  const latestTurnId = turns.at(-1)?.id ?? null;
  const threadId = useAppStore((state) => state.selectedThreadId);
  const { descriptors } = usePluginHost();
  const [selectedTurnId, setSelectedTurnId] = useState<string | null>(latestTurnId);
  const turn = turns.find((candidate) => candidate.id === selectedTurnId) ?? turns.at(-1) ?? null;
  const pluginPanels = descriptors.flatMap((descriptor) => descriptor.uiContributions
    .flatMap((contribution) => contribution.type === 'panel' && contribution.placement === 'turnDetails'
      && panelMatchesTurn(descriptor.pluginId, descriptor.webMcp?.tools.map((tool) => tool.name) ?? [], turn)
      ? [{ descriptor, contribution }]
      : []))
    .sort((left, right) => left.contribution.order - right.contribution.order);
  const [tab, setTab] = useState<DetailTab>('execution');
  const [viewType, setViewType] = useState<'unified' | 'split'>('unified');
  const close = useAppStore((state) => state.setRightPanel);
  const [previewFile, setPreviewFile] = useState<TurnView['fileChanges'][number] | null>(null);
  const [infoFile, setInfoFile] = useState<TurnView['fileChanges'][number] | null>(null);
  const selectedPluginPanel = pluginPanels.find(({ descriptor, contribution }) =>
    tab === pluginPanelKey(descriptor.pluginId, contribution.id)) ?? null;

  useEffect(() => {
    setSelectedTurnId(latestTurnId);
    setPreviewFile(null);
    setInfoFile(null);
  }, [latestTurnId]);
  useEffect(() => {
    if (tab.startsWith('plugin:') && !selectedPluginPanel) setTab('execution');
  }, [selectedPluginPanel, tab]);

  return (
    <aside className="details-panel">
      {onResize && <div className="details-resize-handle" role="separator" tabIndex={0}
        aria-label="调整详情面板宽度" aria-orientation="vertical" aria-valuemin={300} aria-valuemax={560} aria-valuenow={width}
        onPointerDown={(event) => {
          drag.current = { x: event.clientX, width };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => { if (drag.current) onResize(drag.current.width + drag.current.x - event.clientX); }}
        onPointerUp={(event) => { drag.current = null; event.currentTarget.releasePointerCapture(event.pointerId); }}
        onLostPointerCapture={() => { drag.current = null; }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault(); onResize(width + (event.key === 'ArrowLeft' ? 20 : -20));
          }
        }}
      />}
      <div className="details-header">
        <div className="details-tabs" role="tablist">
          <button className={tab === 'changes' ? 'active' : ''} onClick={() => setTab('changes')}>
            <FileDiff size={14} /> 变更
          </button>
          <button className={tab === 'plan' ? 'active' : ''} onClick={() => setTab('plan')}>
            <ListChecks size={14} /> 计划
          </button>
          <button className={tab === 'execution' ? 'active' : ''} onClick={() => setTab('execution')}>
            <Braces size={14} /> 执行
          </button>
          {pluginPanels.map(({ descriptor, contribution }) => {
            const key = pluginPanelKey(descriptor.pluginId, contribution.id);
            return <button className={tab === key ? 'active' : ''} key={key} onClick={() => setTab(key)} title={descriptor.displayName}>
              <FileOutput size={14} /> {contribution.title}
            </button>;
          })}
        </div>
        <button className="icon-button" aria-label="关闭详情" onClick={() => close(false)}>
          <X size={15} />
        </button>
      </div>
      <div className="turn-detail-picker">
        <label htmlFor="turn-detail-select">对话轮次</label>
        <select
          id="turn-detail-select"
          value={turn?.id ?? ''}
          onChange={(event) => {
            setSelectedTurnId(event.target.value);
            setInfoFile(null);
            setPreviewFile(null);
          }}
          disabled={turns.length === 0}
        >
          {turns.length === 0 && <option value="">暂无对话记录</option>}
          {turns.map((candidate, index) => (
            <option key={candidate.id} value={candidate.id}>
              {turnOptionLabel(candidate, index)}
            </option>
          ))}
        </select>
      </div>
      {tab === 'changes' && (
        <div className="details-body diff-body">
          <div className="diff-toolbar">
            <span>{changeSummary(turn)}</span>
            {turn?.diff && <div className="segmented-control">
              <button
                className={viewType === 'unified' ? 'active' : ''}
                aria-label="统一视图"
                onClick={() => setViewType('unified')}
              >
                <Rows3 size={13} />
              </button>
              <button
                className={viewType === 'split' ? 'active' : ''}
                aria-label="分栏视图"
                onClick={() => setViewType('split')}
              >
                <Columns2 size={13} />
              </button>
            </div>}
          </div>
          {turn?.fileChanges.length
            ? <FileChangeSummary files={turn.fileChanges} selectedPath={previewFile?.path} onPreview={setPreviewFile} onOpenInfo={setInfoFile} />
            : null}
          {turn && previewFile ? <FilePreview key={`${turn.id}:${previewFile.path}`} turn={turn} file={previewFile} viewType={viewType} />
            : turn?.diff ? <RenderedDiff diff={turn.diff} viewType={viewType} /> : null}
          {!turn?.fileChanges.length && !turn?.diff ? <EmptyDetail /> : null}
        </div>
      )}
      {tab === 'plan' && (
        <div className="details-body plan-detail-body">
          {turn?.planExplanation && <p>{turn.planExplanation}</p>}
          {turn?.plan.length ? (
            <ol className="plan-steps">
              {turn.plan.map((step, index) => (
                <li className={`plan-step step-${step.status}`} key={`${step.step}-${index}`}>
                  <span>{statusMark(step.status)}</span>
                  <div>
                    <strong>{step.step}</strong>
                    <small>{statusLabel(step.status)}</small>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <EmptyDetail label="本轮没有计划数据" />
          )}
        </div>
      )}
      {tab === 'execution' && (
        <div className="details-body execution-details">
          <div className="execution-summary">
            <strong>{turn ? statusLabel(turn.status) : '暂无执行记录'}</strong>
            {turn?.durationMs != null && turn.durationMs > 0 && <span>{(turn.durationMs / 1_000).toFixed(1)} 秒</span>}
          </div>
          <div className="execution-activity-list">
            {turn?.itemOrder.map((id) => turn.items[id]).filter((item) => item && !['userMessage', 'agentMessage', 'reasoning', 'plan'].includes(item.type)).map((item) => (
              <ItemCard key={item.id} item={item} approvals={[]} onRespondApproval={() => undefined} />
            ))}
          </div>
          <details className="execution-diagnostics">
            <summary>诊断信息</summary>
            <dl>
              <div><dt>回合 ID</dt><dd>{turn?.id ?? '—'}</dd></div>
              <div><dt>活动项</dt><dd>{turn?.itemOrder.length ?? 0}</dd></div>
              <div><dt>提交人</dt><dd>{turn?.operation?.identity?.displayName ?? '未关联登录身份'}</dd></div>
              <div><dt>操作 ID</dt><dd>{turn?.operation?.operationId ?? '—'}</dd></div>
              <div><dt>策略记录</dt><dd>{turn?.operation?.decisions.length ?? 0}</dd></div>
            </dl>
          </details>
          {turn?.error != null && <pre className="json-output error-output">{JSON.stringify(turn.error, null, 2)}</pre>}
        </div>
      )}
      {selectedPluginPanel && (
        <div className="details-body plugin-turn-details-body">
          {threadId && turn ? <PluginUiFrame
            descriptor={selectedPluginPanel.descriptor}
            contribution={selectedPluginPanel.contribution}
            threadId={threadId}
            turnId={turn.id}
            className="plugin-turn-details-frame"
            fallback={<EmptyDetail label={`${selectedPluginPanel.descriptor.displayName}详情暂时不可用`} />}
          /> : <EmptyDetail label="请选择对话轮次" />}
        </div>
      )}
      <FileInfoDialog
        file={infoFile}
        onOpenChange={(open) => {
          if (!open) setInfoFile(null);
        }}
      />
    </aside>
  );
}

function pluginPanelKey(pluginId: string, contributionId: string): `plugin:${string}:${string}` {
  return `plugin:${pluginId}:${contributionId}`;
}

function panelMatchesTurn(pluginId: string, toolNames: string[], turn: TurnView | null): boolean {
  if (!turn) return false;
  return Object.values(turn.items).some((item) =>
    item.pluginId === pluginId || (typeof item.tool === 'string' && toolNames.includes(item.tool)));
}

function FileChangeSummary({
  files,
  onOpenInfo,
  onPreview,
  selectedPath,
}: {
  files: TurnView['fileChanges'];
  selectedPath?: string;
  onPreview(file: TurnView['fileChanges'][number]): void;
  onOpenInfo(file: TurnView['fileChanges'][number]): void;
}) {
  return (
    <section className="turn-file-changes" aria-label="本轮文件变更">
      {files.map((file) => (
        <div className={`turn-file-change ${selectedPath === file.path ? 'selected' : ''}`} key={`${file.kind}:${file.path}`}>
        <button className="file-preview-trigger" onClick={() => onPreview(file)}>
          <File size={14} />
          <code title={file.path}>{file.path}</code>
          {file.binary && <span className="file-kind-badge">二进制</span>}
          <span className={`file-change-kind kind-${file.kind}`}>{fileChangeLabel(file.kind)}</span>
          <small>{file.size === null ? '—' : formatBytes(file.size)}</small>
        </button>
        <button className="icon-button" aria-label={`${file.path} 文件属性`} onClick={() => onOpenInfo(file)}><Info size={14} /></button>
        </div>
      ))}
    </section>
  );
}

function changeSummary(turn: TurnView | null): string {
  if (!turn) return '本轮暂无文件变更';
  if (turn.fileChanges.length) return `本轮变更 ${turn.fileChanges.length} 个文件`;
  return turn.diff ? '本轮完整变更' : '本轮暂无文件变更';
}

function turnOptionLabel(turn: TurnView, index: number): string {
  const prompt = turn.itemOrder
    .map((itemId) => turn.items[itemId])
    .find((item) => item?.type === 'userMessage');
  const title = userVisibleText(userMessageText(prompt));
  const summary = title.length > 28 ? `${title.slice(0, 28)}…` : title;
  return `第 ${index + 1} 轮${summary ? ` · ${summary}` : ''}`;
}

function userMessageText(item: TurnView['items'][string] | undefined): string {
  if (!item) return '';
  if (typeof item.text === 'string') return item.text;
  if (!Array.isArray(item.content)) return '';
  return item.content.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return [];
    const text = (entry as Record<string, unknown>).text;
    return typeof text === 'string' ? [text] : [];
  }).join(' ');
}

function fileChangeLabel(kind: TurnView['fileChanges'][number]['kind']): string {
  if (kind === 'created') return '新增';
  if (kind === 'deleted') return '删除';
  return '修改';
}

function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

function FilePreview({ turn, file, viewType }: {
  turn: TurnView;
  file: TurnView['fileChanges'][number];
  viewType: 'unified' | 'split';
}) {
  const matchingDiff = useMemo(() => {
    try {
      return parseDiff(turn.diff).some((entry) => matchesPath(entry, file.path) && entry.hunks.length > 0);
    } catch { return false; }
  }, [turn.diff, file.path]);
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (matchingDiff) return;
    let cancelled = false;
    setContent(null);
    setError(null);
    if (file.binary || file.kind === 'deleted') {
      setError(file.binary ? '此文件格式不支持文本预览' : '文件已删除，本轮未保存可预览的内容');
      return;
    }
    void window.whale.turns.filePreview({ turnId: turn.id, path: file.path })
      .then((text) => { if (!cancelled) setContent(text); })
      .catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason)); });
    return () => { cancelled = true; };
  }, [turn.id, file.path, file.binary, file.kind, matchingDiff]);
  if (matchingDiff) return <RenderedDiff diff={turn.diff} viewType={viewType} filePath={file.path} />;
  return <section className="file-content-preview" aria-label={`${file.path} 预览`}>
    <header><strong>{file.path}</strong><p>当前文件内容 · 本轮未记录 diff，内容可能已被后续修改。</p></header>
    {error ? <p role="status" className="empty-detail">{error}</p>
      : content === null ? <p role="status">正在读取文件…</p>
        : content === '' ? <p className="empty-detail">空文件</p>
          : <pre><code>{content}</code></pre>}
  </section>;
}

function matchesPath(file: { oldPath?: string; newPath?: string }, filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  return [file.oldPath, file.newPath].some((candidate) => candidate?.replace(/\\/g, '/') === normalized);
}

function RenderedDiff({ diff, viewType, filePath }: { diff: string; viewType: 'unified' | 'split'; filePath?: string }) {
  const files = useMemo(() => {
    try {
      return parseDiff(diff).filter((file) => !filePath || matchesPath(file, filePath));
    } catch {
      return [];
    }
  }, [diff, filePath]);
  if (!files.length) return <pre className="raw-diff">{diff}</pre>;
  return (
    <div className="react-diff-shell">
      {files.map((file, index) => (
        <section className="diff-file" key={`${file.oldPath}-${file.newPath}-${index}`}>
          <header>
            <code>{file.newPath || file.oldPath}</code>
          </header>
          <Diff viewType={viewType} diffType={file.type} hunks={file.hunks}>
            {(hunks) => hunks.map((hunk) => <Hunk key={hunk.content} hunk={hunk} />)}
          </Diff>
        </section>
      ))}
    </div>
  );
}

function EmptyDetail({ label = '暂无内容' }: { label?: string }) {
  return <div className="empty-detail">{label}</div>;
}

function statusMark(status: string): string {
  if (status === 'completed') return '✓';
  if (status === 'in_progress' || status === 'inProgress') return '●';
  return '○';
}

function statusLabel(status: string): string {
  switch (status) {
    case 'completed':
      return '已完成';
    case 'in_progress':
    case 'inProgress':
      return '进行中';
    case 'pending':
      return '等待中';
    case 'failed':
      return '失败';
    case 'interrupted':
      return '已中断';
    default:
      return status;
  }
}
