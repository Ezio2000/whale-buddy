import { outlookEntries, resultRecords } from './result-data';
import type { ReactNode } from 'react';
import {
  usePluginContext,
  type ToolCallContext,
} from '@whale-buddy/plugin-sdk/ui';
import './outlook.css';
import { outlookResultError } from './outlook-result';

interface ResultItem {
  title: string;
  subtitle: string;
  detail: string;
  meta: string[];
}

const capabilities = [
  { icon: 'calendar', title: '日历', description: '按时间、主题、地点或组织者查询日程。' },
  { icon: 'people', title: '通讯录', description: '检索企业目录与个人 Outlook 联系人。' },
  { icon: 'mail', title: '邮件', description: '查找邮件并读取所选邮件的完整内容。' },
  { icon: 'shield', title: '安全发送', description: '先生成不可变预览，再由你明确确认发送。' },
] as const;

export default function OutlookApp() {
  const context = usePluginContext();
  if (!context) return <div className="loading"><span />正在连接 Whale…</div>;
  if (context.surface.kind === 'runtime') return null;
  if (context.surface.contributionType === 'card') return <OutlookCard toolCall={context.toolCall} />;
  return <OutlookHome configured={context.credentials.every((credential) => credential.value)} />;
}

function OutlookHome({ configured }: { configured: boolean }) {
  return (
    <main className="home">
      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow">WHALE AIHUB</span>
          <h1>Outlook 助手</h1>
          <p>把日历、联系人和邮件放进一条安全、可确认的工作流。</p>
        </div>
        <div className={`status ${configured ? 'ready' : ''}`}>
          <span />{configured ? '凭据已配置' : '等待配置 API Key'}
        </div>
      </section>

      <p>日历、个人联系人和邮件需要账号开通 Outlook。邮箱不可用时，仍可使用知识库；各项操作会分别报告结果。</p>
      <section className="capability-grid">
        {capabilities.map((item) => (
          <article key={item.title}>
            <div className={`glyph ${item.icon}`}><CapabilityIcon kind={item.icon} /></div>
            <strong>{item.title}</strong>
            <p>{item.description}</p>
          </article>
        ))}
      </section>

      <section className="safety">
        <div>
          <span className="eyebrow">SEND SAFELY</span>
          <h2>发送前始终由你确认</h2>
          <p>收件人、主题或正文发生任何变化，都必须重新生成预览。</p>
        </div>
        <ol>
          <li><span>1</span>生成预览</li>
          <li><span>2</span>核对内容</li>
          <li><span>3</span>明确确认</li>
        </ol>
      </section>

      <section className="prompts">
        <span>你可以这样开始</span>
        <div>
          <p>“看看我明天上午有哪些会议”</p>
          <p>“查找张三的企业邮箱”</p>
          <p>“搜索本周关于项目周报的邮件”</p>
        </div>
      </section>
    </main>
  );
}

export function OutlookCard({ toolCall }: { toolCall?: ToolCallContext }) {
  if (!toolCall || ['inProgress', 'running', 'pending'].includes(toolCall.status)) {
    return <div className="card-loading"><span />正在读取 Outlook…</div>;
  }
  const error = toolCall.error ? textFrom(toolCall.error) : outlookResultError(toolCall.result);
  if (error) {
    return <div className="card-error"><strong>Outlook 调用失败</strong><p>{error}</p>{/邮箱|mailbox/i.test(error) && <p>请检查当前账号是否已开通对应邮箱能力。知识库不受此错误影响。</p>}</div>;
  }

  const tone = toolTone(toolCall.tool);
  const items = extractItems(toolCall.result, toolCall.tool);
  const preview = toolCall.tool.endsWith('_preview');
  const sent = toolCall.tool === 'outlook_mail_send';
  const cancelled = toolCall.tool === 'outlook_mail_action_cancel';
  return (
    <article className={`tool-card ${tone}`}>
      <header>
        <div className="tool-icon"><CapabilityIcon kind={tone} /></div>
        <div><span>{toolLabel(toolCall.tool)}</span><strong>{cardTitle(toolCall.tool, items.length)}</strong></div>
        <span className={`result-state ${preview ? 'attention' : sent ? 'success' : ''}`}>
          {preview ? '等待确认' : sent ? '已发送' : cancelled ? '已取消' : '已完成'}
        </span>
      </header>
      {preview && <div className="preview-note">请核对收件人、主题和正文；只有明确确认后才会发送。</div>}
      <div className="result-list">
        {items.slice(0, 8).map((item, index) => (
          <section key={`${item.title}:${index}`}>
            <div className="result-heading"><strong>{item.title || `结果 ${index + 1}`}</strong>{item.subtitle && <span>{item.subtitle}</span>}</div>
            {item.detail && <p>{item.detail}</p>}
            {item.meta.length > 0 && <div className="meta">{item.meta.map((value) => <span key={value}>{value}</span>)}</div>}
          </section>
        ))}
      </div>
      {items.length === 0 && <p>操作已完成，没有匹配结果。</p>}
      {resultRecords(toolCall.result).map((result, index) => typeof result.matched_count === 'number' ? <p key={index}>本次展示 {items.length} 项 · 总匹配 {result.matched_count} 项{result.has_more === true ? ' · 可在对话中继续查询下一页' : ''}</p> : null)}
    </article>
  );
}

