import { describe, expect, it } from 'vitest';
import { Virtualizer, type VirtualizerOptions } from '@tanstack/react-virtual';

// Exercise the actual virtualizer; a mocked height-only list cannot detect
// prepend anchoring being confused with simultaneous streaming at the end.
describe('conversation virtual item anchoring', () => {
  it('preserves the visible key across prepend plus append and later height measurement', () => {
    const element = document.createElement('div');
    let reportOffset: (offset: number, scrolling: boolean) => void = () => undefined;
    let keys = ['a', 'b', 'c', 'd', 'e'];
    const options = (): VirtualizerOptions<HTMLDivElement, HTMLDivElement> => ({
      count: keys.length, getItemKey: ((snapshot) => (index) => snapshot[index])(keys),
      getScrollElement: () => element, estimateSize: () => 100,
      anchorTo: 'end', followOnAppend: false, scrollEndThreshold: -1,
      initialRect: { width: 600, height: 200 },
      observeElementRect: (_instance, callback) => { callback({ width: 600, height: 200 }); },
      observeElementOffset: (_instance, callback) => { reportOffset = callback; callback(0, false); },
      scrollToFn: (offset, { adjustments = 0 }) => { element.scrollTop = offset + adjustments; },
      onChange: () => undefined,
    });
    const virtualizer = new Virtualizer(options());
    const cleanup = virtualizer._didMount();
    virtualizer._willUpdate();
    virtualizer.getVirtualItems();
    reportOffset(120, true); // 20px into b.
    keys = ['older-1', 'older-2', ...keys, 'new-stream'];
    virtualizer.setOptions(options()); virtualizer._willUpdate();
    expect(element.scrollTop).toBe(320);
    expect(virtualizer.getVirtualItemForOffset(320)?.key).toBe('b');
    reportOffset(320, false);
    virtualizer.resizeItem(keys.indexOf('new-stream'), 900);
    expect(element.scrollTop).toBe(320); // Growth below must not move the reader.
    virtualizer.resizeItem(0, 140);
    expect(element.scrollTop).toBe(360); // Above-viewport correction only.
    expect(virtualizer.getVirtualItemForOffset(360)?.key).toBe('b');
    cleanup();
  });
});
