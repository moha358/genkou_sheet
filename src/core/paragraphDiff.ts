/**
 * Paragraph Diff (段落単位の差分)
 * 2つの原稿を改行区切りの段落で比較し、変更・追加・削除された段落の番号を左右それぞれについて返す純粋関数。
 * 段落番号は parser.ts の paragraphIndex（/\r?\n/ で分割した行番号）と一致する。
 */

export interface ParagraphDiffResult {
  /** 左（旧）側で、右に同じ段落が対応しないもの */
  left: Set<number>;
  /** 右（新）側で、左に同じ段落が対応しないもの */
  right: Set<number>;
}

/** 共通部分を除いた残りがこれを超える場合は LCS を諦め、残り全体を変更扱いにする（メモリ保護） */
const MAX_LCS_CELLS = 4_000_000;

export function diffParagraphs(leftText: string, rightText: string): ParagraphDiffResult {
  const a = leftText.split(/\r?\n/);
  const b = rightText.split(/\r?\n/);
  const left = new Set<number>();
  const right = new Set<number>();

  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const n = endA - start;
  const m = endB - start;
  if (n === 0 && m === 0) return { left, right };

  if (n === 0 || m === 0 || (n + 1) * (m + 1) > MAX_LCS_CELLS) {
    for (let i = start; i < endA; i++) left.add(i);
    for (let j = start; j < endB; j++) right.add(j);
    return { left, right };
  }

  // LCS 長の表（後ろから埋める）
  const width = m + 1;
  const table = new Int32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i * width + j] =
        a[start + i] === b[start + j]
          ? table[(i + 1) * width + j + 1] + 1
          : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    }
  }

  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[start + i] === b[start + j]) {
      i++;
      j++;
    } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
      left.add(start + i++);
    } else {
      right.add(start + j++);
    }
  }
  while (i < n) left.add(start + i++);
  while (j < m) right.add(start + j++);
  return { left, right };
}
