import { describe, expect, it } from 'vitest';
import { JsonlFramer } from '../../src/main/jsonl';

describe('JsonlFramer', () => {
  it('frames split and combined JSONL chunks without losing order', () => {
    const framer = new JsonlFramer();
    expect(framer.push('{"id":1')).toEqual([]);
    expect(framer.push('}\n{"id":2}\n\n{"id":')).toEqual(['{"id":1}', '{"id":2}', '']);
    expect(framer.push('3}\r\n')).toEqual(['{"id":3}']);
    expect(framer.finish()).toEqual([]);
  });

  it('returns a final unterminated line on stream end', () => {
    const framer = new JsonlFramer();
    framer.push('{"method":"warning"}');
    expect(framer.finish()).toEqual(['{"method":"warning"}']);
    expect(framer.finish()).toEqual([]);
  });
});
