import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowDown, Sparkles } from 'lucide-react';
import { itemsForThread } from '../state/conversation';
import { useAppStore } from '../state/store';
import { ApprovalCard } from './ApprovalCard';
import { ItemCard } from './ItemCard';

const ESTIMATED_ITEM_HEIGHT = 150;

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
  const positioningThreadRef = useRef<string | null>(null);
  const positionedThreadRef = useRef<string | null>(null);
  const [following, setFollowing] = useState(true);
  if (positioningThreadRef.current !== threadId) {
    positioningThreadRef.current = threadId;
    positionedThreadRef.current = null;
    autoScrollingRef.current = true;
  }
  const items = useMemo(() => itemsForThread(conversation, threadId), [conversation, threadId]);
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
    const previousHeight = element.scrollHeight;
    const previousTop = element.scrollTop;
    await loadOlderHistory(threadId);
    window.requestAnimationFrame(() => {
      const current = parentRef.current;
      if (!current) return;
      current.scrollTop = previousTop + Math.max(0, current.scrollHeight - previousHeight);
    });
  }, [hasOlderHistory, history?.loadingOlder, loadOlderHistory, threadId]);

  useEffect(() => {
    setFollowing(true);
  }, [threadId]);

  useLayoutEffect(() => {
    if (following && items.length > 0) {
      autoScrollingRef.current = true;
      virtualizer.scrollToEnd();
      const element = parentRef.current;
      if (element) element.scrollTop = element.scrollHeight;
      let settleFrame = 0;
      const frame = window.requestAnimationFrame(() => {
        const current = parentRef.current;
        if (current) current.scrollTop = current.scrollHeight;
        settleFrame = window.requestAnimationFrame(() => {
          positionedThreadRef.current = threadId;
          autoScrollingRef.current = false;
        });
      });
      return () => {
        window.cancelAnimationFrame(frame);
        if (settleFrame) window.cancelAnimationFrame(settleFrame);
        autoScrollingRef.current = false;
      };
    }
    return undefined;
  }, [contentSignature, following, items.length, virtualizer]);

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
    setFollowing(element.scrollHeight - element.scrollTop - element.clientHeight < 80);
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
        <p>从左侧选择项目并创建线程，{brandName}会在这里展示 Codex 的消息、命令与文件变更。</p>
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
    <div className="conversation-scroll" ref={parentRef} onScroll={onScroll}>
      {history?.loadingOlder && (
        <div className="history-loading-row"><span className="spinner-dot" /> 正在加载更早记录…</div>
      )}
      {items.length === 0 && unmatchedApprovals.length === 0 ? (
        <div className="conversation-empty compact-empty">
          <h2>这个线程还是空的</h2>
          <p>在下方描述你想完成的事情。Codex 的执行活动会实时出现在这里。</p>
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
            setFollowing(true);
            virtualizer.scrollToIndex(items.length - 1, { align: 'end' });
            window.requestAnimationFrame(() => {
              const element = parentRef.current;
              if (element) element.scrollTop = element.scrollHeight;
            });
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
  ].join(':');
}
