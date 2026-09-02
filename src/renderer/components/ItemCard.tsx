import { useEffect, useRef, useState } from 'react';
import * as Collapsible from '@radix-ui/react-collapsible';
import {
  Bot,
  Brain,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  FileCode2,
  Globe2,
  Image,
  ListChecks,
  Paperclip,
  PlugZap,
  Sparkles,
  TerminalSquare,
  User,
  Wrench,
} from 'lucide-react';
import type { ItemView } from '../state/conversation';
import type { PendingApproval } from '../state/store';
import { ApprovalCard } from './ApprovalCard';
import { Markdown } from './Markdown';
import { PluginUiFrame } from '../plugin-ui/PluginUiFrame';
import { usePluginHost } from '../plugin-ui/PluginHostProvider';
import { useAppStore } from '../state/store';
import type {
  PluginMessageContext,
  PluginToolCardContext,
  PluginDescriptor,
  PluginUiContribution,
} from '../../shared/plugin';

interface ItemCardProps {
  item: ItemView;
  turnId?: string | null;
  showAssistantAvatar?: boolean;
  approvals: PendingApproval[];
  onRespondApproval: (approval: PendingApproval, response: unknown) => void;
}

export function ItemCard({
  item,
  turnId = null,
  showAssistantAvatar = true,
  approvals,
  onRespondApproval,
}: ItemCardProps) {
  const { descriptors } = usePluginHost();
  const threadId = useAppStore((state) => state.selectedThreadId);
  const customMessage = customMessageCard(item, descriptors);
  let content: React.ReactNode;
  if (customMessage && threadId) {
    content = (
      <PluginMessageItem
        item={item}
        threadId={threadId}
        turnId={turnId}
        descriptor={customMessage.descriptor}
        contribution={customMessage.contribution}
      />
    );
  } else switch (item.type) {
    case 'userMessage':
      content = <UserMessage item={item} />;
      break;
    case 'agentMessage':
      content = <AgentMessage item={item} showAvatar={showAssistantAvatar} />;
      break;
    case 'reasoning':
      content = <Reasoning item={item} showAvatar={showAssistantAvatar} />;
      break;
    case 'plan':
      content = <PlanItem item={item} />;
      break;
    case 'hookRun':
      content = <HookRunItem item={item} />;
      break;
    case 'commandExecution':
      content = <CommandItem item={item} />;
      break;
    case 'fileChange':
      content = <FileChangeItem item={item} />;
      break;
    case 'mcpToolCall':
    case 'dynamicToolCall':
    case 'collabAgentToolCall':
    case 'sleep':
      content = <ToolItem item={item} />;
      break;
    case 'webSearch':
      content = <WebSearchItem item={item} />;
      break;
    case 'imageGeneration':
    case 'imageView':
      content = <ImageItem item={item} />;
      break;
    case 'enteredReviewMode':
    case 'exitedReviewMode':
      content = <ReviewItem item={item} />;
      break;
    case 'contextCompaction':
      content = (
        <div className="timeline-note">
          <CircleDot size={14} /> 对话上下文已压缩
        </div>
      );
      break;
    default:
      content = <UnknownItem item={item} />;
  }

  return (
    <div className={`item-wrap item-${item.type}`}>
      {content}
      {approvals.map((approval) => (
        <ApprovalCard
          key={`${typeof approval.id}:${String(approval.id)}`}
          approval={approval}
          onRespond={(response) => onRespondApproval(approval, response)}
        />
      ))}
    </div>
  );
}

