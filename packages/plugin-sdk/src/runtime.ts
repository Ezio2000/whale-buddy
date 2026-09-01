import {
  onReady, onToolCall, post, request,
  type HostArtifact, type JsonValue, type PluginContext, type PluginStateScope,
} from './core';
export type { HostEvent, JsonValue, PluginContext, PluginCredential, PluginStateScope } from './core';

export interface RuntimeServices {
  context: PluginContext;
  getState<T extends JsonValue = JsonValue>(scope: PluginStateScope, scopeId?: string): Promise<T | null>;
  setState(scope: PluginStateScope, value: JsonValue | null, scopeId?: string): Promise<void>;
  callMcp<T = JsonValue>(server: string, tool: string, args?: JsonValue): Promise<T>;
  setComposerContext(sourceId: string, input: { label: string; value: JsonValue; explicitTools?: Array<{ server: string; name: string }> }): Promise<void>;
  clearComposerContext(sourceId: string): Promise<void>;
  readAttachment(path: string): Promise<{ dataBase64: string }>;
  createArtifact(input: { name: string; format: 'html' | 'docx' | 'xlsx' | 'pptx'; dataBase64: string; threadId: string; taskId: string }): Promise<HostArtifact>;
}
export type RuntimeTool = (input: JsonValue, services: RuntimeServices) => JsonValue | Promise<JsonValue>;

export function definePluginRuntime(tools: Record<string, RuntimeTool>): () => void {
  const announce = () => post({ type: 'plugin:runtimeReady', toolIds: Object.keys(tools) });
  const stopReady = onReady(announce);
  const stopTools = onToolCall((call) => {
    const handler = tools[call.toolId];
    if (!handler) {
      post({ type: 'plugin:toolResult', callId: call.callId, ok: false, error: `未注册 WebMCP 工具 ${call.toolId}` });
      return;
    }
    const services: RuntimeServices = {
      context: call.context,
      getState: (scope, scopeId) => request('state.get', { executionId: call.callId, principalId: call.toolId, scope, scopeId }),
      setState: async (scope, value, scopeId) => { await request('state.set', { executionId: call.callId, principalId: call.toolId, scope, scopeId, value }); },
      callMcp: (server, tool, args = {}) => request('mcp.call', { executionId: call.callId, principalId: call.toolId, server, tool, arguments: args }),
      setComposerContext: async (sourceId, input) => { await request('composer.setContext', { executionId: call.callId, principalId: call.toolId, sourceId, ...input }); },
      clearComposerContext: async (sourceId) => { await request('composer.clearContext', { executionId: call.callId, principalId: call.toolId, sourceId }); },
      readAttachment: (path) => request('attachments.read', { executionId: call.callId, principalId: call.toolId, path }),
      createArtifact: (input) => request('artifacts.create', { executionId: call.callId, principalId: call.toolId, ...input }),
    };
    void Promise.resolve(handler(call.input, services))
      .then((result) => post({ type: 'plugin:toolResult', callId: call.callId, ok: true, result }))
      .catch((error) => post({ type: 'plugin:toolResult', callId: call.callId, ok: false, error: error instanceof Error ? error.message : String(error) }));
  });
  return () => { stopReady(); stopTools(); };
}
