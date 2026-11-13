/**
 * Cursor Navigation, Multi-Cell Selection & Direct Input Logic
 * (カーソル位置計算・複数マス範囲選択・直接入力編集ロジック)
 */

import { GridCellToken } from './parser';
import { DocumentLayoutResult } from './layoutEngine';
import { WritingMode } from './theme';

export interface GridCursorCoords {
  globalLineIndex: number;
  cellIndex: number;
}

export interface SelectedRangeInfo {
  hasMultiSelection: boolean;
  rawStart: number;
  rawEnd: number;
  baseText: string;
  existingRubyText: string;
  tokens: GridCellToken[];
}

/**
 * 2つのセル座標の前後関係を比較する (-1: a < b, 0: a == b, 1: a > b)
 */
export function compareGridCoords(a: GridCursorCoords, b: GridCursorCoords): number {
  if (a.globalLineIndex !== b.globalLineIndex) {
    return a.globalLineIndex < b.globalLineIndex ? -1 : 1;
  }
  if (a.cellIndex !== b.cellIndex) {
    return a.cellIndex < b.cellIndex ? -1 : 1;
  }
  return 0;
}

/**
 * アンカー座標とフォーカス座標を正規化し、先頭 (start) と末尾 (end) を返す
 */
export function normalizeSelectionCoords(
  anchor: GridCursorCoords | null,
  focus: GridCursorCoords
): { start: GridCursorCoords; end: GridCursorCoords } {
  if (!anchor || compareGridCoords(anchor, focus) === 0) {
    return { start: focus, end: focus };
  }
  return compareGridCoords(anchor, focus) <= 0
    ? { start: anchor, end: focus }
    : { start: focus, end: anchor };
}

/**
 * 指定セルが選択範囲内に含まれるか判定する
 */
export function isCellInSelection(
  cellCoords: GridCursorCoords,
  anchor: GridCursorCoords | null,
  focus: GridCursorCoords
): boolean {
  const { start, end } = normalizeSelectionCoords(anchor, focus);
  return (
    compareGridCoords(cellCoords, start) >= 0 &&
    compareGridCoords(cellCoords, end) <= 0
  );
}

/**
 * 現在の選択範囲（単一マスまたは複数マス）から対象トークン・親文字・rawオフセット範囲を取得する
 */
export function getSelectedRangeInfo(
  layout: DocumentLayoutResult,
  text: string,
  anchor: GridCursorCoords | null,
  focus: GridCursorCoords
): SelectedRangeInfo {
  const { start, end } = normalizeSelectionCoords(anchor, focus);
  const allLines = layout.pages.flatMap((p) => p.lines);
  const selectedTokens: GridCellToken[] = [];

  for (let l = start.globalLineIndex; l <= end.globalLineIndex; l++) {
    const line = allLines[l];
    if (!line || line.paragraphIndex === -1) {
      continue;
    }
    const cStart = l === start.globalLineIndex ? start.cellIndex : 0;
    const cEnd =
      l === end.globalLineIndex ? end.cellIndex : line.cells.length - 1;

    for (let c = cStart; c <= cEnd; c++) {
      const cell = line.cells[c];
      if (cell?.token) {
        selectedTokens.push(cell.token);
      }
    }
  }

  const hasMultiSelection = compareGridCoords(start, end) !== 0;

  if (selectedTokens.length === 0) {
    const offset = gridCoordsToRawOffset(layout, start);
    return {
      hasMultiSelection: false,
      rawStart: offset,
      rawEnd: offset,
      baseText: '',
      existingRubyText: '',
      tokens: [],
    };
  }

  // 単一マス選択かつ既存のルビグループ上にある場合は、そのルビグループ全体を対象にする
  if (!hasMultiSelection && selectedTokens.length === 1 && selectedTokens[0].ruby) {
    const rubyInfo = selectedTokens[0].ruby;
    return {
      hasMultiSelection: false,
      rawStart: rubyInfo.groupRawStart,
      rawEnd: rubyInfo.groupRawEnd,
      baseText: rubyInfo.baseText,
      existingRubyText: rubyInfo.rubyText,
      tokens: selectedTokens,
    };
  }

  const firstTok = selectedTokens[0];
  const lastTok = selectedTokens[selectedTokens.length - 1];

  const rawStart = firstTok.ruby ? firstTok.ruby.groupRawStart : firstTok.rawStart;
  const rawEnd = lastTok.ruby ? lastTok.ruby.groupRawEnd : lastTok.rawEnd;
  const baseText = selectedTokens.map((t) => t.char).join('');
  const existingRubyText =
    selectedTokens.find((t) => t.ruby)?.ruby?.rubyText ?? '';

  return {
    hasMultiSelection,
    rawStart: Math.max(0, Math.min(text.length, rawStart)),
    rawEnd: Math.max(0, Math.min(text.length, rawEnd)),
    baseText,
    existingRubyText,
    tokens: selectedTokens,
  };
}

