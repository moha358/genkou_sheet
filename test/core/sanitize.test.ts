import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_GENKOU_CONFIG, sanitizeGenkouConfig } from '../../src/core/theme';
import { generateManuscriptHtml } from '../../src/services/exportService';

describe('設定値の正規化と出力HTMLの安全性', () => {
  it('不正な設定値を既定値・範囲内に置き換える', () => {
    const cfg = sanitizeGenkouConfig({ writingMode: '"><script>', gridColor: '__proto__', charsPerLine: 0, linesPerPage: 1e9, autoIndent: 'yes' });
    assert.equal(cfg.writingMode, DEFAULT_GENKOU_CONFIG.writingMode);
    assert.equal(cfg.gridColor, DEFAULT_GENKOU_CONFIG.gridColor);
    assert.equal(cfg.charsPerLine, 5);
    assert.equal(cfg.linesPerPage, 100);
    assert.equal(cfg.autoIndent, true);
  });

  it('ワークスペース設定から HTML を注入できない', () => {
    const html = generateManuscriptHtml('t', 'あ', { ...DEFAULT_GENKOU_CONFIG, writingMode: '"><img src=x onerror=alert(1)>' as never });
    assert.ok(!html.includes('<img'));
    assert.ok(html.includes('data-mode="vertical-rl"'));
  });
});
