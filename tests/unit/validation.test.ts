import { describe, expect, it } from 'vitest';
import { absolutePathSchema, threadStartSchema } from '../../src/shared/validation';

describe('absolute path validation', () => {
  it.each([
    '/Users/alice/project',
    'C:\\Users\\Alice\\project',
    'D:/code/project',
    '\\\\server\\share\\project',
  ])('accepts %s', (value) => {
    expect(absolutePathSchema.parse(value)).toBe(value);
  });

  it.each(['relative/path', 'C:relative\\path', '\\current-drive\\path'])('rejects %s', (value) => {
    expect(absolutePathSchema.safeParse(value).success).toBe(false);
  });

  it('accepts a Windows cwd when starting a thread', () => {
    const input = { cwd: 'C:\\Users\\Alice\\whale-buddy' };
    expect(threadStartSchema.parse(input)).toEqual(input);
  });
});
