export function renderHtmlDocument(title: string, content: string): string {
  const trimmed = content.trim();
  if (/^(?:<!doctype\s+html\s*>|<html(?:\s|>))/i.test(trimmed)) return trimmed;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>body{font-family:-apple-system,"Segoe UI",sans-serif;max-width:900px;margin:40px auto;line-height:1.7;padding:0 24px}pre{white-space:pre-wrap}</style></head><body><h1>${escapeHtml(title)}</h1><pre>${escapeHtml(content)}</pre></body></html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]!);
}
