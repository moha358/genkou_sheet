/**
 * Aozora Bunko Format Parser (青空文庫形式ルビ・傍点・会話文パーサー)
 * プレーンテキストを解析し、原稿用紙の1マスに対応する論理トークン (GridCellToken) へ変換する。
 */

export interface RubyGroupInfo {
  baseText: string;
  rubyText: string;
  groupRawStart: number;
  groupRawEnd: number;
  indexInGroup: number;
  groupLength: number;
}

export interface GridCellToken {
  char: string;
  rawStart: number;
  rawEnd: number;
  isDialogue: boolean;
  bouten: boolean;
  cellRuby?: string;
  ruby?: RubyGroupInfo;
}

export interface ParsedParagraph {
  paragraphIndex: number;
  rawLineStart: number;
  rawLineEnd: number;
  rawText: string;
  tokens: GridCellToken[];
}

const KANJI_REGEX = /[\u4E00-\u9FFF\u3400-\u4DBF\uF900-\uFAFF々〆ヵヶ]/;

function isKanjiChar(ch: string): boolean {
  return KANJI_REGEX.test(ch);
}

/**
 * 親文字数に合わせてルビ文字列を各セルへ均等に割り振る
 */
export function distributeRubyToCells(baseChars: string[], rubyText: string): string[] {
  const count = baseChars.length;
  if (count === 0) {
    return [];
  }
  if (count === 1) {
    return [rubyText];
  }
  const rubyChars = Array.from(rubyText);
  const result: string[] = new Array(count).fill('');

  if (rubyChars.length <= count) {
    for (let i = 0; i < rubyChars.length; i++) {
      result[i] = rubyChars[i];
    }
    return result;
  }

  let cursor = 0;
  for (let i = 0; i < count; i++) {
    const remainingCells = count - i;
    const remainingRuby = rubyChars.length - cursor;
    const take = Math.ceil(remainingRuby / remainingCells);
    result[i] = rubyChars.slice(cursor, cursor + take).join('');
    cursor += take;
  }
  return result;
}

/**
 * 1行（1段落）のテキストを解析して GridCellToken 配列を生成する
 */
