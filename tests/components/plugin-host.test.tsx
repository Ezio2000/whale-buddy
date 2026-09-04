import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ItemCard } from '../../src/renderer/components/ItemCard';
import { Composer } from '../../src/renderer/components/Composer';
import { CommandPalette } from '../../src/renderer/components/CommandPalette';
import { Sidebar } from '../../src/renderer/components/Sidebar';
import { Workspace } from '../../src/renderer/components/Workspace';
import { DiffPanel } from '../../src/renderer/components/DiffPanel';
import { contextKey, PluginHostProvider, usePluginHost } from '../../src/renderer/plugin-ui/PluginHostProvider';
import { PluginUiFrame } from '../../src/renderer/plugin-ui/PluginUiFrame';
import { PluginActionDialog, PluginNavigationPage } from '../../src/renderer/plugin-ui/PluginUiSurfaces';
import { useAppStore } from '../../src/renderer/state/store';
import type { PluginDescriptor } from '../../src/shared/plugin';
import type { WhaleApi, WhaleEvent } from '../../src/shared/types';

const originalWhale = window.whale;
const originalState = useAppStore.getState();
const entryUrl = 'whale-plugin://plugin/fixture-plugin/ui/index.html';
let eventListeners: Array<(event: WhaleEvent) => void> = [];
const descriptor: PluginDescriptor = {
  pluginId: 'fixture-plugin', pluginName: 'fixture-plugin', displayName: 'Fixture Plugin', apiVersion: 2,
  uiContributions: [
    { id: 'fixture-widget', type: 'widget', placement: 'composer', entryUrl, order: 10 },
    { id: 'fixture-navigation', type: 'page', placement: 'navigation', entryUrl, title: 'Fixture Home', order: 10 },
    { id: 'fixture-command', type: 'action', placement: 'commandPalette', entryUrl, title: 'Fixture Command', description: 'Open fixture command', keywords: ['fixture'], order: 10 },
    { id: 'fixture-thread-action', type: 'action', placement: 'threadToolbar', entryUrl, title: 'Fixture Thread', description: '', keywords: [], order: 10 },
    { id: 'fixture-composer-action', type: 'action', placement: 'composerToolbar', entryUrl, title: 'Fixture Composer', description: '', keywords: [], order: 10 },
    { id: 'fixture-details', type: 'panel', placement: 'turnDetails', entryUrl, title: 'Fixture Changes', order: 10 },
    { id: 'fixture-card', type: 'card', placement: 'message', entryUrl, title: 'Fixture Result', itemTypes: ['mcpToolCall'], server: 'fixture-mcp', tools: ['render_fixture'], order: 10 },
  ],
  webMcp: {
    entryUrl,
    tools: [{
      id: 'fixture-action', name: 'fixture_action', title: 'Fixture Action',
      description: 'Run the fixture plugin action', scope: 'thread', inputSchema: {},
      annotations: { readOnlyHint: true, untrustedContentHint: false },
    }],
  },
  mcpPermissions: [],
  credentials: [{
    id: 'fixture-token', key: 'fixture/token', credentialType: 'bearerToken', label: 'Fixture Token',
    description: 'Fixture credential', env: 'FIXTURE_MCP_TOKEN', required: true, scope: 'marketplace',
    mcpServers: ['fixture-mcp'], value: 'fixture-secret',
  }],
};

