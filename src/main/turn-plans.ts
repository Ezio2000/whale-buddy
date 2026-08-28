import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { TurnPlanSnapshot } from '../shared/types';

interface TurnPlanState {
  version: 1;
  plans: Record<string, TurnPlanSnapshot>;
}

const MAX_STORED_PLANS = 2_000;

export class TurnPlanStore {
  private readonly filePath: string;
  private state: TurnPlanState;

  constructor(uiStateRoot: string) {
    mkdirSync(uiStateRoot, { recursive: true });
    this.filePath = path.join(uiStateRoot, 'turn-plans.json');
    this.state = this.read();
  }

  save(snapshot: TurnPlanSnapshot): void {
    delete this.state.plans[snapshot.turnId];
    this.state.plans[snapshot.turnId] = snapshot;
    const entries = Object.entries(this.state.plans);
    if (entries.length > MAX_STORED_PLANS) {
      this.state.plans = Object.fromEntries(entries.slice(-MAX_STORED_PLANS));
    }
    this.write();
  }

  find(turnIds: Iterable<string>): TurnPlanSnapshot[] {
    const plans: TurnPlanSnapshot[] = [];
    for (const turnId of new Set(turnIds)) {
      const snapshot = this.state.plans[turnId];
      if (snapshot) plans.push(structuredClone(snapshot));
    }
    return plans;
  }

  private read(): TurnPlanState {
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as TurnPlanState;
      if (parsed.version !== 1 || !isPlanRecord(parsed.plans)) throw new Error('invalid turn plan state');
      return parsed;
    } catch {
      return { version: 1, plans: {} };
    }
  }

  private write(): void {
    const temporaryPath = `${this.filePath}.tmp`;
    writeFileSync(temporaryPath, `${JSON.stringify(this.state, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    renameSync(temporaryPath, this.filePath);
  }
}

function isPlanRecord(value: unknown): value is Record<string, TurnPlanSnapshot> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return Object.values(value).every((snapshot) => {
    if (typeof snapshot !== 'object' || snapshot === null || Array.isArray(snapshot)) return false;
    const candidate = snapshot as Partial<TurnPlanSnapshot>;
    return typeof candidate.turnId === 'string'
      && (candidate.explanation === null || typeof candidate.explanation === 'string')
      && typeof candidate.updatedAt === 'number'
      && Array.isArray(candidate.plan)
      && candidate.plan.every((step) => (
        typeof step?.step === 'string' && typeof step?.status === 'string'
      ));
  });
}