/**
 * rawOffset（プレーンテキスト内の文字位置）から原稿用紙上の (globalLineIndex, cellIndex) を求める
 */
export function rawOffsetToGridCoords(
  layout: DocumentLayoutResult,
  rawOffset: number
): GridCursorCoords {
  const allLines = layout.pages.flatMap((p) => p.lines);
  if (allLines.length === 0) {
    return { globalLineIndex: 0, cellIndex: 0 };
  }

  for (const line of allLines) {
    if (line.paragraphIndex === -1) {
      continue;
    }

    for (const cell of line.cells) {
      if (cell.token) {
        if (rawOffset >= cell.token.rawStart && rawOffset < cell.token.rawEnd) {
          return {
            globalLineIndex: line.globalLineIndex,
            cellIndex: cell.cellIndex,
          };
        }
      } else {
        if (line.isParagraphEnd && rawOffset === line.lineEndRawOffset) {
          return {
            globalLineIndex: line.globalLineIndex,
            cellIndex: cell.cellIndex,
          };
        }
        break;
      }
    }

    if (line.isParagraphEnd && rawOffset === line.lineEndRawOffset) {
      return {
        globalLineIndex: line.globalLineIndex,
        cellIndex: line.cells.length - 1,
      };
    }
  }

  const lastUsedIdx = Math.max(0, layout.totalLinesUsed - 1);
  const lastLine = allLines[lastUsedIdx] ?? allLines[0];
  const firstEmptyCell = lastLine.cells.find((c) => c.token === null);
  return {
    globalLineIndex: lastLine.globalLineIndex,
    cellIndex: firstEmptyCell ? firstEmptyCell.cellIndex : lastLine.cells.length - 1,
  };
}

/**
 * 原稿用紙上の (globalLineIndex, cellIndex) から rawOffset を求める
 */
export function gridCoordsToRawOffset(
  layout: DocumentLayoutResult,
  coords: GridCursorCoords
): number {
  const allLines = layout.pages.flatMap((p) => p.lines);
  const clampedLineIdx = Math.max(0, Math.min(allLines.length - 1, coords.globalLineIndex));
  const line = allLines[clampedLineIdx];
  if (!line || line.paragraphIndex === -1) {
    const lastPara = layout.paragraphs[layout.paragraphs.length - 1];
    return lastPara ? lastPara.rawLineEnd : 0;
  }

  const clampedCellIdx = Math.max(0, Math.min(line.cells.length - 1, coords.cellIndex));
  const cell = line.cells[clampedCellIdx];
  if (cell.token) {
    return cell.token.rawStart;
  }
  return line.lineEndRawOffset;
}

/**
 * 矢印キー入力を 書字方向 (vertical-rl / horizontal-tb) に応じた論理移動に変換する
 */
