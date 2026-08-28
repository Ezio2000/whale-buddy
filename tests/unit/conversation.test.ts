import { describe, expect, it } from 'vitest';
import type { WhaleEvent } from '../../src/shared/types';
import {
  emptyConversationState,
  hydrateHistory,
  itemsForThread,
  latestTurnWithDetails,
  reduceConversation,
} from '../../src/renderer/state/conversation';

function notification(sequence: number, method: string, params: unknown): WhaleEvent {
  return { kind: 'notification', generation: 1, sequence, message: { method, params } };
}

describe('conversation reducer', () => {
  it('publishes every tool card on item/started, including Bash commands', () => {
    let state = emptyConversationState();
    state = reduceConversation(
      state,
      notification(1, 'turn/started', {
        threadId: 'thread-1',
        turn: { id: 'turn-1', status: 'inProgress', items: [] },
      }),
    );
    const tools = [
      { id: 'bash-1', type: 'commandExecution', command: ['/bin/zsh', '-lc', 'pwd'] },
      { id: 'mcp-1', type: 'mcpToolCall', server: 'fixture', tool: 'search' },
      { id: 'web-1', type: 'webSearch', query: 'Whale Buddy' },
      { id: 'image-1', type: 'imageGeneration' },
    ];
    tools.forEach((item, index) => {
      state = reduceConversation(
        state,
        notification(index + 2, 'item/started', {
          threadId: 'thread-1',
          turnId: 'turn-1',
          item,
          startedAtMs: 1_000 + index,
        }),
      );
    });

    const visible = itemsForThread(state, 'thread-1');
    expect(visible.map((item) => item.id)).toEqual(['bash-1', 'mcp-1', 'web-1', 'image-1']);
    expect(visible.every((item) => item.status === 'inProgress')).toBe(true);
    expect(visible.every((item) => typeof item.whaleStartedAtMs === 'number')).toBe(true);
  });

  it('appends deltas in order and replaces them with the completed authoritative item', () => {
    let state = emptyConversationState();
    state = reduceConversation(
      state,
      notification(1, 'turn/started', {
        threadId: 'thread-1',
        turn: { id: 'turn-1', status: 'inProgress', items: [] },
      }),
    );
    state = reduceConversation(
      state,
      notification(2, 'item/started', {
        threadId: 'thread-1',
        turnId: 'turn-1',
        item: { id: 'item-1', type: 'agentMessage', text: '' },
        startedAtMs: 1_000,
      }),
    );
    expect(state.threads['thread-1'].turns['turn-1'].items['item-1'].whaleStartedAtMs).toBe(1_000);
    state = reduceConversation(
      state,
      notification(3, 'item/agentMessage/delta', {
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'item-1',
        delta: '你',
      }),
    );
    state = reduceConversation(
      state,
      notification(4, 'item/agentMessage/delta', {
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'item-1',
        delta: '好',
      }),
    );
    expect(state.threads['thread-1'].turns['turn-1'].items['item-1'].text).toBe('你好');

    state = reduceConversation(
      state,
      notification(5, 'item/completed', {
        threadId: 'thread-1',
        turnId: 'turn-1',
        item: { id: 'item-1', type: 'agentMessage', text: '权威最终文本', phase: 'final_answer' },
        completedAtMs: 2_500,
      }),
    );
    expect(state.threads['thread-1'].turns['turn-1'].items['item-1'].text).toBe('权威最终文本');
    expect(state.threads['thread-1'].turns['turn-1'].items['item-1'].whaleStartedAtMs).toBe(1_000);
    expect(state.threads['thread-1'].turns['turn-1'].items['item-1'].whaleCompletedAtMs).toBe(2_500);
  });

  it('updates completion status without rebuilding items and deduplicates event sequence', () => {
    let state = hydrateHistory(emptyConversationState(), 'thread-1', {
      turns: [{ id: 'turn-1', status: 'inProgress', items: [], itemsView: 'summary' }],
      items: [{ turnId: 'turn-1', item: { id: 'item-1', type: 'agentMessage', text: '保留' } }],
      plans: [],
      changes: [],
      turnsNextCursor: null,
      itemsNextCursor: null,
    });
    const completed = notification(8, 'turn/completed', {
      threadId: 'thread-1',
      turn: { id: 'turn-1', status: 'completed', items: [] },
    });
    state = reduceConversation(state, completed);
    state = reduceConversation(state, completed);
    const turn = state.threads['thread-1'].turns['turn-1'];
    expect(turn.status).toBe('completed');
    expect(turn.itemOrder).toEqual(['item-1']);
    expect(turn.items['item-1'].text).toBe('保留');
  });

  it('uses the authoritative item history order instead of lossy turn summaries', () => {
    const state = hydrateHistory(emptyConversationState(), 'thread-1', {
      turns: [{
        id: 'turn-1',
        status: 'completed',
        itemsView: 'summary',
        items: [
          { id: 'user-1', type: 'userMessage', content: [{ type: 'text', text: 'hello' }] },
          { id: 'answer-1', type: 'agentMessage', text: '你好' },
        ],
      }],
      items: [
        {
          turnId: 'turn-1',
          item: { id: 'user-1', type: 'userMessage', content: [{ type: 'text', text: 'hello' }] },
        },
        {
          turnId: 'turn-1',
          item: { id: 'reasoning-1', type: 'reasoning', summary: ['先理解问题'], content: [] },
        },
        { turnId: 'turn-1', item: { id: 'answer-1', type: 'agentMessage', text: '你好' } },
      ],
      plans: [],
      changes: [],
      turnsNextCursor: null,
      itemsNextCursor: null,
    });

    expect(state.threads['thread-1'].turns['turn-1'].itemOrder).toEqual([
      'user-1',
      'reasoning-1',
      'answer-1',
    ]);
  });

  it('renders raw reasoning when no summary is available', () => {
    const state = hydrateHistory(emptyConversationState(), 'thread-1', {
      turns: [{ id: 'turn-1', status: 'completed', itemsView: 'summary', items: [] }],
      items: [
        {
          turnId: 'turn-1',
          item: { id: 'reasoning-1', type: 'reasoning', summary: [], content: ['internal'] },
        },
        { turnId: 'turn-1', item: { id: 'answer-1', type: 'agentMessage', text: '完成' } },
      ],
      plans: [],
      changes: [],
      turnsNextCursor: null,
      itemsNextCursor: null,
    });

    expect(itemsForThread(state, 'thread-1').map((item) => item.id)).toEqual([
      'reasoning-1',
      'answer-1',
    ]);
  });

  it('does not render a reasoning placeholder when summary and content are empty', () => {
    const state = hydrateHistory(emptyConversationState(), 'thread-1', {
      turns: [{ id: 'turn-1', status: 'completed', itemsView: 'summary', items: [] }],
      items: [
        {
          turnId: 'turn-1',
          item: { id: 'reasoning-1', type: 'reasoning', summary: [], content: [] },
        },
        { turnId: 'turn-1', item: { id: 'answer-1', type: 'agentMessage', text: '完成' } },
      ],
      plans: [],
      changes: [],
      turnsNextCursor: null,
      itemsNextCursor: null,
    });

    expect(itemsForThread(state, 'thread-1').map((item) => item.id)).toEqual(['answer-1']);
  });

  it('safely ignores unknown notifications while advancing the event cursor', () => {
    const state = reduceConversation(
      emptyConversationState(),
      notification(4, 'future/protocol/event', { unexpected: true }),
    );
    expect(state.lastSequence).toBe(4);
    expect(state.threads).toEqual({});
  });

  it('keeps indexed reasoning deltas, plan state, and the complete turn diff', () => {
    let state = emptyConversationState();
    state = reduceConversation(
      state,
      notification(1, 'item/reasoning/summaryTextDelta', {
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'reasoning-1',
        summaryIndex: 1,
        delta: '第二段',
      }),
    );
    state = reduceConversation(
      state,
      notification(2, 'turn/plan/updated', {
        threadId: 'thread-1',
        turnId: 'turn-1',
        explanation: '先验证后打包',
        plan: [{ step: '运行测试', status: 'inProgress' }],
      }),
    );
    state = reduceConversation(
      state,
      notification(3, 'turn/diff/updated', {
        threadId: 'thread-1',
        turnId: 'turn-1',
        diff: '@@ -1 +1 @@\n-old\n+new',
      }),
    );

    const turn = state.threads['thread-1'].turns['turn-1'];
    expect(turn.items['reasoning-1'].summary).toEqual(['', '第二段']);
    expect(turn.plan).toEqual([{ step: '运行测试', status: 'inProgress' }]);
    expect(turn.planExplanation).toBe('先验证后打包');
    expect(turn.diff).toContain('+new');
  });

  it('restores a persisted plan when paginated history is hydrated', () => {
    const state = hydrateHistory(emptyConversationState(), 'thread-1', {
      turns: [{ id: 'turn-1', status: 'completed', itemsView: 'summary', items: [] }],
      items: [],
      plans: [{
        turnId: 'turn-1',
        explanation: '先检索再输出',
        plan: [
          { step: '检索资料', status: 'completed' },
          { step: '生成文档', status: 'completed' },
        ],
        updatedAt: 1_000,
      }],
      changes: [],
      turnsNextCursor: null,
      itemsNextCursor: null,
    });

    const turn = state.threads['thread-1'].turns['turn-1'];
    expect(turn.planExplanation).toBe('先检索再输出');
    expect(turn.plan).toEqual([
      { step: '检索资料', status: 'completed' },
      { step: '生成文档', status: 'completed' },
    ]);
  });

  it('restores non-Git file changes with the turn history', () => {
    const state = hydrateHistory(emptyConversationState(), 'thread-1', {
      turns: [{ id: 'turn-1', status: 'completed', itemsView: 'summary', items: [] }],
      items: [],
      plans: [],
      changes: [{
        turnId: 'turn-1',
        cwd: '/workspace',
        files: [{
          path: 'report.docx',
          kind: 'created',
          size: 12_000,
          binary: true,
          createdAt: 1_000,
          modifiedAt: 2_000,
        }],
        diff: '',
        updatedAt: 1_000,
      }],
      turnsNextCursor: null,
      itemsNextCursor: null,
    });

    expect(state.threads['thread-1'].turns['turn-1'].fileChanges).toEqual([
      {
        path: 'report.docx',
        kind: 'created',
        size: 12_000,
        binary: true,
        createdAt: 1_000,
        modifiedAt: 2_000,
      },
    ]);
    expect(latestTurnWithDetails(state, 'thread-1')?.id).toBe('turn-1');
  });

  it('keeps the newest turn with plan or diff available after a later plain turn', () => {
    let state = hydrateHistory(emptyConversationState(), 'thread-1', {
      turns: [
        { id: 'turn-with-plan', status: 'completed', itemsView: 'summary', items: [] },
        { id: 'plain-turn', status: 'completed', itemsView: 'summary', items: [] },
      ],
      items: [],
      plans: [{
        turnId: 'turn-with-plan',
        explanation: null,
        plan: [{ step: '完成任务', status: 'completed' }],
        updatedAt: 1_000,
      }],
      changes: [],
      turnsNextCursor: null,
      itemsNextCursor: null,
    });

    expect(latestTurnWithDetails(state, 'thread-1')?.id).toBe('turn-with-plan');

    state = reduceConversation(state, notification(1, 'turn/diff/updated', {
      threadId: 'thread-1',
      turnId: 'plain-turn',
      diff: '@@ -1 +1 @@\n-old\n+new',
    }));
    expect(latestTurnWithDetails(state, 'thread-1')?.id).toBe('plain-turn');
  });

  it('prepends older history pages in chronological order without duplicating boundary items', () => {
    let state = hydrateHistory(emptyConversationState(), 'thread-1', {
      turns: [
        { id: 'turn-2', status: 'completed', itemsView: 'summary', items: [] },
        { id: 'turn-3', status: 'completed', itemsView: 'summary', items: [] },
      ],
      items: [
        { turnId: 'turn-2', item: { id: 'item-2b', type: 'agentMessage', text: '较新内容' } },
        { turnId: 'turn-3', item: { id: 'item-3', type: 'agentMessage', text: '最新内容' } },
      ],
      plans: [],
      changes: [],
      turnsNextCursor: 'older-turns',
      itemsNextCursor: 'older-items',
    });

    state = hydrateHistory(state, 'thread-1', {
      turns: [
        { id: 'turn-1', status: 'completed', itemsView: 'summary', items: [] },
        { id: 'turn-2', status: 'completed', itemsView: 'summary', items: [] },
      ],
      items: [
        { turnId: 'turn-1', item: { id: 'item-1', type: 'userMessage', content: [] } },
        { turnId: 'turn-2', item: { id: 'item-2a', type: 'userMessage', content: [] } },
        { turnId: 'turn-2', item: { id: 'item-2b', type: 'agentMessage', text: '权威边界内容' } },
      ],
      plans: [],
      changes: [],
      turnsNextCursor: null,
      itemsNextCursor: null,
    }, 'prepend');

    const thread = state.threads['thread-1'];
    expect(thread.turnOrder).toEqual(['turn-1', 'turn-2', 'turn-3']);
    expect(thread.turns['turn-2'].itemOrder).toEqual(['item-2a', 'item-2b']);
    expect(thread.turns['turn-2'].items['item-2b'].text).toBe('权威边界内容');
  });

  it('clones only the thread being hydrated and preserves other cached thread references', () => {
    let state = hydrateHistory(emptyConversationState(), 'thread-a', {
      turns: [{ id: 'turn-a', status: 'completed', itemsView: 'summary', items: [] }],
      items: [], plans: [], changes: [], turnsNextCursor: null, itemsNextCursor: null,
    });
    state = hydrateHistory(state, 'thread-b', {
      turns: [{ id: 'turn-b', status: 'completed', itemsView: 'summary', items: [] }],
      items: [], plans: [], changes: [], turnsNextCursor: null, itemsNextCursor: null,
    });
    const cachedThreadB = state.threads['thread-b'];

    const next = hydrateHistory(state, 'thread-a', {
      turns: [{ id: 'turn-older', status: 'completed', itemsView: 'summary', items: [] }],
      items: [], plans: [], changes: [], turnsNextCursor: null, itemsNextCursor: null,
    }, 'prepend');

    expect(next.threads['thread-b']).toBe(cachedThreadB);
    expect(next.threads['thread-a']).not.toBe(state.threads['thread-a']);
  });
});
