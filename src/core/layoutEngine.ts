/**
 * Genkou Layout Engine (原稿用紙マス目割り付け・禁則処理エンジン)
 * トークン列を1行 N マス × M 行の原稿用紙グリッドへ割り付け、20マス目の句読点・閉じ括弧ぶら下げを行う。
 */

import { GridCellToken, ParsedParagraph, parseDocument } from './parser';

export const HANGING_PUNCTUATION_SET = new Set<string>([
  '、',
  '。',
  '，',
  '．',
  '」',
  '』',
  '）',
  '】',
  '〉',
  '》',
  '〕',
  '］',
  '｝',
  '”',
  '’',
]);

export function isHangingChar(ch: string): boolean {
  return HANGING_PUNCTUATION_SET.has(ch);
}

export interface GenkouCell {
  cellIndex: number; // 0 .. charsPerLine - 1
  token: GridCellToken | null;
  hangingTokens: GridCellToken[]; // 20マス目に同居・ぶら下げされた句読点・閉じ括弧
  targetRawOffset: number; // 空セルクリック時などにカーソルを移動するrawオフセット
}

export interface GenkouLine {
  globalLineIndex: number;
  pageIndex: number;
  lineIndexInPage: number; // 0 .. linesPerPage - 1
  paragraphIndex: number; // 空の余白行の場合は -1
  isParagraphEnd: boolean;
  lineStartRawOffset: number;
  lineEndRawOffset: number;
  cells: GenkouCell[];
}

export interface GenkouPageLayout {
  pageIndex: number; // 0-indexed (表示時は +1)
  lines: GenkouLine[]; // 常に linesPerPage 行を持つ
}

export interface DocumentLayoutResult {
  pages: GenkouPageLayout[];
  totalLinesUsed: number; // 実際に原稿が存在する行数
  totalPages: number;
  paragraphs: ParsedParagraph[];
}

/**
 * 1つの段落（ParsedParagraph）を 1行 charsPerLine マスの行配列に分割する（禁則ぶら下げ処理込み）
 */
export function layoutParagraph(
  paragraph: ParsedParagraph,
  charsPerLine: number,
  startingGlobalLineIndex: number
): Omit<GenkouLine, 'pageIndex' | 'lineIndexInPage'>[] {
  const { tokens, paragraphIndex, rawLineStart, rawLineEnd } = paragraph;

  // 空行（改行のみの段落）でも原稿用紙上は1行分の空マスを消費する
  if (tokens.length === 0) {
    const emptyCells: GenkouCell[] = [];
    for (let c = 0; c < charsPerLine; c++) {
      emptyCells.push({
        cellIndex: c,
        token: null,
        hangingTokens: [],
        targetRawOffset: rawLineStart,
      });
    }
    return [
      {
        globalLineIndex: startingGlobalLineIndex,
        paragraphIndex,
        isParagraphEnd: true,
        lineStartRawOffset: rawLineStart,
        lineEndRawOffset: rawLineEnd,
        cells: emptyCells,
      },
    ];
  }

  const lines: Omit<GenkouLine, 'pageIndex' | 'lineIndexInPage'>[] = [];
  let tokenIdx = 0;
  let currentGlobalLine = startingGlobalLineIndex;

  while (tokenIdx < tokens.length) {
    const lineTokens = tokens.slice(tokenIdx, tokenIdx + charsPerLine);
    tokenIdx += lineTokens.length;

    const cells: GenkouCell[] = [];
    for (let c = 0; c < charsPerLine; c++) {
      const tok = lineTokens[c] ?? null;
      cells.push({
        cellIndex: c,
        token: tok,
        hangingTokens: [],
        targetRawOffset: tok ? tok.rawStart : rawLineEnd,
      });
    }

    // 行末（charsPerLine マス目）が埋まっており、直後の文字が行頭禁則文字（、。」等）の場合は
    // 最大2文字（例: 。」）まで20マス目に同居（ぶら下げ）させる
    if (lineTokens.length === charsPerLine && tokenIdx < tokens.length) {
      const lastCell = cells[charsPerLine - 1];
      let hangCount = 0;
      while (
        tokenIdx < tokens.length &&
        hangCount < 2 &&
        isHangingChar(tokens[tokenIdx].char) &&
        !tokens[tokenIdx].ruby
      ) {
        lastCell.hangingTokens.push(tokens[tokenIdx]);
        tokenIdx++;
        hangCount++;
      }
    }

    const firstToken = lineTokens[0];
    const lastCellWithToken = cells[lineTokens.length - 1];
    const lastHanging =
      lastCellWithToken.hangingTokens[lastCellWithToken.hangingTokens.length - 1];
    const lineEndOffset = lastHanging
      ? lastHanging.rawEnd
      : lastCellWithToken.token
        ? lastCellWithToken.token.rawEnd
        : rawLineEnd;

    lines.push({
      globalLineIndex: currentGlobalLine++,
      paragraphIndex,
      isParagraphEnd: tokenIdx >= tokens.length,
      lineStartRawOffset: firstToken ? firstToken.rawStart : rawLineStart,
      lineEndRawOffset: lineEndOffset,
      cells,
    });
  }

  return lines;
}

/**
 * ドキュメント全体を原稿用紙のページ（charsPerLine × linesPerPage）に割り付ける
 */
export function layoutDocument(
  text: string,
  charsPerLine: number = 20,
  linesPerPage: number = 20
): DocumentLayoutResult {
  const safeCharsPerLine = Math.max(5, Math.min(100, Math.floor(charsPerLine || 20)));
  const safeLinesPerPage = Math.max(4, Math.min(100, Math.floor(linesPerPage || 20)));

  const paragraphs = parseDocument(text);
  const rawLines: Omit<GenkouLine, 'pageIndex' | 'lineIndexInPage'>[] = [];

  for (const para of paragraphs) {
    const paraLines = layoutParagraph(para, safeCharsPerLine, rawLines.length);
    rawLines.push(...paraLines);
  }

  const totalLinesUsed = rawLines.length;
  const totalPages = Math.max(1, Math.ceil(totalLinesUsed / safeLinesPerPage));
  const pages: GenkouPageLayout[] = [];
  const docEndOffset = text.length;

  for (let p = 0; p < totalPages; p++) {
    const pageLines: GenkouLine[] = [];
    for (let l = 0; l < safeLinesPerPage; l++) {
      const globalIdx = p * safeLinesPerPage + l;
      const existing = rawLines[globalIdx];
      if (existing) {
        pageLines.push({
          ...existing,
          pageIndex: p,
          lineIndexInPage: l,
        });
      } else {
        // 未入力の余白行（原稿用紙の空マスとして常時描画する）
        const emptyCells: GenkouCell[] = [];
        for (let c = 0; c < safeCharsPerLine; c++) {
          emptyCells.push({
            cellIndex: c,
            token: null,
            hangingTokens: [],
            targetRawOffset: docEndOffset,
          });
        }
        pageLines.push({
          globalLineIndex: globalIdx,
          pageIndex: p,
          lineIndexInPage: l,
          paragraphIndex: -1,
          isParagraphEnd: false,
          lineStartRawOffset: docEndOffset,
          lineEndRawOffset: docEndOffset,
          cells: emptyCells,
        });
      }
    }
    pages.push({
      pageIndex: p,
      lines: pageLines,
    });
  }

  return {
    pages,
    totalLinesUsed,
    totalPages,
    paragraphs,
  };
}