beforeEach(() => {
  eventListeners = [];
  Object.defineProperty(window, 'whale', { configurable: true, value: {
    ...(originalWhale ?? {}),
    plugins: { ...(originalWhale?.plugins ?? {}), descriptors: vi.fn().mockResolvedValue([descriptor]), callMcp: vi.fn() },
    skills: { ...(originalWhale?.skills ?? {}), list: vi.fn().mockResolvedValue({ data: [] }) },
    mcp: { ...(originalWhale?.mcp ?? {}), list: vi.fn().mockResolvedValue({ data: [], nextCursor: null }) },
    approvals: { respond: vi.fn().mockResolvedValue(undefined) },
    artifacts: {
      create: vi.fn().mockImplementation(async (input) => ({
        id: 'artifact-1', name: input.name, path: `/artifacts/${input.name}`, format: input.format,
        mimeType: 'application/octet-stream', size: 3, sha256: 'a'.repeat(64), threadId: input.threadId,
        taskId: input.taskId, pluginId: input.pluginId ?? null, turnId: input.turnId ?? null, createdAt: 1,
      })),
      list: vi.fn().mockResolvedValue([]), open: vi.fn().mockResolvedValue(undefined), saveAs: vi.fn().mockResolvedValue(null),
    },
    events: { subscribe: vi.fn((listener: (event: WhaleEvent) => void) => { eventListeners.push(listener); return () => undefined; }) },
  } as unknown as WhaleApi });
  useAppStore.setState({
    ...originalState, selectedThreadId: 'thread-1', selectedProjectId: 'project-1',
    projects: [{ id: 'project-1', path: '/fixture', name: 'Fixture Project', lastOpenedAt: 0 }],
    threads: [{ id: 'thread-1', preview: 'Fixture Thread', name: 'Fixture Thread', cwd: '/fixture', createdAt: 0, updatedAt: 0, status: { type: 'idle' } }],
    runtime: { phase: 'ready', generation: 1, pid: 123, codexVersion: 'fixture', protocolVersion: 'fixture', sidecarHome: '/fixture', codexHome: '/fixture', diagnosticLog: '/fixture/log', restartAttempt: 0, message: null },
  }, true);
});
afterEach(() => {
  cleanup();
  window.localStorage.clear();
  Object.defineProperty(window, 'whale', { configurable: true, value: originalWhale });
  useAppStore.setState(originalState, true);
});

