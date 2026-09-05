import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useAppStore } from '../state/store';

export function RenameThreadDialog({ thread, onClose }: {
  thread: { id: string; title: string };
  onClose(): void;
}) {
  const rename = useAppStore((state) => state.renameThread);
  const [name, setName] = useState(thread.title);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  return <Dialog.Root open onOpenChange={(open) => { if (!open && !saving) onClose(); }}>
    <Dialog.Portal><Dialog.Overlay className="dialog-overlay" />
      <Dialog.Content className="dialog-content rename-thread-dialog">
        <Dialog.Title>重命名对话</Dialog.Title>
        <Dialog.Description>修改此对话在最近列表中的名称。</Dialog.Description>
        <form onSubmit={async (event) => {
          event.preventDefault();
          if (!name.trim() || saving) return;
          setSaving(true); setError('');
          try { await rename(name.trim(), thread.id); onClose(); }
          catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
          finally { setSaving(false); }
        }}>
          <label>对话名称<input autoFocus aria-label="对话名称" value={name} onChange={(event) => setName(event.target.value)} disabled={saving} /></label>
          {error && <p role="alert">{error}</p>}
          <div className="dialog-actions"><button type="button" className="button secondary" disabled={saving} onClick={onClose}>取消</button><button className="button primary" disabled={saving || !name.trim()}>{saving ? '保存中…' : '保存'}</button></div>
        </form>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
