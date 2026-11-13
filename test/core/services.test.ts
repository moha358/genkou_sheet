import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  enableGenkouInFolder,
  disableGenkouInFolder,
  isFolderGenkouEnabled,
  getOrderedManuscriptFiles,
  moveManuscriptFileOrder,
} from '../../src/services/workspaceService';
import { generateManuscriptHtml } from '../../src/services/exportService';
import { DEFAULT_GENKOU_CONFIG } from '../../src/core/theme';

describe('WorkspaceService (対象フォルダー限定の有効化・解除・順序管理)', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'genkou-test-'));
    fs.writeFileSync(path.join(tempDir, 'chapter1.txt'), '　第一章の本文です。', 'utf-8');
    fs.writeFileSync(path.join(tempDir, 'chapter2.md'), '　第二章の本文です。', 'utf-8');
    fs.writeFileSync(path.join(tempDir, 'README.md'), '# Ignored README', 'utf-8');
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('初期状態では対象フォルダーは無効（他プロジェクト非干渉）である', () => {
    assert.equal(isFolderGenkouEnabled(tempDir), false);
  });

  it('enableGenkouInFolder 実行時のみ .vscode/settings.json と .genkou.json を構成し、解除で元に戻る', () => {
    enableGenkouInFolder(tempDir);
    assert.equal(isFolderGenkouEnabled(tempDir), true);

    const settingsPath = path.join(tempDir, '.vscode', 'settings.json');
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    assert.equal(settings['genkouSheet.enabled'], true);
    assert.equal(settings['workbench.editorAssociations']['*.txt'], 'genkouSheet.editor');
    assert.equal(settings['workbench.editorAssociations']['*.md'], 'genkouSheet.editor');

    // README.md は原稿リストから除外され、chapter1.txt と chapter2.md のみが順序管理される
    const files = getOrderedManuscriptFiles(tempDir);
    assert.deepEqual(files, ['chapter1.txt', 'chapter2.md']);

    // 順序の入れ替え検証
    const reordered = moveManuscriptFileOrder(tempDir, 'chapter2.md', 'up');
    assert.deepEqual(reordered, ['chapter2.md', 'chapter1.txt']);

    // 解除検証
    disableGenkouInFolder(tempDir);
    assert.equal(isFolderGenkouEnabled(tempDir), false);
  });
});

describe('ExportService (組版HTML / PDF印刷用出力)', () => {
  it('ルビ・禁則ぶら下げ・グローバルテーマ変数を含むHTMLを生成する', () => {
    const html = generateManuscriptHtml(
      'テスト小説',
      '　吾輩《わがはい》は猫である。',
      DEFAULT_GENKOU_CONFIG
    );
    assert.ok(html.includes('テスト小説'));
    assert.ok(html.includes('--genkou-grid-primary'));
    assert.ok(html.includes('class="genkou-ruby"'));
    assert.ok(html.includes('わが'));
  });
});
