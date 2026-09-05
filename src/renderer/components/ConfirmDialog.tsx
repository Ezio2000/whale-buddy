import { useRef } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { answerConfirmation, useConfirmation } from '../state/confirmation';

export function ConfirmDialog() {
  const pending = useConfirmation((state) => state.pending);
  const cancel = useRef<HTMLButtonElement>(null);
  return <Dialog.Root open={Boolean(pending)} onOpenChange={(open) => { if (!open) answerConfirmation(false); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="dialog-overlay confirmation-overlay" />
      <Dialog.Content className="dialog-content confirmation-dialog" onOpenAutoFocus={(event) => {
        event.preventDefault(); cancel.current?.focus();
      }}>
        <Dialog.Title>{pending?.title ?? '确认操作'}</Dialog.Title>
        <Dialog.Description>{pending?.message}</Dialog.Description>
        <div className="dialog-actions">
          <button ref={cancel} className="button secondary" onClick={() => answerConfirmation(false)}>取消</button>
          <button className={`button ${pending?.danger ? 'secondary danger' : 'primary'}`} onClick={() => answerConfirmation(true)}>{pending?.confirmLabel ?? '确认'}</button>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
