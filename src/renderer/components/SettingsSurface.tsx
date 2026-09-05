import * as Dialog from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';

/** Full workspace pages share the same content with the first-run settings dialog. */
export function SettingsSurface({ embedded, open, onOpenChange, className, children }: {
  embedded: boolean;
  open: boolean;
  onOpenChange(open: boolean): void;
  className: string;
  children: ReactNode;
}) {
  if (embedded) return <section className={`workspace-page ${className}`}>{children}</section>;
  return <Dialog.Root open={open} onOpenChange={onOpenChange}>
    <Dialog.Portal>
      <Dialog.Overlay className="dialog-overlay" />
      <Dialog.Content className={`dialog-content ${className}`}>{children}</Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