function HookRunItem({ item }: { item: ItemView }) {
  const status = string(item.status) ?? 'running';
  const entries = Array.isArray(item.entries)
    ? item.entries.flatMap((entry) => {
        const value = record(entry);
        return value && typeof value.text === 'string'
          ? [{ kind: string(value.kind) ?? 'output', text: value.text }]
          : [];
      })
    : [];
  const title = string(item.statusMessage) ?? '插件收尾 Hook';
  return (
    <Collapsible.Root className={`tool-card hook-run-card status-${status}`}>
      <Collapsible.Trigger className="tool-card-trigger" disabled={entries.length === 0}>
        <span className="tool-icon violet"><PlugZap size={14} /></span>
        <span className="tool-title-grow">
          <strong>{title}</strong>
          <small>{hookRunDescription(status, entries.length)}</small>
        </span>
        <ToolElapsed item={item} status={status} />
        {entries.length > 0 && <ChevronDown className="collapsible-chevron" size={14} />}
      </Collapsible.Trigger>
      {entries.length > 0 && (
        <Collapsible.Content className="tool-card-content hook-run-output">
          {entries.map((entry, index) => (
            <div className={`hook-output-${entry.kind}`} key={`${entry.kind}:${index}`}>
              <small>{entry.kind}</small>
              <pre>{entry.text}</pre>
            </div>
          ))}
        </Collapsible.Content>
      )}
    </Collapsible.Root>
  );
}

function hookRunDescription(status: string, entryCount: number): string {
  if (status === 'running') return '正在执行回合结束命令';
  if (status === 'blocked') return `Hook 阻止结束${entryCount ? ` · ${entryCount} 条信息` : ''}`;
  if (status === 'failed') return `命令执行失败${entryCount ? ` · ${entryCount} 条信息` : ''}`;
  if (status === 'stopped') return '命令已停止';
  return `回合结束命令已完成${entryCount ? ` · ${entryCount} 条信息` : ''}`;
}

function PluginMessageItem({
  item,
  threadId,
  turnId,
  descriptor,
  contribution,
}: {
  item: ItemView;
  threadId: string;
  turnId: string | null;
  descriptor: PluginDescriptor;
  contribution: Extract<PluginUiContribution, { type: 'card' }>;
}) {
  const status = string(item.status) ?? 'completed';
  return (
    <article className="tool-card plugin-message-card">
      <header className="plugin-message-card-heading">
        <span className="tool-icon teal"><PlugZap size={15} /></span>
        <span className="tool-title-grow">
          <strong>{contribution.title}</strong>
          <small>{descriptor.displayName}</small>
        </span>
        <ToolElapsed item={item} status={status} />
      </header>
      <div className="plugin-message-card-content">
        <PluginUiFrame
          descriptor={descriptor}
          contribution={contribution}
          threadId={threadId}
          turnId={turnId}
          message={pluginMessageContext(item, status)}
          {...(item.type === 'mcpToolCall' ? { toolCall: pluginToolContext(item, status) } : {})}
          className="plugin-message-frame"
          fallback={<p className="plugin-ui-fallback">插件消息卡片不可用，原始消息仍保留在会话记录中。</p>}
        />
      </div>
    </article>
  );
}

function UserMessage({ item }: { item: ItemView }) {
  const content = Array.isArray(item.content) ? item.content : [];
  const rawText = content
    .map((entry) => (record(entry)?.type === 'text' ? string(record(entry)?.text) : null))
    .filter(Boolean)
    .join('\n');
  const text = rawText
    .replace(/\n?<whale_file_attachments>\n[\s\S]*?\n<\/whale_file_attachments>\n?/g, '')
    .replace(/\n?<whale_explicit_tools>\n[\s\S]*?\n<\/whale_explicit_tools>\n?/g, '')
    .replace(/\n?<whale_plugin_context>\n[\s\S]*?\n<\/whale_plugin_context>\n?/g, '')
    .trim();
  const attachments = content.filter((entry) => record(entry)?.type !== 'text');
  return (
    <article className="message user-message">
      <div className="message-avatar user-avatar">
        <User size={14} />
      </div>
      <div className="message-content">
        {text && <p className="preserve-lines">{text}</p>}
        {attachments.length > 0 && (
          <div className="attachment-row">
            {attachments.map((entry, index) => {
              const value = record(entry);
              const isImage = value?.type === 'image' || value?.type === 'localImage';
              const isSkill = value?.type === 'skill';
              const isMcp = value?.type === 'mention' && string(value?.path)?.startsWith('mcp://');
              return (
                <span className="attachment-chip" key={index}>
                  {isImage
                    ? <Image size={13} />
                    : isSkill
                      ? <Sparkles size={13} />
                      : isMcp
                        ? <Wrench size={13} />
                        : <Paperclip size={13} />}
                  {' '}{string(value?.name) ?? string(value?.path) ?? '附件'}
                </span>
              );
            })}
          </div>
        )}
      </div>
    </article>
  );
}

