import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Composer } from '../../src/renderer/components/Composer';
import { useAppStore } from '../../src/renderer/state/store';
import type { WhaleApi } from '../../src/shared/types';

const originalState = useAppStore.getState();
const originalWhale = window.whale;
const savedAttachment = {
  name: 'notes.txt',
  path: '/private/whale/attachments/notes.txt',
  kind: 'file' as const,
};
const saveClipboardAttachment = vi.fn().mockResolvedValue(savedAttachment);
const sendComposer = vi.fn().mockResolvedValue(true);
const listSkills = vi.fn().mockResolvedValue({
  data: [{
    cwd: '/workspace/project',
    errors: [],
    skills: [{
      name: 'test-plugin:test-skill',
      description: '用于测试显式 Skill 调用',
      path: '/whale/plugins/test/skills/test-skill/SKILL.md',
      scope: 'user',
      enabled: true,
      pluginId: 'test-plugin@test-marketplace',
    }],
  }],
});
const listMcp = vi.fn().mockResolvedValue({
  data: [{
    name: 'test-mcp',
    runtimeStatus: 'connected',
    pluginId: 'test-plugin@test-marketplace',
    serverInfo: null,
    tools: {
      echo_message: {
        name: 'echo_message',
        description: '原样返回输入',
        inputSchema: {},
      },
    },
    resources: [],
    resourceTemplates: [],
    authStatus: 'notSupported',
  }],
  nextCursor: null,
});

beforeEach(() => {
  saveClipboardAttachment.mockClear();
  sendComposer.mockClear();
  listSkills.mockClear();
  listMcp.mockClear();
  Object.defineProperty(window, 'whale', {
    configurable: true,
    value: {
      files: {
        pickAttachments: vi.fn().mockResolvedValue([]),
        saveClipboardAttachment,
        search: vi.fn().mockResolvedValue([]),
      },
      skills: { list: listSkills },
      mcp: { list: listMcp },
    } as unknown as WhaleApi,
  });
  useAppStore.setState({
    ...originalState,
    projects: [{ id: 'project', path: '/workspace/project', name: 'project', lastOpenedAt: 0 }],
    selectedProjectId: 'project',
    selectedThreadId: 'thread',
    sendComposer,
    notice: null,
  }, true);
});

afterEach(() => {
  Object.defineProperty(window, 'whale', { configurable: true, value: originalWhale });
  useAppStore.setState(originalState, true);
});

describe('Composer', () => {
  it('saves pasted clipboard files and sends them as unified attachments', async () => {
    render(<Composer />);
    const textarea = screen.getByRole('textbox');
    const file = new File(['hello whale'], 'notes.txt', { type: 'text/plain' });

    fireEvent.paste(textarea, {
      clipboardData: {
        items: [{ kind: 'file', type: 'text/plain', getAsFile: () => file }],
      },
    });

    await waitFor(() => expect(saveClipboardAttachment).toHaveBeenCalledWith({
      dataUrl: expect.stringMatching(/^data:text\/plain;base64,/),
      name: 'notes.txt',
    }));
    expect(await screen.findByText('notes.txt')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    await waitFor(() => expect(sendComposer).toHaveBeenCalledWith(
      '',
      [savedAttachment],
      [],
      [],
      [],
      [],
    ));
  });

  it('selects an enabled Skill and MCP Tool with the dollar picker', async () => {
    render(<Composer />);
    const textarea = screen.getByRole('textbox');

    fireEvent.change(textarea, { target: { value: '$skill' } });
    fireEvent.click(await screen.findByRole('button', { name: /test-plugin:test-skill/ }));

    fireEvent.change(textarea, {
      target: { value: '$test-plugin:test-skill $echo' },
    });
    fireEvent.click(await screen.findByRole('button', { name: /test-mcp\.echo_message/ }));
    fireEvent.change(textarea, {
      target: { value: '$test-plugin:test-skill $test-mcp.echo_message 请执行' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));

    await waitFor(() => expect(sendComposer).toHaveBeenCalledWith(
      '$test-plugin:test-skill $test-mcp.echo_message 请执行',
      [],
      [],
      [{
        name: 'test-plugin:test-skill',
        path: '/whale/plugins/test/skills/test-skill/SKILL.md',
      }],
      [{ server: 'test-mcp', name: 'echo_message' }],
      [],
    ));
  });
});
