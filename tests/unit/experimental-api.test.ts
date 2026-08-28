import { describe, expect, it } from 'vitest';
import { experimentalApi } from '../../src/main/experimental-api';

describe('experimental protocol adapter', () => {
  it('is disabled and fails closed by default', () => {
    expect(experimentalApi.enabled).toBe(false);
    expect(() => experimentalApi.request('future/method')).toThrow('实验协议默认关闭');
  });
});
