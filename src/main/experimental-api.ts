/**
 * Deliberate boundary for unstable app-server methods.
 *
 * The first milestone never enables or routes experimental client requests. Future
 * experiments must be implemented behind this adapter instead of leaking into the
 * stable IPC surface.
 */
export const experimentalApi = Object.freeze({
  enabled: false as const,
  request(method: string): never {
    throw new Error(`实验协议默认关闭，无法调用 ${method}`);
  },
});
