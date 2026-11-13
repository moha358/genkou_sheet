import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseLineToTokens, parseDocument } from '../../src/core/parser';
import { layoutDocument } from '../../src/core/layoutEngine';
import { countManuscript } from '../../src/core/counter';
import { buildCssVariables, DEFAULT_GENKOU_CONFIG } from '../../src/core/theme';

describe('AozoraParser (ルビ・傍点・会話文解析)', () => {
  it('明示的ルビ記法 ｜漢字《かんじ》 は親文字の2マスのみを消費する', () => {
    const { tokens } = parseLineToTokens('｜漢字《かんじ》を書く');
    assert.equal(tokens.length, 5);
    assert.equal(tokens.map((t) => t.char).join(''), '漢字を書く');
    assert.equal(tokens[0].cellRuby, 'かん');
    assert.equal(tokens[1].cellRuby, 'じ');
    assert.equal(tokens[0].ruby?.baseText, '漢字');
    assert.equal(tokens[0].ruby?.rubyText, 'かんじ');
    assert.equal(tokens[0].rawStart, 0);
    assert.equal(tokens[1].rawEnd, '｜漢字《かんじ》'.length);
  });

  it('自動漢字判定ルビ（ひらがな＋漢字《ルビ》）で漢字部分のみを親文字にする', () => {
    const { tokens } = parseLineToTokens('これは原稿用紙《げんこうようし》です');
    assert.equal(tokens.map((t) => t.char).join(''), 'これは原稿用紙です');
    assert.equal(tokens[2].ruby, undefined); // 'は'
    assert.equal(tokens[3].char, '原');
    assert.equal(tokens[3].cellRuby, 'げん');
    assert.equal(tokens[4].char, '稿');
    assert.equal(tokens[4].cellRuby, 'こう');
    assert.equal(tokens[5].char, '用');
    assert.equal(tokens[5].cellRuby, 'よう');
    assert.equal(tokens[6].char, '紙');
    assert.equal(tokens[6].cellRuby, 'し');
    assert.equal(tokens[7].ruby, undefined); // 'で'
  });

  it('傍点記法 《《強調》》 は制御記号を除いた文字数分のマスを消費し bouten フラグを付与する', () => {
    const { tokens } = parseLineToTokens('ここは《《重要》》だ');
    assert.equal(tokens.map((t) => t.char).join(''), 'ここは重要だ');
    assert.equal(tokens[2].bouten, false);
    assert.equal(tokens[3].bouten, true);
    assert.equal(tokens[4].bouten, true);
    assert.equal(tokens[5].bouten, false);
  });

  it('会話文（「…」）のセルに isDialogue フラグを付与する', () => {
    const { tokens } = parseLineToTokens('彼は「こんにちは」と言った。');
    assert.equal(tokens[1].isDialogue, false); // 'は'
    assert.equal(tokens[2].char, '「');
    assert.equal(tokens[2].isDialogue, true);
    assert.equal(tokens[3].char, 'こ');
    assert.equal(tokens[3].isDialogue, true);
    assert.equal(tokens[8].char, '」');
    assert.equal(tokens[8].isDialogue, true);
    assert.equal(tokens[9].char, 'と');
    assert.equal(tokens[9].isDialogue, false);
  });
});

describe('GenkouLayoutEngine (マス目割り付け・20マス目禁則ぶら下げ)', () => {
  it('20文字ちょうどの直後に句読点「。」が来た場合、次行へ送らず20マス目にぶら下げる', () => {
    const twentyChars = 'あいうえおかきくけこさしすせそたちつてと';
    const text = `${twentyChars}。`;
    const layout = layoutDocument(text, 20, 20);

    assert.equal(layout.totalLinesUsed, 1);
    const firstLine = layout.pages[0].lines[0];
    const cell20 = firstLine.cells[19];
    assert.equal(cell20.token?.char, 'と');
    assert.equal(cell20.hangingTokens.length, 1);
    assert.equal(cell20.hangingTokens[0].char, '。');
  });

  it('20文字の直後に「。」」が連続した場合も20マス目に同居し、続く文字は次の行へ送る', () => {
    const twentyChars = '「あいうえおかきくけこさしすせそたちつて';
    const text = `${twentyChars}。」次の行`;
    const layout = layoutDocument(text, 20, 20);

    assert.equal(layout.totalLinesUsed, 2);
    const line1 = layout.pages[0].lines[0];
    const line2 = layout.pages[0].lines[1];

    assert.equal(
      line1.cells[19].hangingTokens.map((t) => t.char).join(''),
      '。」'
    );
    assert.equal(line2.cells[0].token?.char, '次');
  });

  it('未入力時でも1ページ（20行×20マス）の空原稿用紙グリッドを返す', () => {
    const layout = layoutDocument('', 20, 20);
    assert.equal(layout.pages.length, 1);
    assert.equal(layout.pages[0].lines.length, 20);
    assert.equal(layout.pages[0].lines[0].cells.length, 20);
    assert.equal(layout.pages[0].lines[0].cells[0].token, null);
  });
});

describe('ManuscriptCounter (文字数・原稿用紙換算カウント)', () => {
  it('ルビ記法と全角スペース字下げを区別して正確に集計する', () => {
    const text = '　吾輩《わがはい》は猫である。\n　名前はまだ無い。';
    const stats = countManuscript(text, 20, 20);

    // 1行目: '　'(1) + '吾輩は猫である。'(8) = 9マス (実文字8)
    // 2行目: '　'(1) + '名前はまだ無い。'(8) = 9マス (実文字8)
    assert.equal(stats.effectiveChars, 16);
    assert.equal(stats.charsWithSpaces, 18);
    assert.equal(stats.sheets400, 1);
    assert.equal(stats.layoutLines, 2);
    assert.equal(stats.paragraphCount, 2);
  });
});

describe('GlobalThemeTokens (CSS Variables 生成)', () => {
  it('緑・赤・ダークの各テーマに応じたCSS変数を出力する', () => {
    const greenCss = buildCssVariables({ ...DEFAULT_GENKOU_CONFIG, gridColor: 'green' });
    const redCss = buildCssVariables({ ...DEFAULT_GENKOU_CONFIG, gridColor: 'red' });
    assert.ok(greenCss.includes('--genkou-grid-primary: #3b8c66;'));
    assert.ok(redCss.includes('--genkou-grid-primary: #b84a39;'));
  });
});
