export function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

// Prefer the structured representation; content is its alternate wire encoding.
export function unwrapResult(value: unknown, depth = 0): unknown {
  if (depth > 10) return null;
  if (typeof value === 'string') {
    try { return unwrapResult(JSON.parse(value), depth + 1); } catch { return null; }
  }
  if (Array.isArray(value)) return value.flatMap((entry) => {
    const unwrapped = unwrapResult(entry, depth + 1);
    return unwrapped == null ? [] : Array.isArray(unwrapped) ? unwrapped : [unwrapped];
  });
  const entry = record(value);
  if (!entry) return null;
  if (entry.structuredContent != null) return unwrapResult(entry.structuredContent, depth + 1);
  if (entry.type === 'text' && typeof entry.text === 'string') return unwrapResult(entry.text, depth + 1);
  if (Array.isArray(entry.content) && entry.content.every((block) => record(block)?.type != null)) return unwrapResult(entry.content, depth + 1);
  if (entry.result != null && !('result_count' in entry)) return unwrapResult(entry.result, depth + 1);
  return entry;
}

export function resultRecords(value: unknown): Record<string, unknown>[] {
  const data = unwrapResult(value);
  return (Array.isArray(data) ? data : [data]).flatMap((entry) => record(entry) ? [record(entry)!] : []);
}

export function knowledgeSnippets(value: unknown): Array<{ title: string; text: string; source: string }> {
  const seen = new Set<string>();
  const snippets: Array<{ title: string; text: string; source: string }> = [];
  for (const result of resultRecords(value)) {
    const datasets = Array.isArray(result.datasets) ? result.datasets : [result];
    for (const raw of datasets) {
      const dataset = record(raw);
      if (!dataset) continue;
      const chunks = Array.isArray(dataset.chunks) ? dataset.chunks : [];
      for (const rawChunk of chunks) {
        const chunk = record(rawChunk);
        if (!chunk) continue;
        const text = textValue(chunk.content) || textValue(chunk.text) || textValue(chunk.snippet);
        if (!text) continue;
        const identity = textValue(chunk.chunk_id) || textValue(chunk.id) || `${textValue(chunk.doc_id)}:${text}`;
        const key = `${textValue(dataset.dataset_id)}:${identity}`;
        if (seen.has(key)) continue;
        seen.add(key);
        snippets.push({ title: textValue(chunk.doc_name) || textValue(chunk.document_name) || textValue(chunk.title), text,
          source: textValue(chunk.source_uri) || textValue(chunk.source) || textValue(dataset.dataset_name) });
      }
    }
  }
  return snippets;
}

export function outlookEntries(value: unknown, tool: string): Record<string, unknown>[] {
  const seen = new Set<string>();
  const entries: Record<string, unknown>[] = [];
  const listKeys = tool.includes('calendar') ? ['events', 'items']
    : tool.includes('directory') ? ['people', 'users', 'items']
    : tool.includes('contact') ? ['contacts', 'people', 'items']
    : tool.includes('history') ? ['history', 'items', 'records'] : ['messages'];
  for (const result of resultRecords(value)) {
    const list = listKeys.map((key) => result[key]).find(Array.isArray) as unknown[] | undefined;
    const single = record(result.action) ?? record(result.message) ?? record(result.preview) ?? record(result.item) ?? record(result.record);
    const candidates = list ?? (single ? [single] : result.message_id || result.subject || result.display_name || result.action_id || (/(send|cancel|preview|history_get)$/.test(tool) && typeof result.status === 'string') ? [result] : []);
    for (const raw of candidates) {
      const entry = record(raw);
      if (!entry) continue;
      const identity = textValue(entry.message_id) || textValue(entry.event_id) || textValue(entry.contact_id) || textValue(entry.id) || JSON.stringify(entry);
      if (seen.has(identity)) continue;
      seen.add(identity); entries.push(entry);
    }
  }
  return entries;
}
export function textValue(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }
