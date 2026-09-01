import { describe, expect, it } from 'vitest';
import { renderHtmlDocument } from '../../marketplaces/office/plugins/whale-office-assistant/ui-src/src/html-document';

describe('office HTML artifact rendering', () => {
  it('preserves a complete HTML document as the generated artifact', () => {
    const document = '<!DOCTYPE html><html lang="zh-CN"><body><h1>验收报告</h1></body></html>';
    expect(renderHtmlDocument('验收报告', document)).toBe(document);
  });

  it('wraps and escapes plain text content', () => {
    const document = renderHtmlDocument('A & B', '<not markup>');
    expect(document).toContain('<title>A &amp; B</title>');
    expect(document).toContain('<pre>&lt;not markup&gt;</pre>');
  });
});