function AgentMessage({ item, showAvatar }: { item: ItemView; showAvatar: boolean }) {
  return (
    <article className="message agent-message">
      <AssistantIdentity show={showAvatar} />
      <div className="message-content markdown-body">
        <Markdown>{string(item.text) ?? ''}</Markdown>
      </div>
    </article>
  );
}

function Reasoning({ item, showAvatar }: { item: ItemView; showAvatar: boolean }) {
  const summary = textArray(item.summary).join('\n\n');
  const raw = textArray(item.content).join('\n\n');
  return (
    <article className="message agent-message reasoning-message">
      <AssistantIdentity show={showAvatar} />
      <Collapsible.Root className="tool-card reasoning-card">
        <Collapsible.Trigger className="tool-card-trigger">
          <span className="tool-icon violet">
            <Brain size={15} />
          </span>
          <span>
            <strong>思考过程</strong>
            <small>{truncate(summary || raw, 90)}</small>
          </span>
          <ChevronDown className="collapsible-chevron" size={15} />
        </Collapsible.Trigger>
        <Collapsible.Content className="tool-card-content reasoning-content">
          {summary && <Markdown>{summary}</Markdown>}
          {raw && summary && (
            <details>
              <summary>原始推理文本</summary>
              <p className="preserve-lines">{raw}</p>
            </details>
          )}
          {raw && !summary && <p className="preserve-lines">{raw}</p>}
        </Collapsible.Content>
      </Collapsible.Root>
    </article>
  );
}

function AssistantIdentity({ show }: { show: boolean }) {
  return show ? (
    <div className="message-avatar agent-avatar" aria-label="Whale 助手">
      <Bot size={14} />
    </div>
  ) : <span className="message-avatar-spacer" aria-hidden="true" />;
}

function PlanItem({ item }: { item: ItemView }) {
  return (
    <article className="tool-card plan-card">
      <div className="tool-card-heading">
        <span className="tool-icon blue">
          <ListChecks size={15} />
        </span>
        <strong>执行计划</strong>
      </div>
      <div className="tool-card-content markdown-body">
        <Markdown>{string(item.text) ?? ''}</Markdown>
      </div>
    </article>
  );
}

function CommandItem({ item }: { item: ItemView }) {
  const status = string(item.status) ?? 'inProgress';
  return (
    <ToolActivityCard
      item={item}
      icon={<TerminalSquare size={15} />}
      iconTone="charcoal"
      title="命令执行"
      status={status}
    />
  );
}

function FileChangeItem({ item }: { item: ItemView }) {
  const changes = Array.isArray(item.changes) ? item.changes : [];
  return (
    <Collapsible.Root className="tool-card file-card" defaultOpen>
      <Collapsible.Trigger className="tool-card-trigger">
        <span className="tool-icon green">
          <FileCode2 size={15} />
        </span>
        <span className="tool-title-grow">
          <strong>文件变更</strong>
          <small>{changes.length ? `${changes.length} 个文件` : '正在准备变更'}</small>
        </span>
        <ToolElapsed item={item} status={string(item.status) ?? 'inProgress'} />
        <ChevronDown className="collapsible-chevron" size={15} />
      </Collapsible.Trigger>
      <Collapsible.Content className="tool-card-content file-change-list">
        {changes.map((rawChange, index) => {
          const change = record(rawChange);
          const diff = string(change?.diff) ?? '';
          return (
            <div className="file-change" key={`${string(change?.path) ?? 'file'}-${index}`}>
              <div className="file-change-header">
                <code>{string(change?.path) ?? '未知路径'}</code>
                <span>{formatKind(change?.kind)}</span>
              </div>
              {diff && <MiniDiff diff={diff} />}
            </div>
          );
        })}
        {string(item.output) && <pre className="terminal-output">{string(item.output)}</pre>}
      </Collapsible.Content>
    </Collapsible.Root>
  );
}