describe('plugin host UI surfaces', () => {
  it('loads a v2 composer widget with host context', async () => {
    render(<PluginHostProvider><Composer /></PluginHostProvider>);
    const frame = await screen.findByTitle<HTMLIFrameElement>('Fixture Plugin · fixture-widget');
    expect(frame).toHaveAttribute('src', entryUrl);
    const postMessage = vi.spyOn(frame.contentWindow!, 'postMessage');
    fireEvent.load(frame);
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'host:init', context: expect.objectContaining({ apiVersion: 2, surface: { kind: 'ui', contributionId: 'fixture-widget', contributionType: 'widget', placement: 'composer' } }),
    }), '*');
  });

  it('adds shared host composer context to a turn', async () => {
    const sendComposer = vi.fn().mockResolvedValue(true);
    useAppStore.setState({ sendComposer });
    window.localStorage.setItem('whale.plugin.v2.composer', JSON.stringify({
      [contextKey('fixture-plugin', 'fixture-widget', 'thread-1')]: { label: 'Fixture scope', value: { fixtureIds: ['one'] } },
    }));
    render(<PluginHostProvider><Composer /></PluginHostProvider>);
    await screen.findByTitle('Fixture Plugin · fixture-widget');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '检查 fixture' } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    await waitFor(() => expect(sendComposer).toHaveBeenCalledWith('检查 fixture', [], [], [], [], [], [expect.objectContaining({ pluginId: 'fixture-plugin', contributionId: 'fixture-widget' })]));
  });

  it('adds an enabled WebMCP action from the dollar picker to the turn', async () => {
    const sendComposer = vi.fn().mockResolvedValue(true);
    useAppStore.setState({ sendComposer });
    render(<PluginHostProvider><Composer /></PluginHostProvider>);
    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: '$fixture_action' } });
    fireEvent.click(await screen.findByRole('button', { name: /fixture_action/ }));
    fireEvent.change(textarea, { target: { value: '$fixture_action 请执行' } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    await waitFor(() => expect(sendComposer).toHaveBeenCalledWith(
      '$fixture_action 请执行', [], [], [], [],
      [{ pluginId: 'fixture-plugin', name: 'fixture_action' }],
    ));
  });

  it('mounts navigation and all action placements', async () => {
    render(<PluginHostProvider><Sidebar /><PluginNavigationPage /><CommandPalette /><Workspace /><PluginActionDialog /></PluginHostProvider>);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Fixture Home' }))[0]!);
    expect((await screen.findAllByTitle('Fixture Plugin · fixture-navigation')).length).toBeGreaterThan(0);
    useAppStore.setState({ commandPaletteOpen: true });
    fireEvent.click(await screen.findByRole('button', { name: /Fixture Command/ }));
    expect(await screen.findByTitle('Fixture Plugin · fixture-command')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '关闭插件操作' }));
    useAppStore.getState().setWorkspaceView('conversation');
    fireEvent.click(await screen.findByRole('button', { name: 'Fixture Thread' }));
    expect(await screen.findByTitle('Fixture Plugin · fixture-thread-action')).toBeInTheDocument();
  });

  it('replaces a matching message with the declared card', async () => {
    render(<PluginHostProvider><ItemCard item={{
      id: 'message-1', type: 'mcpToolCall', pluginId: 'fixture-plugin', server: 'fixture-mcp',
      tool: 'render_fixture', status: 'completed', result: { answer: 42 },
    }} turnId="turn-1" approvals={[]} onRespondApproval={() => undefined} /></PluginHostProvider>);
    const frame = await screen.findByTitle<HTMLIFrameElement>('Fixture Plugin · fixture-card');
    expect(screen.getByText('Fixture Result')).toBeInTheDocument();
    const postMessage = vi.spyOn(frame.contentWindow!, 'postMessage');
    fireEvent.load(frame);
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ context: expect.objectContaining({ turnId: 'turn-1', message: expect.objectContaining({ itemId: 'message-1' }) }) }), '*');
  });

  it('mounts plugin turn-details contributions with the selected turn context', async () => {
    render(<PluginHostProvider><DiffPanel turns={[{
      id: 'turn-1', status: 'completed', error: null, startedAt: 1, completedAt: 2, durationMs: 1_000,
      itemOrder: ['office-item'], items: { 'office-item': { id: 'office-item', type: 'dynamicToolCall', pluginId: 'fixture-plugin' } },
      diff: '', fileChanges: [], plan: [], planExplanation: null,
    }]} /></PluginHostProvider>);
    fireEvent.click(await screen.findByRole('button', { name: 'Fixture Changes' }));
    const frame = await screen.findByTitle<HTMLIFrameElement>('Fixture Plugin · fixture-details');
    const postMessage = vi.spyOn(frame.contentWindow!, 'postMessage');
    fireEvent.load(frame);
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'host:init', context: expect.objectContaining({
        threadId: 'thread-1', turnId: 'turn-1',
        surface: { kind: 'ui', contributionId: 'fixture-details', contributionType: 'panel', placement: 'turnDetails' },
      }),
    }), '*');
  });

  it('attributes artifacts to the owning plugin and active turn at the host boundary', async () => {
    render(<PluginHostProvider><PluginUiFrame
      descriptor={descriptor}
      contribution={descriptor.uiContributions[0]!}
      threadId="thread-1"
      turnId="turn-1"
    /></PluginHostProvider>);
    const frame = await screen.findByTitle<HTMLIFrameElement>('Fixture Plugin · fixture-widget');
    const postMessage = vi.spyOn(frame.contentWindow!, 'postMessage');
    fireEvent.load(frame);
    const init = postMessage.mock.calls.find(([message]) => (message as { type?: string }).type === 'host:init')?.[0] as { nonce: string };
    fireEvent(window, new MessageEvent('message', {
      source: frame.contentWindow,
      data: {
        channel: 'whale-plugin-v2', nonce: init.nonce, type: 'plugin:request', requestId: 'artifact-request',
        method: 'artifacts.create', payload: {
          name: 'fixture.pptx', format: 'pptx', dataBase64: 'YWJj', threadId: 'thread-1', taskId: 'task-1',
          pluginId: 'spoofed-plugin', turnId: 'spoofed-turn',
        },
      },
    }));
    await waitFor(() => expect(window.whale.artifacts.create).toHaveBeenCalledWith(expect.objectContaining({
      pluginId: 'fixture-plugin', turnId: 'turn-1',
    })));
    expect(window.whale.artifacts.create).not.toHaveBeenCalledWith(expect.objectContaining({ pluginId: 'spoofed-plugin' }));
  });

  it('infers a WebMCP plugin for dynamic tool results without a plugin id', async () => {
    vi.mocked(window.whale.plugins.descriptors).mockResolvedValue([{
      ...descriptor,
      uiContributions: [...descriptor.uiContributions, {
        id: 'fixture-dynamic-card', type: 'card', placement: 'message', entryUrl,
        title: 'Fixture Dynamic Result', itemTypes: ['dynamicToolCall'], server: null, tools: [], order: 5,
      }],
    }]);
    render(<PluginHostProvider><ItemCard item={{
      id: 'message-2', type: 'dynamicToolCall', tool: 'fixture_action', status: 'completed', result: { answer: 42 },
    }} approvals={[]} onRespondApproval={() => undefined} /></PluginHostProvider>);
    expect(await screen.findByTitle<HTMLIFrameElement>('Fixture Plugin · fixture-dynamic-card')).toBeInTheDocument();
  });

  it('keeps one runtime frame and dispatches WebMCP tools through it', async () => {
    const runtimeDescriptor: PluginDescriptor = {
      ...descriptor,
      uiContributions: descriptor.uiContributions.filter((contribution) =>
        contribution.type === 'action' && contribution.placement === 'composerToolbar'),
      webMcp: { entryUrl, tools: [{
        id: 'inspect', name: 'fixture_inspect', title: 'Inspect', description: 'Inspect fixture.',
        scope: 'thread', inputSchema: { type: 'object' },
        annotations: { readOnlyHint: true, untrustedContentHint: false },
      }] },
    };
    vi.mocked(window.whale.plugins.descriptors).mockResolvedValue([runtimeDescriptor]);
    render(<PluginHostProvider><RuntimeCaller /></PluginHostProvider>);
    const frame = await screen.findByTitle<HTMLIFrameElement>('Fixture Plugin WebMCP runtime');
    const postMessage = vi.spyOn(frame.contentWindow!, 'postMessage');
    fireEvent.load(frame);
    const init = postMessage.mock.calls.find(([message]) => (message as { type?: string }).type === 'host:init')?.[0] as { nonce: string };
    fireEvent(window, new MessageEvent('message', {
      source: frame.contentWindow,
      data: { channel: 'whale-plugin-v2', nonce: init.nonce, type: 'plugin:runtimeReady', toolIds: ['inspect'] },
    }));
    await waitFor(() => expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'host:context' }), '*'), { timeout: 5000, interval: 100 });
    fireEvent.click(screen.getByRole('button', { name: 'invoke runtime' }));
    await waitFor(() => expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'host:toolCall', toolId: 'inspect' }), '*'), { timeout: 5000, interval: 100 });
    const call = postMessage.mock.calls.find(([message]) => (message as { type?: string }).type === 'host:toolCall')?.[0] as { callId: string };
    fireEvent(window, new MessageEvent('message', {
      source: frame.contentWindow,
      data: {
        channel: 'whale-plugin-v2', nonce: init.nonce, type: 'plugin:request', requestId: 'context-request',
        method: 'composer.setContext', payload: {
          executionId: call.callId, principalId: 'inspect', sourceId: 'fixture-composer-action',
          label: 'Fixture scope', value: { fixtureIds: ['one'] },
        },
      },
    }));
    await waitFor(() => expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'host:response', requestId: 'context-request', ok: true,
    }), '*'), { timeout: 5000, interval: 100 });
    await waitFor(() => expect(JSON.parse(
      window.localStorage.getItem('whale.plugin.v2.composer') ?? '{}',
    )).toEqual(expect.objectContaining({
      [contextKey('fixture-plugin', 'fixture-composer-action', 'thread-1')]: {
        label: 'Fixture scope', value: { fixtureIds: ['one'] },
      },
    })));
    fireEvent(window, new MessageEvent('message', {
      source: frame.contentWindow,
      data: {
        channel: 'whale-plugin-v2', nonce: init.nonce, type: 'plugin:request', requestId: 'spoofed-request',
        method: 'mcp.call', payload: { executionId: call.callId, principalId: 'another-tool', server: 'fixture-mcp', tool: 'inspect' },
      },
    }));
    await waitFor(() => expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'host:response', requestId: 'spoofed-request', ok: false, error: expect.stringMatching(/身份/),
    }), '*'));
    fireEvent(window, new MessageEvent('message', {
      source: frame.contentWindow,
      data: { channel: 'whale-plugin-v2', nonce: init.nonce, type: 'plugin:toolResult', callId: call.callId, ok: true, result: { answer: 42 } },
    }));
    expect(await screen.findByText('{"answer":42}')).toBeInTheDocument();
  });

  it('keeps a UI frame tool invocation in that frame thread context', async () => {
    const runtimeDescriptor: PluginDescriptor = {
      ...descriptor,
      webMcp: { entryUrl, tools: [{
        id: 'inspect', name: 'fixture_inspect', title: 'Inspect', description: 'Inspect fixture.',
        scope: 'thread', inputSchema: { type: 'object' },
        annotations: { readOnlyHint: true, untrustedContentHint: false },
      }] },
    };
    vi.mocked(window.whale.plugins.descriptors).mockResolvedValue([runtimeDescriptor]);
    render(<PluginHostProvider><PluginUiFrame
      descriptor={runtimeDescriptor}
      contribution={runtimeDescriptor.uiContributions[0]!}
      threadId="schedule:fixture"
    /></PluginHostProvider>);
    const runtimeFrame = await screen.findByTitle<HTMLIFrameElement>('Fixture Plugin WebMCP runtime');
    const uiFrame = await screen.findByTitle<HTMLIFrameElement>('Fixture Plugin · fixture-widget');
    const runtimePost = vi.spyOn(runtimeFrame.contentWindow!, 'postMessage');
    const uiPost = vi.spyOn(uiFrame.contentWindow!, 'postMessage');
    fireEvent.load(runtimeFrame);
    fireEvent.load(uiFrame);
    const runtimeInit = runtimePost.mock.calls.find(([message]) => (message as { type?: string }).type === 'host:init')?.[0] as { nonce: string };
    const uiInit = uiPost.mock.calls.find(([message]) => (message as { type?: string }).type === 'host:init')?.[0] as { nonce: string };
    fireEvent(window, new MessageEvent('message', {
      source: runtimeFrame.contentWindow,
      data: { channel: 'whale-plugin-v2', nonce: runtimeInit.nonce, type: 'plugin:runtimeReady', toolIds: ['inspect'] },
    }));
    fireEvent(window, new MessageEvent('message', {
      source: uiFrame.contentWindow,
      data: { channel: 'whale-plugin-v2', nonce: uiInit.nonce, type: 'plugin:ready' },
    }));
    fireEvent(window, new MessageEvent('message', {
      source: uiFrame.contentWindow,
      data: {
        channel: 'whale-plugin-v2', nonce: uiInit.nonce, type: 'plugin:request', requestId: 'invoke-request',
        method: 'tool.invoke', payload: { toolId: 'inspect', arguments: {} },
      },
    }));
    await waitFor(() => expect(runtimePost).toHaveBeenCalledWith(expect.objectContaining({
      type: 'host:toolCall', toolId: 'inspect', context: expect.objectContaining({ threadId: 'schedule:fixture' }),
    }), '*'));
    const call = runtimePost.mock.calls.find(([message]) => (message as { type?: string }).type === 'host:toolCall')?.[0] as { callId: string };
    fireEvent(window, new MessageEvent('message', {
      source: runtimeFrame.contentWindow,
      data: { channel: 'whale-plugin-v2', nonce: runtimeInit.nonce, type: 'plugin:toolResult', callId: call.callId, ok: true, result: null },
    }));
    await waitFor(() => expect(uiPost).toHaveBeenCalledWith(expect.objectContaining({ type: 'host:response', requestId: 'invoke-request', ok: true }), '*'));
  });

  it('fails stale dynamic-tool requests after their plugin is unavailable', async () => {
    render(<PluginHostProvider><span>ready</span></PluginHostProvider>);
    await waitFor(() => expect(window.whale.plugins.descriptors).toHaveBeenCalled());
    await act(async () => {
      for (const listener of eventListeners) listener({
        kind: 'serverRequest',
        message: { id: 17, method: 'item/tool/call', params: { tool: 'removed_tool', arguments: {}, threadId: 'thread-1' } },
      } as WhaleEvent);
    });
    await waitFor(() => expect(window.whale.approvals.respond).toHaveBeenCalledWith(expect.objectContaining({
      requestId: 17, method: 'item/tool/call', response: expect.objectContaining({ success: false }),
    })));
  });
});

function RuntimeCaller() {
  const host = usePluginHost();
  const [result, setResult] = useState('');
  return <><button onClick={() => void host.invokeTool('fixture-plugin', 'inspect', {}).then((value) => setResult(JSON.stringify(value)))}>invoke runtime</button><span>{result}</span></>;
}
