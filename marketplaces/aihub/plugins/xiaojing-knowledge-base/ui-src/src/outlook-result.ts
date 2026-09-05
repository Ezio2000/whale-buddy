export function outlookResultError(result: unknown): string | null {
  if (!result || typeof result !== 'object') return null;
  const value = result as Record<string, unknown>;
  const texts = Array.isArray(value.content) ? value.content.flatMap((block) =>
    block?.type === 'text' && typeof block.text === 'string' ? [block.text] : []) : [];
  const message = texts.find((text) => text.startsWith('Error executing tool'));
  if (message) return message;
  if (value.isError === true || value.ok === false) {
    return typeof value.error === 'string' ? value.error : texts.join('\n') || 'Outlook 调用未完成';
  }
  return value.structuredContent ? outlookResultError(value.structuredContent) : null;
}