function ToolItem({ item }: { item: ItemView }) {
  const status = string(item.status) ?? 'inProgress';
  const label =
    item.type === 'mcpToolCall'
      ? `${string(item.server) ?? 'MCP'} · ${string(item.tool) ?? 'tool'}`
      : item.type === 'collabAgentToolCall'
        ? `协作代理 · ${string(item.tool) ?? 'call'}`
        : item.type === 'sleep'
          ? '等待'
          : `${string(item.namespace) ?? '工具'} · ${string(item.tool) ?? 'call'}`;
  const running = isRunningStatus(status);
  const [open, setOpen] = useState(running);
  const wasRunning = useRef(running);
  useEffect(() => {
    if (running && !wasRunning.current) setOpen(true);
    if (!running && wasRunning.current) setOpen(false);
    wasRunning.current = running;
  }, [running]);
  return (
    <ToolActivityCard
      item={item}
      icon={item.type === 'mcpToolCall' ? <PlugZap size={15} /> : <Wrench size={15} />}
      iconTone="amber"
      title={label}
      status={status}
    />
  );
}

function WebSearchItem({ item }: { item: ItemView }) {
  const status = string(item.status) ?? 'completed';
  return <ToolActivityCard item={item} icon={<Globe2 size={15} />} iconTone="blue" title="网页搜索" status={status} />;
}

function ImageItem({ item }: { item: ItemView }) {
  const status = string(item.status) ?? 'completed';
  return (
    <article className="tool-card compact-tool-card tool-activity-card">
      <span className="tool-icon violet">
        <Image size={15} />
      </span>
      <span>
        <strong>{item.type === 'imageView' ? '查看图片' : '生成图片'}</strong>
        <small>{string(item.path) ?? string(item.savedPath) ?? string(item.status) ?? '图片结果'}</small>
      </span>
      <ToolElapsed item={item} status={status} />
    </article>
  );
}

function ReviewItem({ item }: { item: ItemView }) {
  return (
    <article className="tool-card review-card">
      <div className="tool-card-heading">
        <span className="tool-icon blue">
          <CheckCircle2 size={15} />
        </span>
        <strong>{item.type === 'enteredReviewMode' ? '开始代码审查' : '代码审查结果'}</strong>
      </div>
      <div className="tool-card-content markdown-body">
        <Markdown>{string(item.review) ?? ''}</Markdown>
      </div>
    </article>
  );
}

function UnknownItem({ item }: { item: ItemView }) {
  const status = string(item.status) ?? 'completed';
  return <ToolActivityCard item={item} icon={<Wrench size={15} />} iconTone="muted" title="工具活动" status={status} />;
}

function ToolActivityCard({
  item,
  icon,
  iconTone,
  title,
  status,
}: {
  item: ItemView;
  icon: React.ReactNode;
  iconTone: string;
  title: string;
  status: string;
}) {
  return (
    <article className="tool-card compact-tool-card tool-activity-card">
      <span className={`tool-icon ${iconTone}`}>{icon}</span>
      <span>
        <strong>{title}</strong>
      </span>
      <ToolElapsed item={item} status={status} />
    </article>
  );
}

function customMessageCard(item: ItemView, descriptors: PluginDescriptor[]) {
  const pluginId = string(item.pluginId);
  const toolName = string(item.tool);
  const matchingDescriptors = pluginId
    ? descriptors.filter((descriptor) => descriptor.pluginId === pluginId)
    : item.type === 'dynamicToolCall' && toolName
      ? descriptors.filter((descriptor) => descriptor.webMcp?.tools.some((tool) => tool.name === toolName))
      : [];
  return matchingDescriptors.flatMap((descriptor) =>
    descriptor.uiContributions
      .filter((contribution) => contribution.type === 'card')
      .map((contribution) => ({ descriptor, contribution })))
    .filter(({ contribution }) => contribution.itemTypes.includes(
      item.type as typeof contribution.itemTypes[number],
    ))
    .filter(({ contribution }) => contribution.server === null || (
      contribution.server === string(item.server)
      && contribution.tools.includes(string(item.tool) ?? '')
    ))
    .sort((left, right) => left.contribution.order - right.contribution.order)[0] ?? null;
}

