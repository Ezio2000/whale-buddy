import { describe, expect, it } from 'vitest';
import { knowledgeSnippets, outlookEntries } from '../../marketplaces/aihub/plugins/xiaojing-knowledge-base/ui-src/src/result-data';
const envelope = (data: unknown) => ({ structuredContent: data, content: [{ type: 'text', text: JSON.stringify(data) }] });
describe('AIHub business result decoding', () => {
  it('shows two mail messages once despite overview, source and protocol copies', () => {
    const messages = [{ message_id: 'a', subject: '第一封', preview: '摘要' }, { message_id: 'b', subject: '第二封', preview: '摘要' }];
    const data = { ok: true, result_count: 2, overview: { status: 'ok' }, messages,
      sources: messages.map((m) => ({ title: m.subject, snippet: m.preview })) };
    expect(outlookEntries(envelope(data), 'outlook_mail_search')).toEqual(messages);
    expect(outlookEntries({ content: [{ type: 'text', text: JSON.stringify(data) }] }, 'outlook_mail_search')).toEqual(messages);
  });
  it('shows a full message once, ignoring citation copies and metadata', () => {
    const message = { message_id: 'a', subject: '测试', content: '完整正文' };
    expect(outlookEntries(envelope({ ok: true, message, sources: [{ title: '测试', snippet: '完整正文' }] }), 'outlook_mail_get')).toEqual([message]);
  });
  it('keeps successful empty results empty', () => {
    expect(outlookEntries(envelope({ ok: true, messages: [], result_count: 0 }), 'outlook_mail_search')).toEqual([]);
  });
  it('extracts only chunks, deduplicates IDs and preserves short text', () => {
    const chunk = { chunk_id: 'c1', doc_name: '虚构资料', content: '短片段', source_uri: 'fixture://doc' };
    const data = { result_count: 1, datasets: [{ dataset_id: 'd1', chunks: [chunk, chunk] }] };
    expect(knowledgeSnippets(envelope(data))).toEqual([{ title: '虚构资料', text: '短片段', source: 'fixture://doc' }]);
    expect(knowledgeSnippets({ content: [{ type: 'text', text: JSON.stringify(data) }] })).toHaveLength(1);
  });
});
