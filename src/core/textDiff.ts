/**
 * Minimal Text Edit (差分の最小置換範囲の計算)
 * Webview から届いた全文と現在の文書を比較し、変更された範囲だけを置き換えるための純粋関数。
 */

export interface MinimalTextEdit {
  start: number;
  end: number; // oldText 上の終了オフセット（排他的）
  text: string;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/** 位置 i が CRLF の間、またはサロゲートペアの間にあるか */
function splitsUnit(s: string, i: number): boolean {
  if (i <= 0 || i >= s.length) return false;
  return (s[i - 1] === '\r' && s[i] === '\n') || isLowSurrogate(s.charCodeAt(i));
}

/**
 * 共通の先頭・末尾を除いた置換範囲を返す。変更が無い場合は null。
 * CRLF やサロゲートペアの途中で範囲が切れないよう境界を調整する。
 */
export function computeMinimalEdit(oldText: string, newText: string): MinimalTextEdit | null {
  if (oldText === newText) return null;
  const maxPrefix = Math.min(oldText.length, newText.length);
  let prefix = 0;
  while (prefix < maxPrefix && oldText.charCodeAt(prefix) === newText.charCodeAt(prefix)) prefix++;
  while (prefix > 0 && (splitsUnit(oldText, prefix) || splitsUnit(newText, prefix))) prefix--;

  const maxSuffix = maxPrefix - prefix;
  let suffix = 0;
  while (
    suffix < maxSuffix &&
    oldText.charCodeAt(oldText.length - 1 - suffix) === newText.charCodeAt(newText.length - 1 - suffix)
  ) suffix++;
  while (
    suffix > 0 &&
    (splitsUnit(oldText, oldText.length - suffix) || splitsUnit(newText, newText.length - suffix))
  ) suffix--;

  return {
    start: prefix,
    end: oldText.length - suffix,
    text: newText.slice(prefix, newText.length - suffix),
  };
}
