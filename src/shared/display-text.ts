const CONTEXT_TAGS = [
  'whale_brand_identity',
  'whale_file_attachments',
  'whale_explicit_tools',
  'whale_explicit_dynamic_tools',
  'whale_plugin_context',
];

/** Strip only app-owned context, including previews truncated inside a context block. */
export function userVisibleText(value: string | null | undefined): string {
  let text = value ?? '';
  for (const tag of CONTEXT_TAGS) {
    text = text.replace(new RegExp(`<${tag}>[\\s\\S]*?(?:<\\/${tag}>|$)`, 'gu'), '');
  }
  text = text.replace(/<([a-z_]+)$/u, (match, partial: string) =>
    partial.startsWith('whale_') && CONTEXT_TAGS.some((tag) => tag.startsWith(partial)) ? '' : match);
  return text.trim();
}

export function threadDisplayTitle(thread: { name?: string | null; preview?: string } | null | undefined): string {
  return userVisibleText(thread?.name) || userVisibleText(thread?.preview) || '未命名对话';
}
