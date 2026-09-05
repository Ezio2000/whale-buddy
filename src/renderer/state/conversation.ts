import { userVisibleText } from '../../shared/display-text';
import type { HistoryPage, OperationRecord, TurnChangesSnapshot, WhaleEvent } from '../../shared/types';

export interface ItemView {
  id: string;
  type: string;
  [key: string]: unknown;
}

export interface PlanStepView {
  step: string;
  status: string;
}

export interface TurnView {
  id: string;
  status: string;
  error: unknown;
  startedAt: number | null;
  completedAt: number | null;
  durationMs: number | null;
  itemOrder: string[];
  items: Record<string, ItemView>;
  diff: string;
  fileChanges: TurnChangesSnapshot['files'];
  plan: PlanStepView[];
  planExplanation: string | null;
  operation?: OperationRecord | null;
}

export interface ThreadView {
  id: string;
  name: string | null;
  preview: string;
  cwd: string;
  status: unknown;
  turnOrder: string[];
  turns: Record<string, TurnView>;
}

export interface ConversationState {
  generation: number;
  lastSequence: number;
  threads: Record<string, ThreadView>;
}

interface PersistedItemTiming {
  startedAtMs: number | null;
  completedAtMs: number | null;
}

const TOOL_TIMINGS_STORAGE_KEY = 'whale.tool-timings.v1';
const MAX_PERSISTED_TOOL_TIMINGS = 5_000;
let persistedToolTimings: Record<string, PersistedItemTiming> | null = null;

export const emptyConversationState = (): ConversationState => ({
  generation: 0,
  lastSequence: 0,
  threads: {},
});

