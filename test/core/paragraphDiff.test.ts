import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { diffParagraphs } from '../../src/core/paragraphDiff';

const ids = (s: Set<number>) => [...s].sort((a, b) => a - b);

describe('diffParagraphs (段落単位の差分)', () => {
  it('同じ内容なら変更なし', () => {
    const r = diffParagraphs('一\n二\n三', '一\n二\n三');
    assert.deepEqual([ids(r.left), ids(r.right)], [[], []]);
  });

  it('書き換え・追加・削除された段落の番号を左右それぞれ返す', () => {
    const r = diffParagraphs('一\n二\n三\n四', '一\n弐\n三\n追加\n四');
    assert.deepEqual(ids(r.left), [1]);
    assert.deepEqual(ids(r.right), [1, 3]);
    const del = diffParagraphs('一\n二\n三', '一\n三');
    assert.deepEqual([ids(del.left), ids(del.right)], [[1], []]);
  });

  it('CRLF と LF を同じ段落として扱う', () => {
    const r = diffParagraphs('一\r\n二', '一\n二');
    assert.deepEqual([ids(r.left), ids(r.right)], [[], []]);
  });
});
