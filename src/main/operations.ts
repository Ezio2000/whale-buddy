import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type {
  AuditEvent,
  IdentityContext,
  JsonObject,
  JsonValue,
  OperationRecord,
  PolicyDecision,
} from '../shared/types';

interface OperationState {
  version: 1;
  operations: Record<string, OperationRecord>;
}

const MAX_STORED_OPERATIONS = 2_000;

export class OperationStore {
  private readonly filePath: string;
  private state: OperationState;
  private readonly pendingTurnDecisions = new Map<
    string,
    Array<Omit<PolicyDecision, 'id' | 'decidedAt'>>
  >();
  private readonly pendingTurnEvents = new Map<string, Array<{
    type: AuditEvent['type'];
    outcome: AuditEvent['outcome'];
    reason: string | null;
  }>>();

  constructor(uiStateRoot: string) {
    mkdirSync(uiStateRoot, { recursive: true });
    this.filePath = path.join(uiStateRoot, 'operations.json');
    this.state = this.read();
  }

  start(input: {
    identity: IdentityContext | null;
    action: string;
    resource?: JsonObject;
    threadId?: string | null;
  }): string {
    const operationId = randomUUID();
    const now = Date.now();
    const record: OperationRecord = {
      operationId,
      identity: input.identity ? structuredClone(input.identity) : null,
      action: input.action,
      resource: structuredClone(input.resource ?? {}),
      threadId: input.threadId ?? null,
      turnId: null,
      createdAt: now,
      updatedAt: now,
      decisions: [],
      events: [],
    };
    record.events.push(event(record, 'operation.started', input.action, 'started', null));
    this.save(record);
    return operationId;
  }

  attachTurn(operationId: string, threadId: string, turnId: string): void {
    const record = this.state.operations[operationId];
    if (!record) return;
    record.threadId = threadId;
    record.turnId = turnId;
    for (const pending of this.pendingTurnDecisions.get(turnId) ?? []) {
      this.addDecision(record, pending);
    }
    this.pendingTurnDecisions.delete(turnId);
    for (const pending of this.pendingTurnEvents.get(turnId) ?? []) {
      record.events.push(event(record, pending.type, record.action, pending.outcome, pending.reason));
    }
    this.pendingTurnEvents.delete(turnId);
    record.updatedAt = Date.now();
    this.save(record);
  }

  addDecisionByOperation(
    operationId: string,
    input: Omit<PolicyDecision, 'id' | 'decidedAt'>,
  ): void {
    const record = this.state.operations[operationId];
    if (!record) return;
    this.addDecision(record, input);
  }

  addDecisionByTurn(
    turnId: string,
    input: Omit<PolicyDecision, 'id' | 'decidedAt'>,
  ): void {
    const record = this.operationForTurn(turnId);
    if (!record) {
      const pending = this.pendingTurnDecisions.get(turnId) ?? [];
      pending.push(input);
      this.pendingTurnDecisions.set(turnId, pending);
      return;
    }
    this.addDecision(record, input);
  }

  addEventByTurn(
    turnId: string,
    type: AuditEvent['type'],
    outcome: AuditEvent['outcome'],
    reason: string | null = null,
  ): void {
    const record = this.operationForTurn(turnId);
    if (!record) {
      const pending = this.pendingTurnEvents.get(turnId) ?? [];
      pending.push({ type, outcome, reason });
      this.pendingTurnEvents.set(turnId, pending);
      return;
    }
    record.events.push(event(record, type, record.action, outcome, reason));
    record.updatedAt = Date.now();
    this.save(record);
  }

  completeTurn(turnId: string, status: string, reason: string | null): void {
    const normalized = status.toLocaleLowerCase();
    const outcome: AuditEvent['outcome'] = normalized === 'completed'
      ? 'succeeded'
      : ['interrupted', 'cancelled', 'canceled'].includes(normalized)
        ? 'cancelled'
        : 'failed';
    this.addEventByTurn(turnId, 'operation.completed', outcome, reason);
  }