export function reduceConversation(
  previous: ConversationState,
  event: WhaleEvent,
): ConversationState {
  if (event.kind !== 'notification') return previous;
  if (event.generation < previous.generation) return previous;
  if (event.generation === previous.generation && event.sequence <= previous.lastSequence) return previous;

  const state = structuredClone(previous);
  if (event.generation > state.generation) {
    state.generation = event.generation;
    state.lastSequence = 0;
  }
  state.lastSequence = event.sequence;

  const params = record(event.message.params);
  const method = event.message.method;

  if (method === 'thread/started') {
    const thread = record(params?.thread);
    if (thread) upsertThread(state, thread);
    return state;
  }

  if (method === 'thread/name/updated') {
    const threadId = string(params?.threadId);
    if (threadId && state.threads[threadId]) state.threads[threadId].name = userVisibleText(nullableString(params?.name)) || null;
    return state;
  }

  if (method === 'thread/status/changed') {
    const threadId = string(params?.threadId);
    if (threadId && state.threads[threadId]) state.threads[threadId].status = params?.status;
    return state;
  }

  const threadId = string(params?.threadId) ?? string(record(params?.thread)?.id);
  if (!threadId) return state;
  const thread = ensureThread(state, threadId);

  if (method === 'turn/started') {
    const turn = record(params?.turn);
    if (turn) mergeTurn(thread, turn, true);
    return state;
  }

  if (method === 'turn/completed') {
    const turn = record(params?.turn);
    if (turn) mergeTurn(thread, turn, false);
    // Some providers end a turn without item/completed for every streamed
    // item; nothing can still be running after the turn is over.
    for (const threadTurn of Object.values(thread.turns)) {
      for (const item of Object.values(threadTurn.items)) {
        if (item.status === 'inProgress') item.status = 'completed';
      }
    }
    return state;
  }

  const turnId = string(params?.turnId) ?? string(record(params?.turn)?.id);
  if (!turnId) return state;
  const turn = ensureTurn(thread, turnId);

  if (method === 'hook/started' || method === 'hook/completed') {
    const run = record(params?.run);
    if (
      run?.source === 'plugin'
      && run.eventName === 'stop'
      && run.handlerType === 'command'
      && typeof run.id === 'string'
    ) {
      upsertItem(turn, {
        ...run,
        id: `hook:${turnId}:${run.id}`,
        hookRunId: run.id,
        type: 'hookRun',
        durationMs: bigintNumber(run.durationMs),
        startedAt: bigintNumber(run.startedAt),
        completedAt: bigintNumber(run.completedAt),
      });
    }
    return state;
  }

  if (method === 'item/started' || method === 'item/completed') {
    const item = record(params?.item);
    if (item) {
      const current = turn.items[string(item.id) ?? ''];
      const startedAtMs =
        nullableNumber(current?.whaleStartedAtMs)
        ?? nullableNumber(params?.startedAtMs)
        ?? (method === 'item/started' ? Date.now() : null);
      const completedAtMs = method === 'item/completed'
        ? nullableNumber(params?.completedAtMs) ?? Date.now()
        : null;
      upsertItem(turn, {
        ...item,
        status: item.status ?? (method === 'item/started' ? 'inProgress' : 'completed'),
        whaleStartedAtMs: startedAtMs,
        whaleCompletedAtMs: completedAtMs,
      });
    }
    return state;
  }

  if (method === 'turn/diff/updated') {
    turn.diff = string(params?.diff) ?? '';
    return state;
  }

  if (method === 'turn/plan/updated') {
    turn.plan = Array.isArray(params?.plan)
      ? params.plan.map((entry) => {
          const step = record(entry);
          return {
            step: string(step?.step) ?? '',
            status: string(step?.status) ?? 'pending',
          };
        })
      : [];
    turn.planExplanation = nullableString(params?.explanation);
    return state;
  }

  const itemId = string(params?.itemId);
  if (!itemId) return state;
  const item = turn.items[itemId] ?? { id: itemId, type: inferItemType(method) };
  if (!turn.items[itemId]) {
    turn.items[itemId] = item;
    turn.itemOrder.push(itemId);
  }
  const delta = string(params?.delta) ?? '';

  switch (method) {
    case 'item/agentMessage/delta':
      item.type = 'agentMessage';
      item.text = `${string(item.text) ?? ''}${delta}`;
      break;
    case 'item/plan/delta':
      item.type = 'plan';
      item.text = `${string(item.text) ?? ''}${delta}`;
      break;
    case 'item/reasoning/summaryTextDelta': {
      item.type = 'reasoning';
      const summary = Array.isArray(item.summary) ? [...item.summary] : [];
      const index = typeof params?.summaryIndex === 'number' ? params.summaryIndex : Math.max(0, summary.length - 1);
      while (summary.length <= index) summary.push('');
      summary[index] = `${string(summary[index]) ?? ''}${delta}`;
      item.summary = summary;
      break;
    }
    case 'item/reasoning/summaryPartAdded': {
      item.type = 'reasoning';
      const summary = Array.isArray(item.summary) ? [...item.summary] : [];
      const index = typeof params?.summaryIndex === 'number' ? params.summaryIndex : summary.length;
      while (summary.length <= index) summary.push('');
      item.summary = summary;
      break;
    }
    case 'item/reasoning/textDelta': {
      item.type = 'reasoning';
      const content = Array.isArray(item.content) ? [...item.content] : [];
      const index = typeof params?.contentIndex === 'number' ? params.contentIndex : Math.max(0, content.length - 1);
      while (content.length <= index) content.push('');
      content[index] = `${string(content[index]) ?? ''}${delta}`;
      item.content = content;
      break;
    }
    case 'item/commandExecution/outputDelta':
      item.type = 'commandExecution';
      item.aggregatedOutput = `${string(item.aggregatedOutput) ?? ''}${delta}`;
      break;
    case 'item/fileChange/outputDelta':
      item.type = 'fileChange';
      item.output = `${string(item.output) ?? ''}${delta}`;
      break;
    case 'item/fileChange/patchUpdated':
      item.type = 'fileChange';
      item.changes = Array.isArray(params?.changes) ? params.changes : item.changes;
      break;
    default:
      item.lastNotification = { method, params };
  }
  return state;
}