export function parseLineToTokens(
  lineText: string,
  lineRawOffset: number = 0,
  initialDialogueDepth: number = 0
): { tokens: GridCellToken[]; dialogueDepth: number } {
  const tokens: GridCellToken[] = [];
  let dialogueDepth = initialDialogueDepth;

  let i = 0;
  const len = lineText.length;

  while (i < len) {
    const ch = lineText[i];

    // 1. 傍点記法: 《《強調》》
    if (lineText.startsWith('《《', i)) {
      const closeIdx = lineText.indexOf('》》', i + 2);
      if (closeIdx !== -1 && closeIdx > i + 2) {
        const innerText = lineText.slice(i + 2, closeIdx);
        const innerChars = Array.from(innerText);
        let offset = i + 2;
        for (const innerCh of innerChars) {
          if (innerCh === '「' || innerCh === '『') {
            dialogueDepth++;
          }
          const inDialogue = dialogueDepth > 0;
          tokens.push({
            char: innerCh,
            rawStart: lineRawOffset + offset,
            rawEnd: lineRawOffset + offset + innerCh.length,
            isDialogue: inDialogue,
            bouten: true,
          });
          if ((innerCh === '」' || innerCh === '』') && dialogueDepth > 0) {
            dialogueDepth--;
          }
          offset += innerCh.length;
        }
        i = closeIdx + 2;
        continue;
      }
    }

    // 2. 明示的ルビ記法: ｜親文字《ルビ》 または |親文字《ルビ》
    if (ch === '｜' || ch === '|') {
      const openRuby = lineText.indexOf('《', i + 1);
      const closeRuby = openRuby !== -1 ? lineText.indexOf('》', openRuby + 1) : -1;
      // 《《傍点》》 と衝突しないことを確認
      if (
        openRuby !== -1 &&
        closeRuby !== -1 &&
        openRuby > i + 1 &&
        lineText[openRuby + 1] !== '《'
      ) {
        const baseText = lineText.slice(i + 1, openRuby);
        const rubyText = lineText.slice(openRuby + 1, closeRuby);
        const baseChars = Array.from(baseText);
        const distributed = distributeRubyToCells(baseChars, rubyText);
        const groupRawStart = lineRawOffset + i;
        const groupRawEnd = lineRawOffset + closeRuby + 1;

        let charOffset = i + 1;
        baseChars.forEach((baseCh, idx) => {
          const isLast = idx === baseChars.length - 1;
          tokens.push({
            char: baseCh,
            rawStart: idx === 0 ? groupRawStart : lineRawOffset + charOffset,
            rawEnd: isLast ? groupRawEnd : lineRawOffset + charOffset + baseCh.length,
            isDialogue: dialogueDepth > 0,
            bouten: false,
            cellRuby: distributed[idx],
            ruby: {
              baseText,
              rubyText,
              groupRawStart,
              groupRawEnd,
              indexInGroup: idx,
              groupLength: baseChars.length,
            },
          });
          charOffset += baseCh.length;
        });

        i = closeRuby + 1;
        continue;
      }
    }

    // 3. 自動漢字判定ルビ: 漢字《ルビ》
    if (isKanjiChar(ch)) {
      let kanjiEnd = i;
      while (kanjiEnd < len) {
        const codePoint = lineText.codePointAt(kanjiEnd)!;
        const charStr = String.fromCodePoint(codePoint);
        if (isKanjiChar(charStr)) {
          kanjiEnd += charStr.length;
        } else {
          break;
        }
      }
      if (
        kanjiEnd < len &&
        lineText[kanjiEnd] === '《' &&
        lineText[kanjiEnd + 1] !== '《'
      ) {
        const closeRuby = lineText.indexOf('》', kanjiEnd + 1);
        if (closeRuby !== -1 && closeRuby > kanjiEnd + 1) {
          const baseText = lineText.slice(i, kanjiEnd);
          const rubyText = lineText.slice(kanjiEnd + 1, closeRuby);
          const baseChars = Array.from(baseText);
          const distributed = distributeRubyToCells(baseChars, rubyText);
          const groupRawStart = lineRawOffset + i;
          const groupRawEnd = lineRawOffset + closeRuby + 1;

          let charOffset = i;
          baseChars.forEach((baseCh, idx) => {
            const isLast = idx === baseChars.length - 1;
            tokens.push({
              char: baseCh,
              rawStart: idx === 0 ? groupRawStart : lineRawOffset + charOffset,
              rawEnd: isLast ? groupRawEnd : lineRawOffset + charOffset + baseCh.length,
              isDialogue: dialogueDepth > 0,
              bouten: false,
              cellRuby: distributed[idx],
              ruby: {
                baseText,
                rubyText,
                groupRawStart,
                groupRawEnd,
                indexInGroup: idx,
                groupLength: baseChars.length,
              },
            });
            charOffset += baseCh.length;
          });

          i = closeRuby + 1;
          continue;
        }
      }
    }

    // 4. 通常文字（サロゲートペア対応）
    const codePoint = lineText.codePointAt(i)!;
    const charStr = String.fromCodePoint(codePoint);

    if (charStr === '「' || charStr === '『') {
      dialogueDepth++;
    }

    const inDialogue = dialogueDepth > 0;
    tokens.push({
      char: charStr,
      rawStart: lineRawOffset + i,
      rawEnd: lineRawOffset + i + charStr.length,
      isDialogue: inDialogue,
      bouten: false,
    });

    if ((charStr === '」' || charStr === '』') && dialogueDepth > 0) {
      dialogueDepth--;
    }

    i += charStr.length;
  }

  return { tokens, dialogueDepth };
}

/**
 * ドキュメント全体を段落（改行区切り）ごとにパースする
 */
export function parseDocument(text: string): ParsedParagraph[] {
  const paragraphs: ParsedParagraph[] = [];
  let offset = 0;
  let paragraphIndex = 0;
  let dialogueDepth = 0;

  const lines = text.split(/\r?\n/);
  let searchPos = 0;

  for (const line of lines) {
    const lineStart = searchPos;
    const lineEnd = lineStart + line.length;
    const parsed = parseLineToTokens(line, lineStart, 0);
    dialogueDepth = parsed.dialogueDepth;

    paragraphs.push({
      paragraphIndex,
      rawLineStart: lineStart,
      rawLineEnd: lineEnd,
      rawText: line,
      tokens: parsed.tokens,
    });

    paragraphIndex++;
    // 改行コード（\r\n または \n）の長さを進める
    if (text.slice(lineEnd, lineEnd + 2) === '\r\n') {
      searchPos = lineEnd + 2;
    } else if (text.slice(lineEnd, lineEnd + 1) === '\n') {
      searchPos = lineEnd + 1;
    } else {
      searchPos = lineEnd;
    }
    offset = searchPos;
  }

  return paragraphs;
}
