import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import JSZip from 'jszip';
import * as mammoth from 'mammoth/mammoth.browser';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import * as XLSX from 'xlsx';
import {
  createArtifact, getState, openArtifact, pickAttachments, readAttachment, setState as persistState,
  saveArtifactAs, startTask, usePluginContext, usePluginEvents,
  type JsonValue,
} from '@whale-buddy/plugin-sdk/ui';
import { definePluginRuntime } from '@whale-buddy/plugin-sdk/runtime';
import type { HostArtifact, HostAttachment } from '@whale-buddy/plugin-sdk/ui';
import { renderHtmlDocument } from './html-document';
import './styles.css';

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

type Format = 'html' | 'docx' | 'xlsx';
interface Draft { taskId: string; title: string; format: Format; summary: string; content: string; columns?: string[]; rows?: Array<Record<string, JsonValue>> }
interface StoredState { draft?: Draft; artifact?: HostArtifact }

definePluginRuntime({
  'stage-artifact': async (input, services) => {
    const draft = asDraft(input);
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
] as const;

function App() {
  const context = usePluginContext();
  if (!context) return null;
  if (context.surface.kind === 'ui' && context.surface.contributionType === 'card') return <ResultCard threadId={context.threadId} />;
  return <TaskPage />;
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
    if (taskType === 'html' || taskType === 'docx' || taskType === 'xlsx') setFormat(taskType);
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
      <div className="row"><label>输出格式</label><select value={format} onChange={(event) => setFormat(event.target.value as Format)}><option value="html">HTML</option><option value="docx">Word (.docx)</option><option value="xlsx">Excel (.xlsx)</option></select></div>
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
  return <article className="preview"><h3>{draft.title}</h3><p>{draft.summary}</p><pre>{previewText(draft)}</pre><div className="actions">
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
  } else if (extension === 'pptx') text = await extractPptx(bytes);
  else text = new TextDecoder().decode(bytes);
  return { name: attachment.name, mimeType: attachment.mimeType ?? '', sha256: attachment.sha256 ?? '', text: text.slice(0, 200_000) };
}

async function extractPptx(bytes: Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(bytes);
  const names = Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)).sort();
  return (await Promise.all(names.map(async (name) => (await zip.file(name)!.async('text')).replace(/<a:br\s*\/>/g, '\n').replace(/<[^>]+>/g, ' ')))).join('\n');
}

async function renderArtifact(draft: Draft): Promise<string> {
  if (draft.format === 'html') return toBase64(new TextEncoder().encode(renderHtmlDocument(draft.title, draft.content)));
  if (draft.format === 'docx') {
    const document = new Document({ sections: [{ children: [new Paragraph({ children: [new TextRun({ text: draft.title, bold: true, size: 32 })] }), ...draft.content.split(/\n+/).map((line) => new Paragraph(line))] }] });
    return blobToBase64(await Packer.toBlob(document));
  }
  const rows = draft.rows?.length ? draft.rows : draft.content.split('\n').filter(Boolean).map((value) => ({ 内容: value }));
  const sheet = XLSX.utils.json_to_sheet(rows, { header: draft.columns });
  const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, sheet, '成果');
  return toBase64(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }));
}

function asDraft(value: JsonValue): Draft {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('办公成果参数无效');
  const record = value as Record<string, JsonValue>;
  const format = record.format;
  if (format !== 'html' && format !== 'docx' && format !== 'xlsx') throw new Error('办公成果格式无效');
  const required = (key: string) => { const result = record[key]; if (typeof result !== 'string' || !result.trim()) throw new Error(`办公成果缺少 ${key}`); return result; };
  return { taskId: required('taskId'), title: required('title'), format, summary: required('summary'), content: required('content'), columns: Array.isArray(record.columns) ? record.columns.filter((item): item is string => typeof item === 'string') : undefined, rows: Array.isArray(record.rows) ? record.rows.filter((item): item is Record<string, JsonValue> => Boolean(item) && typeof item === 'object' && !Array.isArray(item)) : undefined };
}
function previewText(draft: Draft) { return draft.format === 'xlsx' && draft.rows?.length ? JSON.stringify(draft.rows.slice(0, 20), null, 2) : draft.content; }
function fromBase64(value: string) { const binary = atob(value); return Uint8Array.from(binary, (character) => character.charCodeAt(0)); }
function toBase64(value: ArrayBuffer | Uint8Array) { const bytes = value instanceof Uint8Array ? value : new Uint8Array(value); let binary = ''; for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)); return btoa(binary); }
async function blobToBase64(blob: Blob) { return toBase64(await blob.arrayBuffer()); }

createRoot(document.getElementById('root')!).render(<App />);
