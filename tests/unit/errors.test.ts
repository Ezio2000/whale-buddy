import { describe, expect, it } from 'vitest';
import { codexFailureNotice } from '../../src/renderer/state/errors';

describe('Codex error labels', () => {
  it('gives quota, overload, and authentication failures actionable Chinese labels', () => {
    expect(
      codexFailureNotice(
        { message: 'limit reached', codexErrorInfo: 'usageLimitExceeded' },
        'fallback',
      ),
    ).toBe('额度不足：limit reached');
    expect(
      codexFailureNotice({ message: 'retry later', codexErrorInfo: 'serverOverloaded' }, 'fallback'),
    ).toBe('服务繁忙：retry later');
    expect(
      codexFailureNotice({ message: 'sign in', codexErrorInfo: 'unauthorized' }, 'fallback'),
    ).toBe('登录已失效：sign in');
  });
});