  fail(operationId: string, reason: string): void {
    const record = this.state.operations[operationId];
    if (!record) return;
    record.events.push(event(record, 'operation.completed', record.action, 'failed', reason));
    record.updatedAt = Date.now();
    this.save(record);
  }

  find(turnIds: Iterable<string>): OperationRecord[] {
    const wanted = new Set(turnIds);
    return Object.values(this.state.operations)
      .filter((record) => record.turnId !== null && wanted.has(record.turnId))
      .map((record) => structuredClone(record));
  }

  private addDecision(
    record: OperationRecord,
    input: Omit<PolicyDecision, 'id' | 'decidedAt'>,
  ): void {
    const decision: PolicyDecision = {
      id: randomUUID(),
      decidedAt: Date.now(),
      ...input,
    };
    record.decisions.push(decision);
    record.events.push(event(
      record,
      decision.effect === 'confirm' ? 'approval.requested' : 'policy.decided',
      decision.action,
      decision.effect === 'confirm'
        ? 'confirmation-required'
        : decision.effect === 'allow'
          ? 'allowed'
          : 'denied',
      decision.reason,
    ));
    record.updatedAt = Date.now();
    this.save(record);
  }

  private operationForTurn(turnId: string): OperationRecord | null {
    return Object.values(this.state.operations).find((record) => record.turnId === turnId) ?? null;
  }

  private save(record: OperationRecord): void {
    delete this.state.operations[record.operationId];
    this.state.operations[record.operationId] = record;
    const entries = Object.entries(this.state.operations);
    if (entries.length > MAX_STORED_OPERATIONS) {
      this.state.operations = Object.fromEntries(entries.slice(-MAX_STORED_OPERATIONS));
    }
    const temporaryPath = `${this.filePath}.tmp`;
    writeFileSync(temporaryPath, `${JSON.stringify(this.state, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    renameSync(temporaryPath, this.filePath);
  }

  private read(): OperationState {
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as OperationState;
      if (parsed.version !== 1 || !isOperationRecordMap(parsed.operations)) {
        throw new Error('invalid operation state');
      }
      return parsed;
    } catch {
      return { version: 1, operations: {} };
    }
  }
}

export function approvalEffect(response: JsonValue): 'allow' | 'deny' {
  if (!response || typeof response !== 'object' || Array.isArray(response)) return 'allow';
  if (response.action === 'decline') return 'deny';
  if (response.action === 'accept') return 'allow';
  if (response.decision === 'decline') return 'deny';
  if (response.decision === 'accept' || response.decision === 'acceptForSession') return 'allow';
  if (response.decision && typeof response.decision === 'object' && !Array.isArray(response.decision)) {
    return 'denied' in response.decision ? 'deny' : 'allow';
  }
  if (response.permissions && typeof response.permissions === 'object' && !Array.isArray(response.permissions)) {
    return Object.keys(response.permissions).length > 0 ? 'allow' : 'deny';
  }
  return 'allow';
}

function event(
  record: OperationRecord,
  type: AuditEvent['type'],
  action: string,
  outcome: AuditEvent['outcome'],
  reason: string | null,
): AuditEvent {
  return {
    id: randomUUID(),
    operationId: record.operationId,
    type,
    action,
    outcome,
    timestamp: Date.now(),
    reason,
  };
}

function isOperationRecordMap(value: unknown): value is Record<string, OperationRecord> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.values(value).every((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
    const record = entry as Partial<OperationRecord>;
    return typeof record.operationId === 'string'
      && (record.identity === null || typeof record.identity === 'object')
      && typeof record.action === 'string'
      && typeof record.createdAt === 'number'
      && typeof record.updatedAt === 'number'
      && Array.isArray(record.decisions)
      && Array.isArray(record.events);
  });
}