function extractItems(value: unknown, tool: string): ResultItem[] {
  const items: ResultItem[] = [];
  for (const entry of outlookEntries(value, tool)) {
    const title = firstString(entry, titleFields(tool));
    const subtitle = firstString(entry, ['email', 'mail', 'address', 'organizer', 'sender', 'from', 'status']);
    const detail = firstString(entry, ['body', 'content', 'body_preview', 'preview', 'snippet', 'description', 'location']);
    const meta = [
      firstString(entry, ['start', 'start_time', 'received_at', 'sent_at', 'date', 'created_at']),
      firstString(entry, ['end', 'end_time']),
      listString(entry.to ?? entry.recipients ?? entry.attendees),
    ].filter((item): item is string => Boolean(item));
    if (!title && !subtitle && !detail && meta.length === 0) continue;
    items.push({ title, subtitle, detail: truncate(detail, 900), meta });
  }
  return items;
}

function titleFields(tool: string): string[] {
  if (tool.includes('directory') || tool.includes('contact')) return ['display_name', 'name', 'title'];
  return ['subject', 'title', 'action', 'message'];
}

function toolTone(tool: string): 'calendar' | 'people' | 'mail' | 'shield' {
  if (tool.includes('calendar')) return 'calendar';
  if (tool.includes('directory') || tool.includes('contact')) return 'people';
  if (tool.includes('preview') || tool.includes('send') || tool.includes('cancel')) return 'shield';
  return 'mail';
}

function toolLabel(tool: string): string {
  if (tool.includes('calendar')) return 'CALENDAR';
  if (tool.includes('directory')) return 'DIRECTORY';
  if (tool.includes('contact')) return 'CONTACTS';
  if (tool.includes('history')) return 'MAIL HISTORY';
  return 'OUTLOOK MAIL';
}

function cardTitle(tool: string, count: number): string {
  const labels: Record<string, string> = {
    outlook_calendar_search: `日历结果 · ${count}`,
    outlook_directory_search: `企业通讯录 · ${count}`,
    outlook_contact_search: `个人联系人 · ${count}`,
    outlook_mail_search: `邮件结果 · ${count}`,
    outlook_mail_get: '邮件详情',
    outlook_mail_send_preview: '邮件发送预览',
    outlook_mail_reply_preview: '邮件回复预览',
    outlook_mail_send: '邮件发送结果',
    outlook_mail_action_cancel: '发送操作已取消',
    outlook_mail_history: `发送历史 · ${count}`,
    outlook_mail_history_get: '发送历史详情',
  };
  return labels[tool] ?? 'Outlook 结果';
}

function CapabilityIcon({ kind }: { kind: string }) {
  const paths: Record<string, ReactNode> = {
    calendar: <><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M8 3v4M16 3v4M3 10h18" /></>,
    people: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>,
    mail: <><rect x="2" y="4" width="20" height="16" rx="3" /><path d="m3 6 9 7 9-7" /></>,
    shield: <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" /><path d="m9 12 2 2 4-4" /></>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[kind] ?? paths.mail}</svg>;
}

function firstString(entry: Record<string, unknown>, fields: string[]): string {
  for (const field of fields) {
    const nested = record(entry[field]);
    const value = string(entry[field]) ?? (nested ? string(nested.content) ?? string(nested.address) ?? string(nested.name) : null);
    if (value) return value;
  }
  return '';
}

function listString(value: unknown): string {
  if (!Array.isArray(value)) return string(value) ?? '';
  return value.map((item) => {
    const entry = record(item);
    return string(item) ?? (entry ? firstString(entry, ['name', 'display_name', 'email', 'address']) : '');
  }).filter(Boolean).join('、');
}

function textFrom(value: unknown): string {
  if (typeof value === 'string') return value;
  const entry = record(value);
  if (entry && typeof entry.text === 'string') return entry.text;
  try { return value == null ? '' : JSON.stringify(value, null, 2); } catch { return ''; }
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function string(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}