function pluginMessageContext(item: ItemView, status: string): PluginMessageContext {
  return {
    itemId: item.id,
    itemType: item.type as PluginMessageContext['itemType'],
    status,
    data: toJson(item) ?? {},
  };
}

function pluginToolContext(item: ItemView, status: string): PluginToolCardContext {
  return {
    itemId: item.id,
    server: string(item.server) ?? '',
    tool: string(item.tool) ?? '',
    status,
    arguments: toJson(item.arguments),
    result: toJson(item.result),
    error: toJson(item.error),
    readOnlyHint: typeof item.readOnlyHint === 'boolean' ? item.readOnlyHint : null,
  };
}

function ToolElapsed({ item, status }: { item: ItemView; status: string }) {
  const protocolRunning = isRunningStatus(status);
  const [now, setNow] = useState(() => Date.now());
  const startedAt = typeof item.whaleStartedAtMs === 'number' ? item.whaleStartedAtMs : null;
  const completedAt = typeof item.whaleCompletedAtMs === 'number' ? item.whaleCompletedAtMs : null;
  const runningVisibleUntil = !protocolRunning && startedAt !== null && completedAt !== null
    ? startedAt + MINIMUM_RUNNING_CARD_MS
    : null;
  const running = protocolRunning || (runningVisibleUntil !== null && now < runningVisibleUntil);
  useEffect(() => {
    if (!protocolRunning) return;
    const timer = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(timer);
  }, [protocolRunning]);
  useEffect(() => {
    if (runningVisibleUntil === null) return;
    const remaining = runningVisibleUntil - Date.now();
    if (remaining <= 0) return;
    const timer = window.setTimeout(() => setNow(Date.now()), remaining);
    return () => window.clearTimeout(timer);
  }, [runningVisibleUntil]);
  const explicitDuration = typeof item.durationMs === 'number' ? item.durationMs : null;
  const duration = explicitDuration ?? (
    startedAt === null ? null : Math.max(0, (protocolRunning ? now : completedAt ?? now) - startedAt)
  );
  const durationLabel = duration === null
    ? running ? '计时中' : '耗时未记录'
    : formatDuration(duration);
  return (
    <span className={`status-badge status-${running ? 'inprogress' : status.toLocaleLowerCase()}`}>
      {running && <span className="spinner-dot" />}
      {running ? '等待中' : statusLabel(status)}
      {` · ${durationLabel}`}
    </span>
  );
}

const MINIMUM_RUNNING_CARD_MS = 300;

function isRunningStatus(status: string): boolean {
  return ['inprogress', 'running', 'pending'].includes(status.toLocaleLowerCase());
}

function MiniDiff({ diff }: { diff: string }) {
  return (
    <pre className="mini-diff">
      {diff.split('\n').map((line, index) => (
        <span
          className={line.startsWith('+') ? 'line-add' : line.startsWith('-') ? 'line-delete' : ''}
          key={index}
        >
          {line || ' '}
          {'\n'}
        </span>
      ))}
    </pre>
  );
}

function formatKind(kind: unknown): string {
  if (typeof kind === 'string') return kind;
  const value = record(kind);
  return value ? Object.keys(value)[0] ?? '修改' : '修改';
}

function statusLabel(status: string): string {
  switch (status.toLocaleLowerCase()) {
    case 'inprogress':
    case 'running':
    case 'pending':
      return '等待中';
    case 'completed':
    case 'success':
      return '完成';
    case 'failed':
      return '失败';
    case 'blocked':
      return '已阻止';
    case 'stopped':
      return '已停止';
    case 'declined':
      return '已拒绝';
    case 'interrupted':
      return '已中断';
    default:
      return status;
  }
}

function formatDuration(ms: number): string {
  return ms < 1_000 ? `${ms} ms` : `${(ms / 1_000).toFixed(1)} s`;
}

function textArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function truncate(value: string, length: number): string {
  return value.length > length ? `${value.slice(0, length)}…` : value;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function string(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function toJson(value: unknown): PluginToolCardContext['result'] {
  if (value === undefined) return null;
  try {
    return JSON.parse(JSON.stringify(value)) as PluginToolCardContext['result'];
  } catch {
    return null;
  }
}
