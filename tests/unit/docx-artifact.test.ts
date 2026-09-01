import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { parseRichText, renderDocxArtifact } from '../../marketplaces/office/plugins/whale-office-assistant/ui-src/src/docx-artifact';

describe('office Word artifacts', () => {
  it('parses Markdown and semantic HTML without leaking markup', () => {
    expect(parseRichText('# 标题\n\n- **重点**与`代码`')).toEqual([
      { kind: 'heading', level: 1, runs: [{ text: '标题' }] },
      { kind: 'bullet', runs: [{ text: '重点', bold: true }, { text: '与' }, { text: '代码', code: true }] },
    ]);
    const html = parseRichText('<h1>标题</h1><p>这是<strong>重点</strong>。</p>');
    expect(html[1]).toEqual({ kind: 'paragraph', runs: [{ text: '这是' }, { text: '重点', bold: true }, { text: '。' }] });
  });

  it('renders real Word structure instead of raw Markdown or HTML source', async () => {
    const bytes = await renderDocxArtifact({
      taskId: 'task-docx', title: '测试报告.docx', format: 'docx', summary: '结构化报告。',
      content: '<h1>测试报告</h1><h2>结论</h2><p>这是<strong>重点</strong>内容。</p><ul><li>行动一</li></ul>',
    });
    const zip = await JSZip.loadAsync(bytes);
    const xml = await zip.file('word/document.xml')!.async('text');
    expect(xml).toContain('测试报告');
    expect(xml).toContain('结论');
    expect(xml).toContain('重点');
    expect(xml).not.toContain('&lt;h1');
    expect(xml).not.toContain('<h1>');
    expect(xml).not.toContain('**');
    expect(xml).toContain('w:numPr');
  });
});
