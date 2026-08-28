import { useEffect, useMemo, useState } from 'react';
import { Diff, Hunk, parseDiff } from 'react-diff-view';
import { Braces, Columns2, File, FileDiff, ListChecks, Rows3, X } from 'lucide-react';
import { useAppStore } from '../state/store';
import type { TurnView } from '../state/conversation';
import { FileInfoDialog } from './FileInfoDialog';
import 'react-diff-view/style/index.css';

type DetailTab = 'changes' | 'plan' | 'execution';

export function DiffPanel({ turns }: { turns: TurnView[] }) {
  const latestTurnId = turns.at(-1)?.id ?? null;
  const [selectedTurnId, setSelectedTurnId] = useState<string | null>(latestTurnId);
  const turn = turns.find((candidate) => candidate.id === selectedTurnId) ?? turns.at(-1) ?? null;
  const [tab, setTab] = useState<DetailTab>(turn?.diff ? 'changes' : 'plan');
  const [viewType, setViewType] = useState<'unified' | 'split'>('unified');
  const close = useAppStore((state) => state.setRightPanel);
  const [infoFile, setInfoFile] = useState<TurnView['fileChanges'][number] | null>(null);

  useEffect(() => {
    setSelectedTurnId(latestTurnId);
  }, [latestTurnId]);

  return (
    <aside className="details-panel">
      <div className="details-header">
        <div className="details-tabs" role="tablist">
          <button className={tab === 'changes' ? 'active' : ''} onClick={() => setTab('changes')}>
            <FileDiff size={14} /> Changes
          </button>
          <button className={tab === 'plan' ? 'active' : ''} onClick={() => setTab('plan')}>
            <ListChecks size={14} /> 计划
          </button>
          <button className={tab === 'execution' ? 'active' : ''} onClick={() => setTab('execution')}>
            <Braces size={14} /> 执行
          </button>
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
            ? <FileChangeSummary files={turn.fileChanges} onOpenInfo={setInfoFile} />
            : null}
          {turn?.diff ? <RenderedDiff diff={turn.diff} viewType={viewType} /> : null}
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
          <dl>
            <div>
              <dt>回合 ID</dt>
              <dd>{turn?.id ?? '—'}</dd>
            </div>
            <div>
              <dt>状态</dt>
              <dd>{turn ? statusLabel(turn.status) : '—'}</dd>
            </div>
            <div>
              <dt>耗时</dt>
              <dd>{turn?.durationMs == null ? '—' : `${(turn.durationMs / 1_000).toFixed(1)} 秒`}</dd>
            </div>
            <div>
              <dt>活动项</dt>
              <dd>{turn?.itemOrder.length ?? 0}</dd>
            </div>
          </dl>
          {turn?.error != null && <pre className="json-output error-output">{JSON.stringify(turn.error, null, 2)}</pre>}
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

function FileChangeSummary({
  files,
  onOpenInfo,
}: {
  files: TurnView['fileChanges'];
  onOpenInfo(file: TurnView['fileChanges'][number]): void;
}) {
  return (
    <section className="turn-file-changes" aria-label="本轮文件变更">
      {files.map((file) => (
        <button className="turn-file-change" key={`${file.kind}:${file.path}`} onClick={() => onOpenInfo(file)}>
          <File size={14} />
          <code title={file.path}>{file.path}</code>
          {file.binary && <span className="file-kind-badge">二进制</span>}
          <span className={`file-change-kind kind-${file.kind}`}>{fileChangeLabel(file.kind)}</span>
          <small>{file.size === null ? '—' : formatBytes(file.size)}</small>
        </button>
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
  const title = userMessageText(prompt).replace(/<whale_plugin_context>[\s\S]*$/u, '').trim();
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

function RenderedDiff({ diff, viewType }: { diff: string; viewType: 'unified' | 'split' }) {
  const files = useMemo(() => {
    try {
      return parseDiff(diff);
    } catch {
      return [];
    }
  }, [diff]);
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
