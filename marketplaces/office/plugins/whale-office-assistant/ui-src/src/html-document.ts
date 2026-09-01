export function renderHtmlDocument(title: string, content: string): string {
  const trimmed = content.trim();
  if (/^(?:<!doctype\s+html\s*>|<html(?:\s|>))/i.test(trimmed)) return trimmed;
  if (/^<(?:main|article|section|header|footer|nav|div|h[1-6]|p|ul|ol|table|figure|blockquote)\b/i.test(trimmed)) {
    return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>${pageStyles()}</style></head><body>${trimmed}</body></html>`;
  }
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>${pageStyles()}</style></head><body><h1>${escapeHtml(title)}</h1><pre>${escapeHtml(content)}</pre></body></html>`;
}

function pageStyles(): string {
  return 'body{font-family:-apple-system,"Segoe UI",sans-serif;max-width:900px;margin:40px auto;line-height:1.7;padding:0 24px;color:#25303d}h1,h2,h3{color:#285f8d}table{border-collapse:collapse;width:100%}th,td{border:1px solid #dce3e9;padding:8px;text-align:left}pre{white-space:pre-wrap}';
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]!);
}
