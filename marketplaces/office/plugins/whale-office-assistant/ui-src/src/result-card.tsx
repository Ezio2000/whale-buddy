import { useEffect, useState, type ReactNode } from 'react';
import { createArtifact, listArtifacts, openArtifact, saveArtifactAs, usePluginEvents, type HostArtifact, type PluginContext } from '@whale-buddy/plugin-sdk/ui';
import { parseOfficeDraft, type OfficeDraft } from './office-artifact';

export function ResultCard({ context, renderArtifact, renderPreview }: {
  context: PluginContext;
  renderArtifact(draft: OfficeDraft): Promise<string>;
  renderPreview(draft: OfficeDraft): ReactNode;
}) {
  const threadId = context?.threadId;
  const item = context?.message?.data;
  const itemId = context?.message?.itemId;
  const taskId = itemId ? 'office-call:' + itemId : null;
  const [artifact, setArtifact] = useState<HostArtifact | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  let draft: OfficeDraft | null = null;
  let invalid = '';
  try {
    if (item && typeof item === 'object' && !Array.isArray(item) && item.arguments != null) {
      draft = parseOfficeDraft(typeof item.arguments === 'string' ? JSON.parse(item.arguments) : item.arguments);
    }
  } catch (error) { invalid = error instanceof Error ? error.message : String(error); }
  const load = async () => {
    if (!threadId || !taskId) return;
    try { setArtifact((await listArtifacts(threadId)).find((entry) => entry.taskId === taskId) ?? null); }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  };
  useEffect(() => { void load(); }, [threadId, taskId]);
  usePluginEvents((event) => {
    if (event.type === 'artifacts.changed' && event.threadId === threadId) void load();
  });
  const confirm = async () => {
    if (!threadId || !taskId || !draft || busy) return;
    setBusy(true); setMessage('正在生成正式文件…');
    try {
      const existing = (await listArtifacts(threadId)).find((entry) => entry.taskId === taskId);
      const saved = existing ?? await createArtifact({ name: draft.title, format: draft.format,
        dataBase64: await renderArtifact(draft), threadId, taskId });
      setArtifact(saved); setMessage('成果已保存到 Whale 成果库。');
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  if (!draft) return <div className="preview">{invalid || '本次调用尚无可用预览。'}</div>;
  return <article className="preview"><h3>{draft.title}</h3><p>{draft.summary}</p>{renderPreview(draft)}<div className="actions">
    {!artifact && <button className="primary" disabled={busy || !taskId || context?.message?.status !== 'completed'} onClick={() => void confirm()}>确认并生成 {draft.format.toUpperCase()}</button>}
    {artifact && <><button className="secondary" onClick={() => void openArtifact(artifact.id)}>打开成果</button><button className="secondary" onClick={() => void saveArtifactAs(artifact.id)}>另存为</button></>}
  </div>{message && <p>{message}</p>}</article>;
}
