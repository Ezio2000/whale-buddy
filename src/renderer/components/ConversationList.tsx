import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowDown, Sparkles } from 'lucide-react';
import { itemsForThread } from '../state/conversation';
import { useAppStore } from '../state/store';
import { ApprovalCard } from './ApprovalCard';
import { ItemCard } from './ItemCard';

const ESTIMATED_ITEM_HEIGHT = 180;

export function ConversationList() {
  const conversation = useAppStore((state) => state.conversation);
  const threadId = useAppStore((state) => state.selectedThreadId);
  const approvals = useAppStore((state) => state.approvals);
  const respondApproval = useAppStore((state) => state.respondApproval);
  const busy = useAppStore((state) => state.busy);
  const history = useAppStore((state) => threadId ? state.historyByThread[threadId] : undefined);
  const loadOlderHistory = useAppStore((state) => state.loadOlderHistory);
  const brandName = useAppStore((state) => state.branding.name);
  const parentRef = useRef<HTMLDivElement>(null);
  const autoScrollingRef = useRef(false);
  const followingRef = useRef(true);
  const followFrameRef = useRef<number | null>(null);
  const lastScrollTopRef = useRef(0);
  const userScrollDirectionRef = useRef(0);
  const touchYRef = useRef<number | null>(null);
  const positioningThreadRef = useRef<string | null>(null);
  const positionedThreadRef = useRef<string | null>(null);
  const [following, setFollowing] = useState(true);
  if (positioningThreadRef.current !== threadId) {
    positioningThreadRef.current = threadId;
    positionedThreadRef.current = null;
    autoScrollingRef.current = true;
    followingRef.current = true;
    userScrollDirectionRef.current = 0;
  }
  const items = useMemo(() => itemsForThread(conversation, threadId), [conversation, threadId]);
  const itemTurnIds = useMemo(() => {
    const thread = threadId ? conversation.threads[threadId] : null;
    if (!thread) return new Map<string, string>();
    return new Map(thread.turnOrder.flatMap((turnIdValue) =>
      (thread.turns[turnIdValue]?.itemOrder ?? []).map((itemId) => [itemId, turnIdValue] as const)));
  }, [conversation, threadId]);
  const visibleApprovals = approvals.filter(
    (approval) => !approval.threadId || approval.threadId === threadId,
  );
  const itemIds = new Set(items.map((item) => item.id));
  const unmatchedApprovals = visibleApprovals.filter(
    (approval) => !approval.itemId || !itemIds.has(approval.itemId),
  );

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ESTIMATED_ITEM_HEIGHT,
    // History is read newest-first but displayed chronologically. Starting at
    // the estimated end prevents the first paint from rendering old rows and
    // then visibly walking through the list before reaching the latest item.
    initialOffset: () => items.length * ESTIMATED_ITEM_HEIGHT,
    overscan: 7,
    // Preserve the visible item key on prepend, rather than adding the entire
    // scrollHeight delta (which also includes concurrently streamed content).
    anchorTo: 'end',
    followOnAppend: false,
    // Only our follow state owns bottom alignment, including after resizing.
    scrollEndThreshold: -1,
    getItemKey: (index) => items[index]?.id ?? index,
  });

  const contentSignature = [
    ...items.map(itemSignature),
    ...visibleApprovals.map((approval) => `approval:${typeof approval.id}:${String(approval.id)}`),
  ].join('|');
  const hasOlderHistory = Boolean(
    history?.loaded
    && (history.turnsCursor !== null || history.itemsCursor !== null),
  );

  const loadOlderPreservingPosition = useCallback(async () => {
    const element = parentRef.current;
    if (!element || !threadId || !hasOlderHistory || history?.loadingOlder) return;
    await loadOlderHistory(threadId);
  }, [hasOlderHistory, history?.loadingOlder, loadOlderHistory, threadId]);

  useEffect(() => {
    setFollowing(true);
  }, [threadId]);

  const stopFollowing = () => {
    positionedThreadRef.current = threadId;
    followingRef.current = false;
    autoScrollingRef.current = false;
    if (followFrameRef.current !== null) {
      window.cancelAnimationFrame(followFrameRef.current);
      followFrameRef.current = null;
    }
    setFollowing(false);
  };

  const noteScrollIntent = (direction: number) => {
    userScrollDirectionRef.current = Math.sign(direction);
    if (direction < 0) stopFollowing();
  };

  const totalSize = virtualizer.getTotalSize();
  useLayoutEffect(() => {
    if (!followingRef.current || !following || items.length === 0) return;
    autoScrollingRef.current = true;
    const positionAtEnd = () => {
      const element = parentRef.current;
      if (!element || !followingRef.current) return;
      element.scrollTop = element.scrollHeight;
      lastScrollTopRef.current = element.scrollTop;
    };
    // A single owner for bottom positioning. Virtualizer scrollToEnd also
    // reconciles over subsequent frames and can fight an intervening wheel.
    positionAtEnd();
    followFrameRef.current = window.requestAnimationFrame(() => {
      followFrameRef.current = null;
      positionAtEnd();
      positionedThreadRef.current = threadId;
      autoScrollingRef.current = false;
    });
    return () => {
      if (followFrameRef.current !== null) window.cancelAnimationFrame(followFrameRef.current);
      followFrameRef.current = null;
      autoScrollingRef.current = false;
    };
  }, [contentSignature, following, items.length, threadId, totalSize]);

  useEffect(() => {
    const element = parentRef.current;
    if (!element || !hasOlderHistory || history?.loadingOlder) return;
    if (element.scrollHeight <= element.clientHeight + 1) void loadOlderPreservingPosition();
  }, [contentSignature, hasOlderHistory, history?.loadingOlder, loadOlderPreservingPosition]);

  const onScroll = () => {
    const element = parentRef.current;
    if (!element) return;
    // Initial positioning and follow-to-latest are programmatic. Treating
    // their intermediate offsets as user input cancels the bottom anchor and
    // leaves a long conversation visibly stranded halfway through history.
    if (autoScrollingRef.current) return;
    const previousTop = lastScrollTopRef.current;
    lastScrollTopRef.current = element.scrollTop;
    // ResizeObserver, virtualizer anchoring and browser clamping also emit
    // scroll events. They must never change the user's follow preference.
    if (userScrollDirectionRef.current > 0 && element.scrollTop > previousTop
      && element.scrollHeight - element.scrollTop - element.clientHeight <= 2) {
      followingRef.current = true;
      setFollowing(true);
    }
    userScrollDirectionRef.current = 0;
    if (
      positionedThreadRef.current === threadId
      && element.scrollTop < 100
    ) {
      void loadOlderPreservingPosition();
    }
  };

  if (!threadId) {
    return (
      <div className="conversation-empty">
        <div className="empty-orbit">
          <Sparkles size={24} />
        </div>
        <h2>准备开始一段新工作</h2>
        <p>从左侧选择项目并创建线程，{brandName}会在这里展示执行消息、命令与文件变更。</p>
      </div>
    );
  }

  if (busy && items.length === 0) {
    return (
      <div className="conversation-empty">
        <span className="large-spinner" />
        <p>正在恢复线程历史…</p>
      </div>
    );
  }

  return (
    <div className="conversation-scroll" ref={parentRef} onScroll={onScroll}
      tabIndex={0} aria-label="对话记录"
      onWheel={(event) => {
        if (!event.ctrlKey) noteScrollIntent(event.deltaY);
      }}
      onKeyDown={(event) => {
        if (event.target instanceof HTMLElement && event.target.closest('input,textarea,select,[contenteditable="true"]')) return;
        if (['ArrowUp', 'PageUp', 'Home'].includes(event.key) || (event.key === ' ' && event.shiftKey)) noteScrollIntent(-1);
        if (['ArrowDown', 'PageDown', 'End'].includes(event.key) || (event.key === ' ' && !event.shiftKey)) noteScrollIntent(1);
      }}
      onPointerDown={(event) => {
        const element = parentRef.current;
        if (element && event.target === element && event.clientX >= element.getBoundingClientRect().right - 18) {
          stopFollowing();
          // Scrollbar dragging can move in either direction; reaching the
          // actual bottom is the user's explicit choice to resume following.
          userScrollDirectionRef.current = 1;
        }
      }}
      onTouchStart={(event) => { touchYRef.current = event.touches[0]?.clientY ?? null; }}
      onTouchMove={(event) => {
        const y = event.touches[0]?.clientY;
        if (y !== undefined && touchYRef.current !== null) noteScrollIntent(touchYRef.current - y);
        touchYRef.current = y ?? null;
      }}
    >
      {history?.loadingOlder && (
        <div className="history-loading-row"><span className="spinner-dot" /> 正在加载更早记录…</div>
      )}
      {items.length === 0 && unmatchedApprovals.length === 0 ? (
        <div className="conversation-empty compact-empty">
          <h2>这个线程还是空的</h2>
          <p>在下方描述你想完成的事情。{brandName} 的执行活动会实时出现在这里。</p>
        </div>
      ) : (
        <div
          className="virtual-list"
          style={{ height: virtualizer.getTotalSize() }}
          aria-live="polite"
        >
          {virtualizer.getVirtualItems().map((virtualItem) => {
            const item = items[virtualItem.index];
            const groupedWithPreviousAssistant =
              isAssistantContent(item) && isAssistantContent(items[virtualItem.index - 1]);
            const itemApprovals = visibleApprovals.filter(
              (approval) => approval.itemId === item.id,
            );
            return (
              <div
                className={`virtual-row ${groupedWithPreviousAssistant ? 'assistant-continuation-row' : ''}`}
                data-index={virtualItem.index}
                key={virtualItem.key}
                ref={virtualizer.measureElement}
                style={{ transform: `translateY(${virtualItem.start}px)` }}
              >
                <ItemCard
                  item={item}
                  turnId={itemTurnIds.get(item.id) ?? null}
                  showAssistantAvatar={!groupedWithPreviousAssistant}
                  approvals={itemApprovals}
                  onRespondApproval={(approval, response) =>
                    void respondApproval(approval, response)
                  }
                />
              </div>
            );
          })}
        </div>
      )}
      {unmatchedApprovals.length > 0 && (
        <div className="unmatched-approvals">
          {unmatchedApprovals.map((approval) => (
            <ApprovalCard
              key={`${typeof approval.id}:${String(approval.id)}`}
              approval={approval}
              onRespond={(response) => void respondApproval(approval, response)}
            />
          ))}
        </div>
      )}
      {!following && items.length > 0 && (
        <button
          className="jump-to-latest"
          onClick={() => {
            followingRef.current = true;
            userScrollDirectionRef.current = 0;
            setFollowing(true);
          }}
        >
          <ArrowDown size={14} /> 最新内容
        </button>
      )}
    </div>
  );
}

function isAssistantContent(item: ReturnType<typeof itemsForThread>[number] | undefined): boolean {
  return item?.type === 'agentMessage' || item?.type === 'reasoning';
}

function itemSignature(item: ReturnType<typeof itemsForThread>[number]): string {
  const summaryLength = Array.isArray(item.summary)
    ? item.summary.reduce((total, entry) => total + (typeof entry === 'string' ? entry.length : 0), 0)
    : 0;
  const contentLength = Array.isArray(item.content)
    ? item.content.reduce((total, entry) => total + (typeof entry === 'string' ? entry.length : 0), 0)
    : 0;
  const changesLength = Array.isArray(item.changes) ? item.changes.length : 0;
  return [
    item.id,
    String(item.status ?? ''),
    String(item.text ?? '').length,
    String(item.aggregatedOutput ?? '').length,
    String(item.output ?? '').length,
    summaryLength,
    contentLength,
    changesLength,
    Array.isArray(item.entries) ? item.entries.length : 0,
    String(item.durationMs ?? ''),
  ].join(':');
}
