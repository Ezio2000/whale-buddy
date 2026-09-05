import { describe, expect, it } from 'vitest';
import { outlookResultError } from '../../marketplaces/aihub/plugins/xiaojing-knowledge-base/ui-src/src/outlook-result';
describe('Outlook independent capability errors', () => {
  it('does not present an MCP text error as a successful empty result', () => {
    expect(outlookResultError({ content: [{ type: 'text', text: 'Error executing tool outlook_calendar_search: 当前登录邮箱不存在或尚未开通 Outlook' }] })).toContain('尚未开通 Outlook');
  });
  it('distinguishes structured failure from a legitimate empty directory search', () => {
    expect(outlookResultError({ structuredContent: { ok: false, error: 'Mailbox unavailable' } })).toBe('Mailbox unavailable');
    expect(outlookResultError({ structuredContent: { ok: true, people: [], result_count: 0 } })).toBeNull();
  });
});
