import { describe, expect, it } from 'vitest';
import { experimentalApi } from '../../src/main/experimental-api';

describe('experimental protocol adapter', () => {
  it('opts in only for the implemented WebMCP dynamic-tool bridge', () => {
    expect(experimentalApi.enabled).toBe(true);
    expect(() => experimentalApi.request('future/method')).toThrow('只能通过已实现的 WebMCP 适配器');
  });
});
