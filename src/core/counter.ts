/**
 * Manuscript Character & Sheet Counter (文字数・原稿用紙換算枚数カウンター)
 * 原稿の集計指標（ルビ除外実文字数・空白込み文字数・400字詰め換算枚数・実使用行数）を算出する。
 */

import { layoutDocument } from './layoutEngine';

export interface ManuscriptStats {
  /** ルビ・制御記号・空白・改行を除いた純粋な文字数 */
  effectiveChars: number;
  /** ルビ・制御記号・改行を除き、空白（全角字下げ等）を含めた文字数 */
  charsWithSpaces: number;
  /** 400字詰め原稿用紙換算枚数（空白込み文字数 ÷ 400 の切り上げ） */
  sheets400: number;
  /** 実組版上の使用ページ数 */
  layoutPages: number;
  /** 実組版上の使用総行数 */
  layoutLines: number;
  /** 段落数 */
  paragraphCount: number;
}

const WHITESPACE_REGEX = /^[\s\u3000]+$/;

export function countManuscript(
  text: string,
  charsPerLine: number = 20,
  linesPerPage: number = 20
): ManuscriptStats {
  if (!text || text.length === 0) {
    return {
      effectiveChars: 0,
      charsWithSpaces: 0,
      sheets400: 0,
      layoutPages: 1,
      layoutLines: 0,
      paragraphCount: 0,
    };
  }

  const layout = layoutDocument(text, charsPerLine, linesPerPage);
  let effectiveChars = 0;
  let charsWithSpaces = 0;

  for (const para of layout.paragraphs) {
    for (const token of para.tokens) {
      charsWithSpaces += 1;
      if (!WHITESPACE_REGEX.test(token.char)) {
        effectiveChars += 1;
      }
    }
  }

  const sheets400 = charsWithSpaces === 0 ? 0 : Math.ceil(charsWithSpaces / 400);

  return {
    effectiveChars,
    charsWithSpaces,
    sheets400,
    layoutPages: layout.totalPages,
    layoutLines: layout.totalLinesUsed,
    paragraphCount: layout.paragraphs.length,
  };
}
