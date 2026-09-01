import { useEffect, useState } from 'react';
import {
  currentContext, onContext, onHostEvent, reportSize, request,
  type HostEvent, type JsonValue, type PluginContext, type PluginStateScope,
} from './core';
export type { HostEvent, JsonValue, MessageContext, PluginContext, PluginCredential, PluginStateScope, ToolCallContext } from './core';

export function usePluginContext(): PluginContext | null {
  const [value, setValue] = useState(currentContext());
  useEffect(() => onContext(setValue), []);
  useEffect(() => {
    const observer = new ResizeObserver(reportSize);
    observer.observe(document.body);
    return () => observer.disconnect();
  }, []);
  return value;
}
export function usePluginEvents(listener: (event: HostEvent) => void): void {
  useEffect(() => onHostEvent(listener), [listener]);
}
export function getState<T extends JsonValue = JsonValue>(scope: PluginStateScope, scopeId?: string): Promise<T | null> {
  return request('state.get', { scope, scopeId });
}
export async function setState(scope: PluginStateScope, value: JsonValue | null, scopeId?: string): Promise<void> {
  await request('state.set', { scope, scopeId, value });
}
export function callMcp<T = JsonValue>(server: string, tool: string, args: JsonValue = {}): Promise<T> {
  return request('mcp.call', { server, tool, arguments: args });
}
export function invokeTool<T = JsonValue>(toolId: string, args: JsonValue = {}): Promise<T> {
  return request('tool.invoke', { toolId, arguments: args });
}
export { reportSize };
