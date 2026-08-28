import type { WhaleEvent } from '../../shared/types';
import type { PendingApproval } from './store';

export function pruneApprovalsForEvent(
  approvals: PendingApproval[],
  event: WhaleEvent,
): PendingApproval[] {
  if (event.kind !== 'notification') return approvals;
  const params = record(event.message.params);
  if (event.message.method === 'serverRequest/resolved') {
    const requestId = params?.requestId;
    if (typeof requestId !== 'string' && typeof requestId !== 'number') return approvals;
    return approvals.filter((approval) => requestKey(approval.id) !== requestKey(requestId));
  }
  if (event.message.method === 'turn/completed') {
    const turnId = string(record(params?.turn)?.id) ?? string(params?.turnId);
    if (!turnId) return approvals;
    return approvals.filter((approval) => approval.turnId !== turnId);
  }
  return approvals;
}

function requestKey(value: string | number): string {
  return `${typeof value}:${String(value)}`;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function string(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}
