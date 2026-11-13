import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeMinimalEdit } from '../../src/core/textDiff';

describe('computeMinimalEdit (差分のみの置換)', () => {
  const apply = (oldText: string, newText: string) => {
    const e = computeMinimalEdit(oldText, newText);
    return e ? oldText.slice(0, e.start) + e.text + oldText.slice(e.end) : oldText;
  };

  it('変更箇所だけを置換範囲にする', () => {
    assert.deepEqual(computeMinimalEdit('吾輩は猫である', '吾輩は犬である'), { start: 3, end: 4, text: '犬' });
    assert.equal(computeMinimalEdit('同じ', '同じ'), null);
  });

  it('CRLF とサロゲートペアの途中で範囲を切らない', () => {
    for (const [a, b] of [
      ['一\r\n二', '一\r\r\n二'],
      ['一\r\n二', '一\n二'],
      ['𠮷野家', '𠮟野家'],
      ['a\r\nb', 'a\r\n\r\nb'],
    ]) {
      const e = computeMinimalEdit(a, b)!;
      assert.equal(apply(a, b), b);
      assert.ok(!(a[e.start - 1] === '\r' && a[e.start] === '\n'));
      assert.ok(!(a[e.end - 1] === '\r' && a[e.end] === '\n'));
    }
  });
});
