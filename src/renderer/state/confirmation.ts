import { create } from 'zustand';

interface ConfirmationOptions {
  title?: string;
  confirmLabel?: string;
  danger?: boolean;
}
interface PendingConfirmation extends ConfirmationOptions {
  message: string;
  resolve: (accepted: boolean) => void;
}
export const useConfirmation = create<{ pending: PendingConfirmation | null }>(() => ({ pending: null }));

export function confirmAction(message: string, options: ConfirmationOptions = {}): Promise<boolean> {
  // A repeated click must not replace an existing decision or authorize twice.
  if (useConfirmation.getState().pending) return Promise.resolve(false);
  return new Promise((resolve) => useConfirmation.setState({ pending: { message, ...options, resolve } }));
}

export function answerConfirmation(accepted: boolean): void {
  const pending = useConfirmation.getState().pending;
  useConfirmation.setState({ pending: null });
  pending?.resolve(accepted);
}
