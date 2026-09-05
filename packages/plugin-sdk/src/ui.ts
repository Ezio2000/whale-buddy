import { useEffect, useState } from 'react';
import {
  currentContext, onContext, onHostEvent, post, reportSize, request,
  type HostArtifact, type HostAttachment, type HostEvent, type JsonValue, type PluginContext, type PluginStateScope,
} from './core';
export type { HostArtifact, HostAttachment, HostEvent, JsonValue, MessageContext, PluginContext, PluginCredential, PluginStateScope, ToolCallContext } from './core';

export function usePluginContext(): PluginContext | null {
  const [value, setValue] = useState(currentContext());
  useEffect(() => onContext(setValue), []);
  useEffect(() => {
    const observer = new ResizeObserver(reportSize);
    observer.observe(document.body);
    // Native wheel events do not bubble out of an iframe. Forward intent only;
    // the browser still performs scrolling, and the host owns follow state.
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey && event.deltaY) post({ type: 'plugin:scrollIntent', deltaY: event.deltaY });
    };
    document.addEventListener('wheel', wheel, { passive: true, capture: true });
    return () => {
      observer.disconnect();
      document.removeEventListener('wheel', wheel, true);
    };
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
export function pickAttachments(): Promise<HostAttachment[]> { return request('attachments.pick', {}); }
export function readAttachment(path: string): Promise<{ dataBase64: string }> { return request('attachments.read', { path }); }
export function startTask(input: { toolName: string; title: string; prompt: string; attachments: HostAttachment[]; context: JsonValue }): Promise<{ threadId: string }> {
  return request('tasks.start', input);
}
export function createArtifact(input: { name: string; format: 'html' | 'docx' | 'xlsx' | 'pptx'; dataBase64: string; threadId: string; taskId: string }): Promise<HostArtifact> {
  return request('artifacts.create', input);
}
export function listArtifacts(threadId?: string): Promise<HostArtifact[]> { return request('artifacts.list', { threadId }); }
export async function openArtifact(id: string): Promise<void> { await request('artifacts.open', { id }); }
export function saveArtifactAs(id: string): Promise<string | null> { return request('artifacts.saveAs', { id }); }
export { reportSize };
