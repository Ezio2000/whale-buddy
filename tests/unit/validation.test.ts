import { describe, expect, it } from 'vitest';
import {
  absolutePathSchemaFor,
  runtimeConnectionInputSchema,
} from '../../src/shared/validation';

describe('absolute path validation', () => {
  const macosSchema = absolutePathSchemaFor('darwin');
  const windowsSchema = absolutePathSchemaFor('win32');

  it('uses POSIX path semantics on macOS', () => {
    expect(macosSchema.parse('/Users/alice/project')).toBe('/Users/alice/project');
    expect(macosSchema.safeParse('Users/alice/project').success).toBe(false);
  });

  it.each(['C:\\Users\\Alice\\project', 'D:/code/project', '\\\\server\\share\\project'])(
    'accepts Windows absolute path %s',
    (value) => {
      expect(windowsSchema.parse(value)).toBe(value);
    },
  );

  it.each(['relative\\path', 'C:relative\\path'])('rejects Windows relative path %s', (value) => {
    expect(windowsSchema.safeParse(value).success).toBe(false);
  });

  it('keeps platform path rules isolated', () => {
    expect(macosSchema.safeParse('C:\\Users\\Alice\\project').success).toBe(false);
    expect(windowsSchema.safeParse('C:\\Users\\Alice\\project').success).toBe(true);
  });
});

describe('runtime model capability validation', () => {
  const input = {
    proxy: { mode: 'inherit' as const, url: '', noProxy: 'localhost' },
    provider: {
      mode: 'custom' as const,
      id: 'sub2api',
      name: 'sub2api',
      baseUrl: 'https://sub2api.example/v1',
      model: 'deepseek-v4-flash-vision-exp',
      capabilities: {
        contextWindow: 128_000,
        imageInput: true,
        supportsReasoning: true,
        reasoningEfforts: ['low', 'medium', 'high'] as const,
        defaultReasoningEffort: 'medium' as const,
        supportsReasoningSummaries: true,
      },
    },
  };

  it('accepts a complete model capability declaration', () => {
    expect(runtimeConnectionInputSchema.safeParse(input).success).toBe(true);
  });

  it('requires the default reasoning effort to be supported', () => {
    const result = runtimeConnectionInputSchema.safeParse({
      ...input,
      provider: {
        ...input.provider,
        capabilities: {
          ...input.provider.capabilities,
          defaultReasoningEffort: 'xhigh',
        },
      },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ message: '默认推理档位必须包含在支持档位中' }),
      ]));
    }
  });
});
