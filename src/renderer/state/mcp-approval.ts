import type { ItemView } from './conversation';

const labels: Record<string, string> = {
  gac_kb_search: '检索知识库', gac_kb_search_scoped: '检索所选知识库', gac_kb_list_datasets: '列出知识库',
  outlook_mail_action_cancel: '取消邮件预览', outlook_mail_search: '搜索邮件', outlook_mail_get: '读取邮件',
  outlook_mail_send: '发送邮件', outlook_mail_send_preview: '预览新邮件', outlook_mail_reply_preview: '预览邮件回复',
  outlook_calendar_search: '查询日历', outlook_directory_search: '查询企业通讯录', outlook_contact_search: '查询个人联系人',
};

export function mcpApprovalDetails(params: Record<string, unknown>, items: ItemView[]) {
  const candidates = items.filter((item) => item.type === 'mcpToolCall'
    && item.server === params.serverName && ['inProgress', 'running', 'pending'].includes(String(item.status))
    && (!params.itemId || item.id === params.itemId));
  // Elicitation may be server-initiated. Never borrow parameters from an
  // unrelated or ambiguous tool call just to fill the approval card.
  const item = candidates.length === 1 ? candidates[0] : null;
  const tool = item && typeof item.tool === 'string' ? item.tool : '';
  const args = item?.arguments;
  return {
    title: labels[tool] ?? 'MCP 服务请求确认',
    tool,
    arguments: args == null ? null : redact(args),
    readOnly: item?.readOnlyHint === true || /^(gac_kb_(search|search_scoped|list_datasets)|outlook_(calendar_search|directory_search|contact_search|mail_search|mail_get))$/.test(tool),
  };
}
function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) =>
    [key, /token|password|secret|api.?key|authorization/i.test(key) ? '已隐藏' : redact(entry)]));
  return value;
}
