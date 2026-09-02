import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PluginReadResponse } from '../../src/generated/protocol/typescript/v2/PluginReadResponse';
import { hookStateKeyPath, previewPluginHooks } from '../../src/main/plugin-hooks';

const fixtureRoot = path.resolve('tests/fixtures/plugin-stop-hook');

function response(root = fixtureRoot): PluginReadResponse {
  return {
    plugin: {
      marketplaceName: 'fixture',
      marketplacePath: null,
      summary: {
        id: 'fixture-stop-hook',
        name: 'fixture-stop-hook',
        source: { type: 'local', path: root },
      },
      skills: [],
      hooks: [{ key: 'fixture-stop-hook:hooks/hooks.json:stop:0:0', eventName: 'stop' }],
      mcpServers: [],
    },
  } as unknown as PluginReadResponse;
}

describe('plugin Stop Hook preview', () => {
  it('parses the canonical file and selects the platform command', () => {
    const preview = previewPluginHooks(response(), 'win32');
    expect(preview.supported).toBe(true);
    expect(preview.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(preview.hooks).toEqual([
      expect.objectContaining({
        key: 'fixture-stop-hook:hooks/hooks.json:stop:0:0',
        eventName: 'stop',
        platformCommand: 'node.exe hooks\\after-turn.mjs',
        timeoutSec: 12,
        async: false,
      }),
    ]);
  });

  it('fails closed when a declared Hook file cannot be read', () => {
    const preview = previewPluginHooks(response(path.join(fixtureRoot, 'missing')));
    expect(preview.supported).toBe(false);
    expect(preview.errors.join(' ')).toContain('无法定位插件目录');
  });

  it('escapes hook config key paths', () => {
    expect(hookStateKeyPath('plugin:"hook"\\x')).toBe('hooks.state."plugin:\\"hook\\"\\\\x"');
  });
});
