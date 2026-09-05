import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversationList } from '../../src/renderer/components/ConversationList';

const fixture = vi.hoisted(() => ({
  items: [{ id: 'message', type: 'agentMessage', text: 'hello' }],
  state: {} as Record<string, any>,
  height: 1000,
}));
vi.mock('../../src/renderer/state/store', () => ({ useAppStore: (select: (state: any) => unknown) => select(fixture.state) }));
vi.mock('../../src/renderer/state/conversation', () => ({ itemsForThread: () => fixture.items }));
vi.mock('../../src/renderer/components/ItemCard', () => ({ ItemCard: () => null }));
vi.mock('@tanstack/react-virtual', () => ({ useVirtualizer: () => ({
  getTotalSize: () => fixture.height, getVirtualItems: () => [], measureElement: () => undefined,
}) }));

let frames: Map<number, FrameRequestCallback>;
let sequence = 0;
const flushFrames = () => act(() => {
  const pending = [...frames.values()];
  frames.clear();
  pending.forEach((callback) => callback(0));
});
beforeEach(() => {
  frames = new Map();
  fixture.height = 1000;
  fixture.items = [{ id: 'message', type: 'agentMessage', text: 'hello' }];
  fixture.state = { conversation: { threads: {} }, selectedThreadId: 'one', approvals: [], branding: { name: 'Whale' },
    historyByThread: {}, busy: false, loadOlderHistory: vi.fn() };
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    const id = ++sequence; frames.set(id, callback); return id;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => { frames.delete(id); });
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(() => fixture.height);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(500);
  // jsdom does not implement browser clamping for scrollTop.
  const offsets = new WeakMap<HTMLElement, number>();
  vi.spyOn(Element.prototype, 'scrollTop', 'get').mockImplementation(function (this: HTMLElement) { return offsets.get(this) ?? 0; });
  vi.spyOn(Element.prototype, 'scrollTop', 'set').mockImplementation(function (this: HTMLElement, value: number) {
    offsets.set(this, Math.max(0, Math.min(value, fixture.height - 500)));
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('conversation scroll ownership', () => {
  it('lets an upward wheel cancel a queued bottom correction before its scroll event', () => {
    const { container, rerender } = render(<ConversationList />);
    const element = container.querySelector('.conversation-scroll') as HTMLElement;
    expect(element.scrollTop).toBe(500);
    fireEvent.wheel(element, { deltaY: -20 });
    element.scrollTop = 480;
    flushFrames();
    fixture.items[0].text = 'streamed update';
    rerender(<ConversationList />);
    flushFrames();
    expect(element.scrollTop).toBe(480);
    expect(screen.getByRole('button', { name: /最新内容/ })).toBeInTheDocument();
  });

  it('does not reattach within 80px of the bottom, but resumes at the actual bottom', () => {
    const { container, rerender } = render(<ConversationList />);
    const element = container.querySelector('.conversation-scroll') as HTMLElement;
    flushFrames();
    fireEvent.wheel(element, { deltaY: -20 });
    element.scrollTop = 480;
    fireEvent.scroll(element);
    fixture.items[0].text = 'more text';
    rerender(<ConversationList />);
    flushFrames();
    expect(element.scrollTop).toBe(480);
    element.scrollTop = 500;
    fireEvent.scroll(element);
    flushFrames();
    expect(screen.queryByRole('button', { name: /最新内容/ })).not.toBeInTheDocument();
    fixture.height = 1200;
    rerender(<ConversationList />);
    flushFrames();
    expect(element.scrollTop).toBe(700);
  });

  it('only follows changed card heights again after explicitly jumping to latest', () => {
    const { container, rerender } = render(<ConversationList />);
    const element = container.querySelector('.conversation-scroll') as HTMLElement;
    flushFrames();
    fireEvent.wheel(element, { deltaY: -200 });
    element.scrollTop = 300;
    fireEvent.scroll(element);
    fixture.height = 1400;
    rerender(<ConversationList />);
    expect(element.scrollTop).toBe(300);
    fireEvent.click(screen.getByRole('button', { name: /最新内容/ }));
    flushFrames();
    expect(element.scrollTop).toBe(900);
  });

  it('preserves movement made while older history is loading', async () => {
    let resolve!: () => void;
    fixture.state.historyByThread = { one: { loaded: true, turnsCursor: 'older', itemsCursor: null } };
    fixture.state.loadOlderHistory = vi.fn(() => new Promise<void>((done) => { resolve = done; }));
    const { container } = render(<ConversationList />);
    const element = container.querySelector('.conversation-scroll') as HTMLElement;
    flushFrames();
    element.scrollTop = 40;
    fireEvent.scroll(element);
    element.scrollTop = 20;
    fixture.height = 1400;
    await act(async () => { resolve(); });
    flushFrames();
    expect(element.scrollTop).toBe(420);
  });

  it('does not apply a pending history offset to a different thread', async () => {
    let resolve!: () => void;
    fixture.state.historyByThread = { one: { loaded: true, turnsCursor: 'older', itemsCursor: null } };
    fixture.state.loadOlderHistory = vi.fn(() => new Promise<void>((done) => { resolve = done; }));
    const { container, rerender } = render(<ConversationList />);
    const element = container.querySelector('.conversation-scroll') as HTMLElement;
    flushFrames();
    element.scrollTop = 40;
    fireEvent.scroll(element);
    expect(fixture.state.loadOlderHistory).toHaveBeenCalledTimes(1);
    fixture.state.selectedThreadId = 'two';
    rerender(<ConversationList />);
    flushFrames();
    fireEvent.wheel(element, { deltaY: -200 });
    element.scrollTop = 300;
    await act(async () => { resolve(); });
    flushFrames();
    expect(element.scrollTop).toBe(300);
  });
});
