import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { OutlookCard } from '../../marketplaces/aihub/plugins/xiaojing-knowledge-base/ui-src/src/outlook';
import type { ToolCallContext } from '../../packages/plugin-sdk/src/core';
afterEach(cleanup);
it('keeps different message IDs even when all visible fields are identical', () => {
  const result = { ok: true, result_count: 2, messages: [
    { message_id: 'mail-a', subject: '相同验收主题', preview: '相同摘要' },
    { message_id: 'mail-b', subject: '相同验收主题', preview: '相同摘要' },
  ], sources: [{ title: '相同验收主题', snippet: '相同摘要' }] };
  render(<OutlookCard toolCall={{ tool: 'outlook_mail_search', status: 'completed', result: { structuredContent: result, content: [{ type: 'text', text: JSON.stringify(result) }] } } as unknown as ToolCallContext} />);
  expect(screen.getByText('邮件结果 · 2')).toBeVisible();
  expect(screen.getAllByText('相同验收主题')).toHaveLength(2);
});
it('renders single full message content once despite source copies', () => {
  render(<OutlookCard toolCall={{ tool: 'outlook_mail_get', status: 'completed', result: { structuredContent: {
    ok: true, message: { message_id: 'mail-a', subject: '测试', content: '完整虚构正文', preview: '摘要' },
    sources: [{ title: '测试', snippet: '完整虚构正文' }],
  } } } as unknown as ToolCallContext} />);
  expect(screen.getAllByText('完整虚构正文')).toHaveLength(1);
});
