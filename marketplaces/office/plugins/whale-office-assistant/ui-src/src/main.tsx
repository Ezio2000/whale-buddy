import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as mammoth from 'mammoth/mammoth.browser';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import * as XLSX from 'xlsx';
import {
  createArtifact, getState, listArtifacts, openArtifact, pickAttachments, readAttachment, setState as persistState,
  saveArtifactAs, startTask, usePluginContext, usePluginEvents,
  type JsonValue,
} from '@whale-buddy/plugin-sdk/ui';
import { definePluginRuntime } from '@whale-buddy/plugin-sdk/runtime';
import type { HostArtifact, HostAttachment } from '@whale-buddy/plugin-sdk/ui';
import { parseRichText, renderDocxArtifact } from './docx-artifact';
import { renderHtmlDocument } from './html-document';
import { parseOfficeDraft, renderXlsxArtifact, type OfficeDraft } from './office-artifact';
import { extractPptxText, renderPptxArtifact } from './pptx-artifact';
import './styles.css';

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

type Format = 'html' | 'docx' | 'xlsx' | 'pptx';
interface StoredState { draft?: OfficeDraft; artifact?: HostArtifact }

definePluginRuntime({
  'stage-artifact': async (input, services) => {
    const draft = parseOfficeDraft(input);
    await services.setState('thread', { draft } as unknown as JsonValue, services.context.threadId ?? undefined);
    return { staged: true, taskId: draft.taskId, title: draft.title, format: draft.format, summary: draft.summary };
  },
});

const TASKS = [
  ['summary', '文件总结', '提炼重点、结论、风险与待办'],
  ['draft', '材料起草', '根据材料和要求起草正式文稿'],
  ['data', '数据整理', '清洗、归类并形成结构化表格'],
  ['html', '生成 HTML', '形成可浏览的网页成果'],
  ['docx', '生成 Word', '形成可编辑的 DOCX 文档'],
  ['xlsx', '生成 Excel', '形成真实 XLSX 工作簿'],
  ['pptx', '生成 PPT', '形成可编辑的 PPTX 演示文稿'],
] as const;

function App() {
  const context = usePluginContext();
  if (!context) return null;
  if (context.surface.kind === 'ui' && context.surface.contributionType === 'card') return <ResultCard threadId={context.threadId} />;
  if (context.surface.kind === 'ui' && context.surface.contributionType === 'panel') return <OfficeChangesPanel />;
  return <TaskPage />;
}

