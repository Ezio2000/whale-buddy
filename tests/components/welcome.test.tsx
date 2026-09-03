import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Welcome } from '../../src/renderer/components/Welcome';
import { useAppStore } from '../../src/renderer/state/store';

const originalState = useAppStore.getState();

afterEach(() => {
  useAppStore.setState(originalState, true);
});

describe('Welcome', () => {
  it('offers only Provider API Key onboarding', () => {
    useAppStore.setState({ ...originalState, runtime: null, notice: null }, true);

    render(<Welcome />);
    expect(screen.getByRole('button', { name: /配置 Provider 与 API Key/ })).toBeInTheDocument();
    expect(screen.queryByText(/ChatGPT 登录/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/OpenAI API Key/)).not.toBeInTheDocument();
  });

  it('shows actionable diagnostics when the local sidecar is offline', () => {
    useAppStore.setState({
      ...originalState,
      runtime: {
        phase: 'faulted',
        generation: 3,
        pid: null,
        codexVersion: null,
        protocolVersion: 'fixture',
        sidecarHome: '/private/whale/sidecar-home',
        codexHome: '/private/whale/codex-home',
        diagnosticLog: '/private/whale/logs/app-server.log',
        restartAttempt: 3,
        message: '自动重启次数已用尽',
      },
      notice: null,
    }, true);

    render(<Welcome />);
    expect(screen.getByRole('heading', { name: 'AI小鲸 sidecar 尚未就绪' })).toBeInTheDocument();
    expect(screen.getByText('自动重启次数已用尽')).toBeInTheDocument();
    expect(screen.getByText('/private/whale/sidecar-home')).toBeInTheDocument();
    expect(screen.getByText('/private/whale/codex-home')).toBeInTheDocument();
    expect(screen.getByText('/private/whale/logs/app-server.log')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /重新连接/ })).toBeInTheDocument();
  });
});
