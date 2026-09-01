import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import type { JsonValue } from '../shared/types';
import type { PluginMcpHttpConnection } from './plugin-host';

export async function callPluginMcpTool(
  connection: PluginMcpHttpConnection,
  tool: string,
  args: JsonValue,
): Promise<JsonValue> {
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(new Error('timeout')), connection.timeoutMs);
  const client = new Client({ name: 'whale_buddy_plugin_ui', version: '0.1.0' });
  const transport = new StreamableHTTPClientTransport(new URL(connection.url), {
    requestInit: {
      headers: connection.headers,
      signal: abort.signal,
    },
  });
  try {
    await client.connect(transport);
    const result = await client.callTool({
      name: tool,
      arguments: isJsonObject(args) ? args : {},
    });
    return toJsonValue(result);
  } catch (error) {
    if (abort.signal.aborted) throw new Error('MCP 工具调用超时');
    throw new Error(`MCP 工具调用失败：${errorMessage(error)}`);
  } finally {
    clearTimeout(timeout);
    await client.close().catch(() => undefined);
  }
}

function isJsonObject(value: JsonValue): value is { [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toJsonValue(value: unknown): JsonValue {
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error('MCP 工具返回了无法序列化的结果');
  return JSON.parse(encoded) as JsonValue;
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > 500 ? `${message.slice(0, 500)}…` : message;
}