function OfficeChangesPanel() {
  const context = usePluginContext();
  const [artifacts, setArtifacts] = useState<HostArtifact[]>([]);
  const [message, setMessage] = useState('');
  const load = async () => {
    if (!context?.threadId || !context.turnId) return setArtifacts([]);
    try {
      const records = await listArtifacts(context.threadId);
      setArtifacts(records.filter((artifact) => artifact.pluginId === context.pluginId && artifact.turnId === context.turnId));
      setMessage('');
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  };
  useEffect(() => { void load(); }, [context?.pluginId, context?.threadId, context?.turnId]);
  usePluginEvents((event) => {
    if (event.type === 'artifacts.changed' && event.pluginId === context?.pluginId
      && event.threadId === context?.threadId && event.turnId === context?.turnId) void load();
  });
  return <main className="office-changes">
    <header><h1>本轮办公成果</h1><p>来源：Whale 办公助手</p></header>
    {artifacts.length ? <div className="office-change-list">{artifacts.map((artifact) => <article className="office-change" key={artifact.id}>
      <span className={`office-format ${artifact.format}`}>{artifact.format.toUpperCase()}</span>
      <div><strong>{artifact.name}</strong><small>{formatBytes(artifact.size)} · {new Date(artifact.createdAt).toLocaleString()}</small><code title={artifact.sha256}>{artifact.sha256.slice(0, 16)}…</code></div>
      <div className="office-change-actions"><button className="secondary" onClick={() => void openArtifact(artifact.id)}>打开</button><button className="secondary" onClick={() => void saveArtifactAs(artifact.id)}>另存为</button></div>
    </article>)}</div> : <div className="office-change-empty"><strong>本轮尚未生成办公成果</strong><span>在成果预览中点击“确认并生成”后会显示在这里。</span></div>}
    {message && <p className="message">{message}</p>}
  </main>;
}

function TaskPage() {
  const context = usePluginContext();
  const [taskType, setTaskType] = useState<(typeof TASKS)[number][0]>('summary');
  const [format, setFormat] = useState<Format>('docx');
  const [instructions, setInstructions] = useState('');
  const [attachments, setAttachments] = useState<HostAttachment[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const task = TASKS.find(([id]) => id === taskType)!;

  useEffect(() => {
    if (taskType === 'html' || taskType === 'docx' || taskType === 'xlsx' || taskType === 'pptx') setFormat(taskType);
  }, [taskType]);

  const begin = async () => {
    if (!context?.project) return setMessage('请先在 Whale 打开一个项目。');
    setBusy(true); setMessage('正在读取材料…');
    try {
      const extracted = await Promise.all(attachments.map(extractAttachment));
      const taskId = crypto.randomUUID();
      const prompt = [
        `执行办公任务：${task[1]}。`,
        `目标成果格式：${format.toUpperCase()}。`,
        instructions ? `员工补充要求：${instructions}` : '',
        '请依据附件和已提取文本完成任务，最后必须调用 whale_office_stage_artifact 暂存预览；在员工点击确认前不要声称文件已经生成。',
      ].filter(Boolean).join('\n');
      await startTask({
        toolName: 'whale_office_stage_artifact', title: `${task[1]} · ${new Date().toLocaleDateString()}`,
        prompt, attachments,
        context: { taskId, taskType, outputFormat: format, instructions, extractedDocuments: extracted },
      });
      setMessage('任务已在新的专用线程中启动。');
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };

  return <main className="page">
    <h1>办公任务</h1><p className="lead">选择任务、添加材料，Whale 会在新的专用线程中完成并先提供成果预览。</p>
    <div className="cards">{TASKS.map(([id, title, description]) => <button className={`task ${taskType === id ? 'active' : ''}`} key={id} onClick={() => setTaskType(id)}><strong>{title}</strong><span>{description}</span></button>)}</div>
    <section className="form">
      <div className="row"><label>输出格式</label><select value={format} onChange={(event) => setFormat(event.target.value as Format)}><option value="html">HTML</option><option value="docx">Word (.docx)</option><option value="xlsx">Excel (.xlsx)</option><option value="pptx">PowerPoint (.pptx)</option></select></div>
      <div><textarea aria-label="补充要求" value={instructions} onChange={(event) => setInstructions(event.target.value)} placeholder="补充受众、语气、字段、结构或其他要求…" /></div>
      <div className="row"><button className="secondary" onClick={async () => setAttachments(await pickAttachments())}>添加办公材料</button><div className="files">{attachments.map((file) => <span className="file" key={file.path}>{file.name}</span>)}</div></div>
      <div><button className="primary" disabled={busy} onClick={() => void begin()}>{busy ? '正在准备…' : '开始任务'}</button></div>
      {message && <div className="message">{message}</div>}
    </section>
  </main>;
}

function ResultCard({ threadId }: { threadId: string | null }) {
  const [state, setState] = useState<StoredState | null>(null);
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (threadId) void getState('thread', threadId).then((value) => setState(value as unknown as StoredState | null));
  }, [threadId]);
  usePluginEvents((event) => {
    if (event.type === 'state.changed' && event.scope === 'thread' && event.scopeId === threadId) {
      setState(event.value as unknown as StoredState | null);
    }
  });
  const draft = state?.draft;
  const confirm = async () => {
    if (!threadId || !draft) return;
    setMessage('正在生成正式文件…');
    try {
      const dataBase64 = await renderArtifact(draft);
      const artifact = await createArtifact({ name: draft.title, format: draft.format, dataBase64, threadId, taskId: draft.taskId });
      const nextState = { ...state, artifact };
      await persistState('thread', nextState as unknown as JsonValue, threadId);
      setState(nextState); setMessage('成果已保存到 Whale 成果库。');
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  };
  if (!draft) return <div className="preview">正在读取办公成果预览…</div>;
  return <article className="preview"><h3>{draft.title}</h3><p>{draft.summary}</p><ArtifactPreview draft={draft} /><div className="actions">
    {!state?.artifact && <button className="primary" onClick={() => void confirm()}>确认并生成 {draft.format.toUpperCase()}</button>}
    {state?.artifact && <><button className="secondary" onClick={() => void openArtifact(state.artifact!.id)}>打开成果</button><button className="secondary" onClick={() => void saveArtifactAs(state.artifact!.id)}>另存为</button></>}
  </div>{message && <p>{message}</p>}</article>;
}

async function extractAttachment(attachment: HostAttachment): Promise<JsonValue> {
  if (attachment.kind === 'image') return { name: attachment.name, kind: 'image', note: '图片已作为视觉附件发送' };
  const { dataBase64 } = await readAttachment(attachment.path);
  const bytes = fromBase64(dataBase64);
  const extension = attachment.name.split('.').pop()?.toLowerCase();
  let text = '';
  if (extension === 'pdf') {
    const pdf = await getDocument({ data: bytes }).promise;
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const content = await (await pdf.getPage(pageNumber)).getTextContent();
      pages.push(content.items.map((item) => 'str' in item ? item.str : '').join(' '));
    }
    text = pages.join('\n');
  } else if (extension === 'docx') text = (await mammoth.extractRawText({ arrayBuffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer })).value;
  else if (extension === 'xlsx') {
    const workbook = XLSX.read(bytes, { type: 'array' });
    text = workbook.SheetNames.map((name) => `# ${name}\n${XLSX.utils.sheet_to_csv(workbook.Sheets[name])}`).join('\n');
  } else if (extension === 'pptx') text = await extractPptxText(bytes);
  else text = new TextDecoder().decode(bytes);
  return { name: attachment.name, mimeType: attachment.mimeType ?? '', sha256: attachment.sha256 ?? '', text: text.slice(0, 200_000) };
}

function ArtifactPreview({ draft }: { draft: OfficeDraft }) {
  if (draft.format === 'xlsx') return <SpreadsheetPreview draft={draft} />;
  if (draft.format === 'html') return <iframe className="html-preview" title="HTML 成果预览" srcDoc={renderHtmlDocument(draft.title, draft.content)} />;
  if (draft.format === 'pptx') return <PresentationPreview draft={draft} />;
  return <section className="document-preview" aria-label="Word 文档预览">{parseRichText(draft.content).map((block, index) => {
    const children = block.runs.map((run, runIndex) => run.code
      ? <code key={runIndex}>{run.text}</code>
      : run.bold ? <strong key={runIndex}>{run.text}</strong>
      : run.italics ? <em key={runIndex}>{run.text}</em>
      : <React.Fragment key={runIndex}>{run.text}</React.Fragment>);
    if (block.kind === 'heading') return block.level === 1 ? <h2 key={index}>{children}</h2> : <h4 key={index}>{children}</h4>;
    if (block.kind === 'bullet') return <div className="preview-list-item" key={index}>• {children}</div>;
    if (block.kind === 'number') return <div className="preview-list-item" key={index}>{index + 1}. {children}</div>;
    if (block.kind === 'quote') return <blockquote key={index}>{children}</blockquote>;
    if (block.kind === 'rule') return <hr key={index} />;
    return <p key={index}>{children}</p>;
  })}</section>;
}

function PresentationPreview({ draft }: { draft: OfficeDraft }) {
  return <section className="presentation-preview" aria-label="PowerPoint 幻灯片预览">
    <p className="sheet-meta">共 {draft.slides?.length ?? 0} 页</p>
    <div className="slide-grid">{draft.slides?.map((slide, index) => <article className="slide-preview" key={index}>
      <span className="slide-number">{index + 1}</span><h4>{slide.title}</h4>{slide.body && <p>{slide.body}</p>}
      {slide.bullets?.length ? <ul>{slide.bullets.map((bullet, bulletIndex) => <li key={bulletIndex}>{bullet}</li>)}</ul> : null}
    </article>)}</div>
  </section>;
}

function SpreadsheetPreview({ draft }: { draft: OfficeDraft }) {
  const columns = draft.columns ?? [];
  const rows = draft.rows ?? [];
  return <section className="sheet-preview" aria-label="Excel 表格预览">
    <p className="sheet-meta">工作表：{draft.sheetName} · {rows.length} 行 × {columns.length} 列{rows.length > 20 ? '（预览前 20 行）' : ''}</p>
    <div className="sheet-scroll"><table><thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead>
      <tbody>{rows.slice(0, 20).map((row, rowIndex) => <tr key={rowIndex}>{columns.map((column) => <td key={column}>{formatCell(row[column])}</td>)}</tr>)}</tbody>
    </table></div>
  </section>;
}

function formatCell(value: unknown) { return value === null || value === undefined ? '' : String(value); }
function formatBytes(bytes: number) {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

async function renderArtifact(draft: OfficeDraft): Promise<string> {
  if (draft.format === 'html') return toBase64(new TextEncoder().encode(renderHtmlDocument(draft.title, draft.content)));
  if (draft.format === 'docx') return toBase64(await renderDocxArtifact(draft));
  if (draft.format === 'pptx') return toBase64(await renderPptxArtifact(draft));
  return toBase64(renderXlsxArtifact(draft));
}
function fromBase64(value: string) { const binary = atob(value); return Uint8Array.from(binary, (character) => character.charCodeAt(0)); }
function toBase64(value: ArrayBuffer | Uint8Array) { const bytes = value instanceof Uint8Array ? value : new Uint8Array(value); let binary = ''; for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)); return btoa(binary); }

createRoot(document.getElementById('root')!).render(<App />);
