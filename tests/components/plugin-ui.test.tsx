import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ItemCard } from '../../src/renderer/components/ItemCard';
import { Composer } from '../../src/renderer/components/Composer';
import { contextKey, PluginUiProvider } from '../../src/renderer/plugin-ui/PluginUiProvider';
import { useAppStore } from '../../src/renderer/state/store';
import type { PluginUiDescriptor } from '../../src/shared/plugin-ui';
import type { WhaleApi } from '../../src/shared/types';

const originalWhale = window.whale;
const originalState = useAppStore.getState();

const descriptor: PluginUiDescriptor = {
  pluginId: 'fixture-plugin',
  pluginName: 'fixture-plugin',
  displayName: 'Fixture Plugin',
  apiVersion: 1,
  contributions: [
    {
      id: 'fixture-widget',
      type: 'composer.widget',
      entryUrl: 'whale-plugin://plugin/fixture-plugin/ui/index.html',
      order: 10,
    },
    {
      id: 'fixture-card',
      type: 'mcp.toolCard',
      entryUrl: 'whale-plugin://plugin/fixture-plugin/ui/index.html',
      server: 'fixture-mcp',
      tools: ['inspect_fixture'],
    },
  ],
  uiMcpPermissions: [{ server: 'fixture-mcp', tools: ['list_fixture'] }],
};

beforeEach(() => {
  Object.defineProperty(window, 'whale', {
    configurable: true,
    value: {
      ...(originalWhale ?? {}),
      plugins: {
        ...(originalWhale?.plugins ?? {}),
        uiList: vi.fn().mockResolvedValue([descriptor]),
        uiCallTool: vi.fn(),
      },
    } as WhaleApi,
  });
  useAppStore.setState({
    ...originalState,
    selectedThreadId: 'thread-1',
    runtime: {
      phase: 'ready',
      generation: 1,
      pid: 123,
      codexVersion: 'fixture',
      protocolVersion: 'fixture',
      sidecarHome: '/fixture',
      codexHome: '/fixture',
      diagnosticLog: '/fixture/log',
      restartAttempt: 0,
      message: null,
    },
  }, true);
});

afterEach(() => {
  cleanup();
  window.localStorage.removeItem('whale.plugin-ui.v1.composer');
  Object.defineProperty(window, 'whale', { configurable: true, value: originalWhale });
  useAppStore.setState(originalState, true);
});

describe('plugin UI contributions', () => {
  it('loads an enabled composer widget in an isolated frame', async () => {
    render(<PluginUiProvider><Composer /></PluginUiProvider>);

    const frame = await screen.findByTitle('Fixture Plugin · fixture-widget');
    expect(frame).toHaveAttribute('sandbox', 'allow-scripts allow-same-origin');
    expect(frame).toHaveAttribute('scrolling', 'no');
    expect(frame).toHaveAttribute('src', descriptor.contributions[0].entryUrl);
    expect(frame.closest('.composer-tools')).toBeInTheDocument();
    expect(frame.parentElement?.querySelector('.plugin-composer-icon')).not.toBeInTheDocument();
    expect(screen.queryByText(/Shift\+Enter/)).not.toBeInTheDocument();
  });

  it('keeps Whale status chrome while delegating MCP card content', async () => {
    render(
      <PluginUiProvider>
        <ItemCard
          item={{
            id: 'item-1',
            type: 'mcpToolCall',
            pluginId: 'fixture-plugin',
            server: 'fixture-mcp',
            tool: 'inspect_fixture',
            status: 'completed',
            arguments: { query: 'fixture' },
            result: { content: [] },
          }}
          approvals={[]}
          onRespondApproval={() => undefined}
        />
      </PluginUiProvider>,
    );

    const trigger = await screen.findByRole('button', { name: /fixture-mcp · inspect_fixture/ });
    expect(screen.queryByTitle('Fixture Plugin · fixture-card')).not.toBeInTheDocument();
    expect(screen.getByText(/完成/)).toBeInTheDocument();
    expect(trigger.querySelector('.collapsible-chevron')).not.toBeInTheDocument();
    fireEvent.click(trigger);
    expect(await screen.findByTitle('Fixture Plugin · fixture-card')).toBeInTheDocument();
  });

  it('keeps plugin tool hints out of user-explicit tool references', async () => {
    const sendComposer = vi.fn().mockResolvedValue(true);
    useAppStore.setState({ sendComposer });
    window.localStorage.setItem('whale.plugin-ui.v1.composer', JSON.stringify({
      [contextKey('fixture-plugin', 'fixture-widget', 'thread-1')]: {
        label: 'Fixture scope',
        value: { fixtureIds: ['one'] },
        explicitTools: [{ server: 'fixture-mcp', name: 'inspect_fixture' }],
      },
    }));

    render(<PluginUiProvider><Composer /></PluginUiProvider>);
    await screen.findByTitle('Fixture Plugin · fixture-widget');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '检查 fixture' } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));

    await waitFor(() => expect(sendComposer).toHaveBeenCalledWith(
      '检查 fixture',
      [],
      [],
      [],
      [],
      [{
        pluginId: 'fixture-plugin',
        contributionId: 'fixture-widget',
        label: 'Fixture scope',
        value: { fixtureIds: ['one'] },
        toolHints: [{ server: 'fixture-mcp', name: 'inspect_fixture' }],
      }],
    ));
  });

  it('opens a custom tool while running and closes it after completion', async () => {
    const item = {
      id: 'item-1',
      type: 'mcpToolCall',
      pluginId: 'fixture-plugin',
      server: 'fixture-mcp',
      tool: 'inspect_fixture',
      status: 'inProgress',
      whaleStartedAtMs: Date.now(),
    };
    const view = render(
      <PluginUiProvider>
        <ItemCard item={item} approvals={[]} onRespondApproval={() => undefined} />
      </PluginUiProvider>,
    );
    expect(await screen.findByTitle('Fixture Plugin · fixture-card')).toBeInTheDocument();

    view.rerender(
      <PluginUiProvider>
        <ItemCard
          item={{ ...item, status: 'completed', whaleCompletedAtMs: Date.now() }}
          approvals={[]}
          onRespondApproval={() => undefined}
        />
      </PluginUiProvider>,
    );
    await waitFor(() => expect(
      screen.queryByTitle('Fixture Plugin · fixture-card'),
    ).not.toBeInTheDocument());
    expect(screen.getByText('fixture-mcp · inspect_fixture')).toBeInTheDocument();
  });
});