export function moveCursorByKey(
  layout: DocumentLayoutResult,
  currentCoords: GridCursorCoords,
  key: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight',
  writingMode: WritingMode
): GridCursorCoords {
  const allLines = layout.pages.flatMap((p) => p.lines);
  const maxLine = Math.max(0, layout.totalLinesUsed - 1);
  const charsPerLine = allLines[0]?.cells.length ?? 20;

  let { globalLineIndex, cellIndex } = currentCoords;

  let deltaLine = 0;
  let deltaCell = 0;

  if (writingMode === 'vertical-rl') {
    if (key === 'ArrowDown') deltaCell = 1;
    else if (key === 'ArrowUp') deltaCell = -1;
    else if (key === 'ArrowLeft') deltaLine = 1;
    else if (key === 'ArrowRight') deltaLine = -1;
  } else {
    if (key === 'ArrowRight') deltaCell = 1;
    else if (key === 'ArrowLeft') deltaCell = -1;
    else if (key === 'ArrowDown') deltaLine = 1;
    else if (key === 'ArrowUp') deltaLine = -1;
  }

  if (deltaCell !== 0) {
    const nextCell = cellIndex + deltaCell;
    const currentLine = allLines[globalLineIndex];
    const occupiedCount = currentLine
      ? currentLine.cells.filter((c) => c.token !== null).length
      : 0;
    const maxCellInCurrentLine = Math.min(charsPerLine - 1, occupiedCount);

    if (deltaCell > 0) {
      if (nextCell <= maxCellInCurrentLine) {
        cellIndex = nextCell;
      } else if (globalLineIndex < maxLine) {
        globalLineIndex += 1;
        cellIndex = 0;
      }
    } else {
      if (nextCell >= 0) {
        cellIndex = nextCell;
      } else if (globalLineIndex > 0) {
        globalLineIndex -= 1;
        const prevLine = allLines[globalLineIndex];
        const prevOccupied = prevLine
          ? prevLine.cells.filter((c) => c.token !== null).length
          : 0;
        cellIndex = Math.min(charsPerLine - 1, prevOccupied);
      }
    }
  }

  if (deltaLine !== 0) {
    const nextLineIdx = Math.max(0, Math.min(maxLine, globalLineIndex + deltaLine));
    globalLineIndex = nextLineIdx;
    const targetLine = allLines[globalLineIndex];
    const occupiedCount = targetLine
      ? targetLine.cells.filter((c) => c.token !== null).length
      : 0;
    cellIndex = Math.min(cellIndex, Math.min(charsPerLine - 1, occupiedCount));
  }

  return { globalLineIndex, cellIndex };
}

/**
 * テキスト挿入（自動字下げ後の会話括弧「『の字下げ自動解除を含む）
 */
export function insertTextAtOffset(
  text: string,
  rawOffset: number,
  inserted: string,
  autoIndent: boolean
): { newText: string; newOffset: number } {
  const safeOffset = Math.max(0, Math.min(text.length, rawOffset));

  if (
    autoIndent &&
    (inserted.startsWith('「') || inserted.startsWith('『')) &&
    safeOffset >= 1 &&
    text[safeOffset - 1] === '　' &&
    (safeOffset === 1 || text[safeOffset - 2] === '\n')
  ) {
    const before = text.slice(0, safeOffset - 1);
    const after = text.slice(safeOffset);
    const newText = before + inserted + after;
    return {
      newText,
      newOffset: before.length + inserted.length,
    };
  }

  const before = text.slice(0, safeOffset);
  const after = text.slice(safeOffset);
  const newText = before + inserted + after;
  return {
    newText,
    newOffset: safeOffset + inserted.length,
  };
}

/**
 * 改行（Enter）処理（autoIndent 有効時は全角スペースを自動挿入）
 */
export function insertNewlineAtOffset(
  text: string,
  rawOffset: number,
  autoIndent: boolean,
  shiftKey: boolean = false
): { newText: string; newOffset: number } {
  const indent = autoIndent && !shiftKey ? '\n　' : '\n';
  return insertTextAtOffset(text, rawOffset, indent, false);
}

/**
 * Backspace による1単位削除処理（サロゲートペア対応）
 */
export function deleteBackwardAtOffset(
  text: string,
  rawOffset: number
): { newText: string; newOffset: number } {
  if (rawOffset <= 0 || text.length === 0) {
    return { newText: text, newOffset: 0 };
  }
  const safeOffset = Math.min(text.length, rawOffset);
  const before = Array.from(text.slice(0, safeOffset));
  before.pop();
  const newBefore = before.join('');
  const after = text.slice(safeOffset);
  return {
    newText: newBefore + after,
    newOffset: newBefore.length,
  };
}

/**
 * Delete キーによる後方1単位削除処理（サロゲートペア対応）
 */
export function deleteForwardAtOffset(
  text: string,
  rawOffset: number
): { newText: string; newOffset: number } {
  if (rawOffset >= text.length || text.length === 0) {
    return { newText: text, newOffset: rawOffset };
  }
  const safeOffset = Math.max(0, rawOffset);
  const before = text.slice(0, safeOffset);
  const afterChars = Array.from(text.slice(safeOffset));
  afterChars.shift();
  return {
    newText: before + afterChars.join(''),
    newOffset: safeOffset,
  };
}
