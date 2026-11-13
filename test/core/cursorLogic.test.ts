import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { layoutDocument } from '../../src/core/layoutEngine';
import {
  deleteBackwardAtOffset,
  getSelectedRangeInfo,
  gridCoordsToRawOffset,
  insertNewlineAtOffset,
  insertTextAtOffset,
  isCellInSelection,
  moveCursorByKey,
  rawOffsetToGridCoords,
} from '../../src/core/cursorLogic';

describe('CursorLogic (カーソル座標変換・縦書き矢印キー移動・自動字下げ)', () => {
  it('縦書き (vertical-rl) 時は ArrowDown で次のマス、ArrowLeft で次の行へ移動する', () => {
    const layout = layoutDocument('あいうえお\nかきくけこ', 20, 20);
    const start = { globalLineIndex: 0, cellIndex: 0 };

    // 縦書きで下矢印 → 同じ行の1マス下 (cellIndex: 1)
    const down = moveCursorByKey(layout, start, 'ArrowDown', 'vertical-rl');
    assert.deepEqual(down, { globalLineIndex: 0, cellIndex: 1 });

    // 縦書きで左矢印 → 次の行 (globalLineIndex: 1, cellIndex: 1)
    const left = moveCursorByKey(layout, down, 'ArrowLeft', 'vertical-rl');
    assert.deepEqual(left, { globalLineIndex: 1, cellIndex: 1 });

    // 縦書きで右矢印 → 前の行 (globalLineIndex: 0, cellIndex: 1)
    const right = moveCursorByKey(layout, left, 'ArrowRight', 'vertical-rl');
    assert.deepEqual(right, { globalLineIndex: 0, cellIndex: 1 });
  });

  it('Enter 改行時に autoIndent=true なら全角スペースを自動挿入し、直後に「を入力すると字下げを自動解除する', () => {
    const initial = '　最初の段落。';
    const afterEnter = insertNewlineAtOffset(initial, initial.length, true, false);
    assert.equal(afterEnter.newText, '　最初の段落。\n　');

    // 直後に会話文の「を入力すると、行頭の全角スペースが「に置き換わる
    const afterBracket = insertTextAtOffset(
      afterEnter.newText,
      afterEnter.newOffset,
      '「こんにちは」',
      true
    );
    assert.equal(afterBracket.newText, '　最初の段落。\n「こんにちは」');
  });

  it('ルビを含むテキストでも rawOffset と GridCoords が正確に双方向変換される', () => {
    const text = '｜漢字《かんじ》テスト';
    const layout = layoutDocument(text, 20, 20);

    // 'テ' の開始位置は '｜漢字《かんじ》'.length (9)
    const teOffset = '｜漢字《かんじ》'.length;
    const coords = rawOffsetToGridCoords(layout, teOffset);
    assert.deepEqual(coords, { globalLineIndex: 0, cellIndex: 2 });

    const roundTrip = gridCoordsToRawOffset(layout, coords);
    assert.equal(roundTrip, teOffset);
  });

  it('Backspace でサロゲートペア文字も1文字単位で安全に削除する', () => {
    const text = 'あ𠮷い';
    const afterDel = deleteBackwardAtOffset(text, 'あ𠮷'.length);
    assert.equal(afterDel.newText, 'あい');
  });

  it('Shift選択（複数マス選択）時に選択された全文字を親文字として抽出しルビ対象範囲を返す', () => {
    const text = 'これは原稿用紙です';
    const layout = layoutDocument(text, 20, 20);

    // 「原」(cellIndex: 3) から 「紙」(cellIndex: 6) までを選択
    const anchor = { globalLineIndex: 0, cellIndex: 3 };
    const focus = { globalLineIndex: 0, cellIndex: 6 };

    assert.equal(isCellInSelection({ globalLineIndex: 0, cellIndex: 2 }, anchor, focus), false);
    assert.equal(isCellInSelection({ globalLineIndex: 0, cellIndex: 4 }, anchor, focus), true);
    assert.equal(isCellInSelection({ globalLineIndex: 0, cellIndex: 6 }, anchor, focus), true);

    const selInfo = getSelectedRangeInfo(layout, text, anchor, focus);
    assert.equal(selInfo.hasMultiSelection, true);
    assert.equal(selInfo.baseText, '原稿用紙');
    assert.equal(text.slice(selInfo.rawStart, selInfo.rawEnd), '原稿用紙');
  });
});
