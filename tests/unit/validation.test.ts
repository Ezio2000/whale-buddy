import { describe, expect, it } from 'vitest';
import { absolutePathSchemaFor } from '../../src/shared/validation';

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