function bigintNumber(value: unknown): number | null {
  if (typeof value === 'bigint') return Number(value);
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function hydrateHistory(
  previous: ConversationState,
  threadId: string,
  page: HistoryPage,
  mode: 'replace' | 'append' | 'prepend' = 'replace',
): ConversationState {
  const state: ConversationState = {
    ...previous,
    threads: { ...previous.threads },
  };
  if (mode !== 'replace' && previous.threads[threadId]) {
    state.threads[threadId] = structuredClone(previous.threads[threadId]);
  } else {
    delete state.threads[threadId];
  }
  const thread = ensureThread(state, threadId);
  const existingTurnOrder = [...thread.turnOrder];
  const pageTurnOrder: string[] = [];
  const existingItemOrders = new Map<string, string[]>();
  const pageItemOrders = new Map<string, string[]>();

  const notePageTurn = (turnId: string) => {
    if (!pageTurnOrder.includes(turnId)) pageTurnOrder.push(turnId);
    if (!existingItemOrders.has(turnId)) {
      existingItemOrders.set(turnId, [...(thread.turns[turnId]?.itemOrder ?? [])]);
    }
  };

  for (const rawTurn of page.turns) {
    const turn = record(rawTurn);
    // `thread/turns/list` only carries the requested summary view. Its items are
    // lossy and can omit reasoning/tool activity, so using them to seed
    // itemOrder makes the omitted items appear at the end when the authoritative
    // `thread/items/list` page is merged below.
    const turnId = string(turn?.id);
    if (turn && turnId) {
      notePageTurn(turnId);
      mergeTurn(thread, turn, false);
    }
  }
  for (const rawEntry of page.items) {
    const entry = record(rawEntry);
    const turnId = string(entry?.turnId);
    const item = record(entry?.item);
    if (!turnId || !item) continue;
    notePageTurn(turnId);
    const itemId = string(item.id);
    if (itemId) {
      const order = pageItemOrders.get(turnId) ?? [];
      if (!order.includes(itemId)) order.push(itemId);
      pageItemOrders.set(turnId, order);
    }
    // Items arrive from the authoritative history page without a status
    // field; a finished history turn must not read as still-running.
    upsertItem(ensureTurn(thread, turnId), { ...item, status: string(item.status) ?? 'completed' });
  }
  if (mode === 'prepend') {
    thread.turnOrder = uniqueOrder(pageTurnOrder, existingTurnOrder);
    for (const [turnId, pageItemOrder] of pageItemOrders) {
      const turn = thread.turns[turnId];
      if (turn) turn.itemOrder = uniqueOrder(pageItemOrder, existingItemOrders.get(turnId) ?? []);
    }
  }
  for (const snapshot of page.plans) {
    const turn = thread.turns[snapshot.turnId];
    if (!turn) continue;
    turn.plan = snapshot.plan.map((step) => ({ ...step }));
    turn.planExplanation = snapshot.explanation;
  }
  for (const snapshot of page.changes) {
    const turn = thread.turns[snapshot.turnId];
    if (!turn) continue;
    turn.diff = snapshot.diff;
    turn.fileChanges = snapshot.files.map((change) => ({ ...change }));
  }
  for (const operation of page.operations ?? []) {
    if (!operation.turnId) continue;
    const turn = thread.turns[operation.turnId];
    if (turn) turn.operation = structuredClone(operation);
  }
  return state;
}

function uniqueOrder(first: string[], second: string[]): string[] {
  return [...new Set([...first, ...second])];
}

export function applyTurnChanges(
  previous: ConversationState,
  threadId: string,
  snapshot: TurnChangesSnapshot,
): ConversationState {
  const state = structuredClone(previous);
  const turn = ensureTurn(ensureThread(state, threadId), snapshot.turnId);
  turn.diff = snapshot.diff;
  turn.fileChanges = snapshot.files.map((change) => ({ ...change }));
  return state;
}

export function latestTurnWithDetails(
  state: ConversationState,
  threadId: string | null,
): TurnView | null {
  if (!threadId) return null;
  const thread = state.threads[threadId];
  if (!thread) return null;
  for (let index = thread.turnOrder.length - 1; index >= 0; index -= 1) {
    const turn = thread.turns[thread.turnOrder[index]];
    if (turn && (turn.diff || turn.fileChanges.length > 0 || turn.plan.length > 0)) return turn;
  }
  return null;
}

export function itemsForThread(state: ConversationState, threadId: string | null): ItemView[] {
  if (!threadId) return [];
  const thread = state.threads[threadId];
  if (!thread) return [];
  return thread.turnOrder.flatMap((turnId) => {
    const turn = thread.turns[turnId];
    return turn
      ? turn.itemOrder
          .map((itemId) => turn.items[itemId])
          .filter((item): item is ItemView => Boolean(item))
          .filter(isVisibleConversationItem)
      : [];
  });
}

function isVisibleConversationItem(item: ItemView): boolean {
  if (item.type !== 'reasoning') return true;
  return hasNonEmptyText(item.summary) || hasNonEmptyText(item.content);
}

function hasNonEmptyText(value: unknown): boolean {
  return Array.isArray(value)
    && value.some((entry) => typeof entry === 'string' && entry.trim().length > 0);
}

export function activeTurnForThread(
  state: ConversationState,
  threadId: string | null,
): TurnView | null {
  if (!threadId) return null;
  const thread = state.threads[threadId];
  if (!thread) return null;
  for (let index = thread.turnOrder.length - 1; index >= 0; index -= 1) {
    const turn = thread.turns[thread.turnOrder[index]];
    if (turn && ['inProgress', 'running'].includes(turn.status)) return turn;
  }
  return null;
}

function upsertThread(state: ConversationState, raw: Record<string, unknown>): ThreadView {
  const id = string(raw.id);
  if (!id) throw new Error('thread 缺少 id');
  const thread = ensureThread(state, id);
  thread.name = userVisibleText(nullableString(raw.name)) || null;
  thread.preview = userVisibleText(string(raw.preview) ?? thread.preview);
  thread.cwd = string(raw.cwd) ?? thread.cwd;
  thread.status = raw.status ?? thread.status;
  if (Array.isArray(raw.turns)) {
    for (const rawTurn of raw.turns) {
      const turn = record(rawTurn);
      if (turn) mergeTurn(thread, turn, true);
    }
  }
  return thread;
}

function ensureThread(state: ConversationState, id: string): ThreadView {
  state.threads[id] ??= {
    id,
    name: null,
    preview: '',
    cwd: '',
    status: 'notLoaded',
    turnOrder: [],
    turns: {},
  };
  return state.threads[id];
}

function mergeTurn(thread: ThreadView, raw: Record<string, unknown>, includeItems: boolean): TurnView {
  const id = string(raw.id);
  if (!id) throw new Error('turn 缺少 id');
  const turn = ensureTurn(thread, id);
  turn.status = string(raw.status) ?? turn.status;
  turn.error = raw.error ?? turn.error;
  turn.startedAt = nullableNumber(raw.startedAt) ?? turn.startedAt;
  turn.completedAt = nullableNumber(raw.completedAt) ?? turn.completedAt;
  turn.durationMs = nullableNumber(raw.durationMs) ?? turn.durationMs;
  if (includeItems && Array.isArray(raw.items)) {
    for (const rawItem of raw.items) {
      const item = record(rawItem);
      // History turns are finished by definition; items persisted without a
      // status must not read as still-running (reasoning would stay open).
      if (item) upsertItem(turn, { ...item, status: string(item.status) ?? 'completed' });
    }
  }
  return turn;
}

function ensureTurn(thread: ThreadView, id: string): TurnView {
  if (!thread.turns[id]) {
    thread.turns[id] = {
      id,
      status: 'inProgress',
      error: null,
      startedAt: null,
      completedAt: null,
      durationMs: null,
      itemOrder: [],
      items: {},
      diff: '',
      fileChanges: [],
      plan: [],
      planExplanation: null,
      operation: null,
    };
    thread.turnOrder.push(id);
  }
  return thread.turns[id];
}

function upsertItem(turn: TurnView, raw: Record<string, unknown>): void {
  const id = string(raw.id);
  if (!id) return;
  if (!turn.items[id]) turn.itemOrder.push(id);
  const persistedTiming = readPersistedItemTiming(id);
  const whaleStartedAtMs = nullableNumber(raw.whaleStartedAtMs) ?? persistedTiming?.startedAtMs ?? null;
  const whaleCompletedAtMs = nullableNumber(raw.whaleCompletedAtMs) ?? persistedTiming?.completedAtMs ?? null;
  // item/completed is the authoritative snapshot, so replace instead of merging deltas.
  turn.items[id] = {
    ...raw,
    id,
    type: string(raw.type) ?? 'unknown',
    whaleStartedAtMs,
    whaleCompletedAtMs,
  };
  if (whaleStartedAtMs !== null || whaleCompletedAtMs !== null) {
    persistItemTiming(id, whaleStartedAtMs, whaleCompletedAtMs);
  }
}

function readPersistedItemTiming(itemId: string): PersistedItemTiming | null {
  return readPersistedToolTimings()[itemId] ?? null;
}

function persistItemTiming(
  itemId: string,
  startedAtMs: number | null,
  completedAtMs: number | null,
): void {
  const timings = readPersistedToolTimings();
  delete timings[itemId];
  timings[itemId] = { startedAtMs, completedAtMs };
  const entries = Object.entries(timings);
  if (entries.length > MAX_PERSISTED_TOOL_TIMINGS) {
    persistedToolTimings = Object.fromEntries(entries.slice(-MAX_PERSISTED_TOOL_TIMINGS));
  }
  try {
    window.localStorage.setItem(
      TOOL_TIMINGS_STORAGE_KEY,
      JSON.stringify(persistedToolTimings),
    );
  } catch {
    // Timing metadata is best-effort; conversation rendering must remain available.
  }
}

function readPersistedToolTimings(): Record<string, PersistedItemTiming> {
  if (persistedToolTimings) return persistedToolTimings;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(TOOL_TIMINGS_STORAGE_KEY) ?? '{}') as unknown;
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      persistedToolTimings = parsed as Record<string, PersistedItemTiming>;
      return persistedToolTimings;
    }
  } catch {
    // Ignore corrupt or unavailable local UI state.
  }
  persistedToolTimings = {};
  return persistedToolTimings;
}

function inferItemType(method: string): string {
  if (method.includes('agentMessage')) return 'agentMessage';
  if (method.includes('reasoning')) return 'reasoning';
  if (method.includes('commandExecution')) return 'commandExecution';
  if (method.includes('fileChange')) return 'fileChange';
  if (method.includes('plan')) return 'plan';
  return 'unknown';
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function string(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function nullableString(value: unknown): string | null {
  return value === null ? null : string(value);
}

function nullableNumber(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}
