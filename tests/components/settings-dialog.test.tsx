import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsDialog } from '../../src/renderer/components/SettingsDialog';
import { useAppStore } from '../../src/renderer/state/store';
import type {
  RuntimeConnectionSettings,
  RuntimeConnectionSettingsInput,
} from '../../src/shared/types';

const originalState = useAppStore.getState();

afterEach(() => {
  useAppStore.setState(originalState, true);
});

describe('SettingsDialog model capabilities', () => {
  it('shows, edits, and saves capabilities for the configured model', async () => {
    const applyRuntimeSettings = vi.fn(async (
      input: RuntimeConnectionSettingsInput,
    ): Promise<RuntimeConnectionSettings> => {
      const { apiKey: _apiKey, ...provider } = input.provider;
      return { proxy: input.proxy, provider: { ...provider, hasApiKey: true } };
    });
    useAppStore.setState({
      ...originalState,
      settingsOpen: true,
      connectionSettings: {
        proxy: { mode: 'inherit', url: '', noProxy: 'localhost,127.0.0.1,::1' },
        provider: {
          mode: 'custom',
          id: 'sub2api',
          name: 'sub2api',
          baseUrl: 'https://sub2api.example/v1',
          model: 'deepseek-v4-flash-vision-exp',
          capabilities: {
            contextWindow: 128_000,
            imageInput: true,
            supportsReasoning: true,
            reasoningEfforts: ['low', 'medium', 'high'],
            defaultReasoningEffort: 'medium',
            supportsReasoningSummaries: true,
          },
          hasApiKey: true,
        },
      },
      preferences: {
        ...originalState.preferences,
        model: 'deepseek-v4-flash-vision-exp',
        effort: 'medium',
      },
      applyRuntimeSettings,
    }, true);

    render(<SettingsDialog />);

    expect(screen.getByText('只需填写服务地址、模型名称和 API Key。')).toBeInTheDocument();
    expect(screen.getByLabelText('模型服务地址')).toHaveValue('https://sub2api.example/v1');
    expect(screen.getByLabelText('模型服务访问密钥')).toBeInTheDocument();
    expect(screen.getByText('思考强度')).toBeInTheDocument();
    fireEvent.click(screen.getByText('高级模型能力'));
    expect(screen.getByText('能力概览')).toBeInTheDocument();
    expect(screen.getByText('视觉')).toBeInTheDocument();
    expect(screen.getByText('128K 上下文')).toBeInTheDocument();
    expect(screen.getByLabelText('模型上下文窗口')).toHaveValue(128_000);
    expect(screen.getByRole('switch', { name: '视觉输入' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('switch', { name: '推理能力' })).toHaveAttribute('aria-checked', 'true');

    fireEvent.change(screen.getByLabelText('模型上下文窗口'), {
      target: { value: '200000' },
    });
    fireEvent.click(screen.getByRole('switch', { name: '视觉输入' }));
    fireEvent.click(screen.getByRole('button', { name: '超高' }));
    fireEvent.click(screen.getByRole('button', { name: '保存能力并重连' }));

    await waitFor(() => expect(applyRuntimeSettings).toHaveBeenCalledTimes(1));
    expect(applyRuntimeSettings).toHaveBeenCalledWith(expect.objectContaining({
      provider: expect.objectContaining({
        model: 'deepseek-v4-flash-vision-exp',
        capabilities: expect.objectContaining({
          contextWindow: 200_000,
          imageInput: false,
          supportsReasoning: true,
          reasoningEfforts: ['low', 'medium', 'high', 'xhigh'],
        }),
      }),
    }));
  });
});
