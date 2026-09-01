/**
 * Deliberate boundary for unstable app-server methods.
 *
 * WebMCP tools are bridged through Codex dynamic tools. That protocol is still
 * experimental, so all opt-in remains explicit at this one boundary.
 */
export const experimentalApi = Object.freeze({
  enabled: true as const,
  request(method: string): never {
    throw new Error(`实验协议只能通过已实现的 WebMCP 适配器调用：${method}`);
  },
});
