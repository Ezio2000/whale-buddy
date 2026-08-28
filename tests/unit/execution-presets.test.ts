import { describe, expect, it } from 'vitest';
import {
  executionPresetFor,
  executionPresetPreferences,
} from '../../src/renderer/components/SettingsDialog';

describe('execution presets', () => {
  it('maps YOLO to full access with approvals disabled', () => {
    expect(executionPresetPreferences('yolo')).toEqual({
      approvalPolicy: 'never',
      sandboxMode: 'danger-full-access',
    });
    expect(executionPresetFor({
      approvalPolicy: 'never',
      sandboxMode: 'danger-full-access',
    })).toBe('yolo');
  });

  it('keeps incomplete high-permission combinations visibly custom', () => {
    expect(executionPresetFor({
      approvalPolicy: 'never',
      sandboxMode: 'workspace-write',
    })).toBe('custom');
  });
});
