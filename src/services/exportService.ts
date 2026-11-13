/**
 * HTML / PDF Print Export Service (組版・原稿用紙HTML/PDF出力サービス)
 * 単一原稿または原稿ツリー全体の結合原稿を、印刷・PDF保存用の自己完結型HTMLとして生成する。
 */

import { layoutDocument } from '../core/layoutEngine';
import { countManuscript } from '../core/counter';
import { buildCssVariables, GenkouConfig } from '../core/theme';

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function generateManuscriptHtml(
  title: string,
  text: string,
  config: GenkouConfig
): string {
  const layout = layoutDocument(text, config.charsPerLine, config.linesPerPage);
  const stats = countManuscript(text, config.charsPerLine, config.linesPerPage);
  const cssVars = buildCssVariables(config);
  const halfLines = Math.floor(config.linesPerPage / 2);

  const pagesHtml = layout.pages
    .map((page) => {
      const firstHalf = page.lines.slice(0, halfLines);
      const secondHalf = page.lines.slice(halfLines);

      const renderLines = (lines: typeof page.lines) =>
        lines
          .map((line) => {
            const cellsHtml = line.cells
              .map((cell) => {
                const tok = cell.token;
                const charHtml = tok ? escapeHtml(tok.char) : '';
                const rubyHtml = tok?.cellRuby
                  ? `<span class="genkou-ruby">${escapeHtml(tok.cellRuby)}</span>`
                  : tok?.bouten
                    ? `<span class="genkou-bouten">﹅</span>`
                    : '';
                const hangingHtml =
                  cell.hangingTokens.length > 0
                    ? `<span class="genkou-hanging">${escapeHtml(
                        cell.hangingTokens.map((h) => h.char).join('')
                      )}</span>`
                    : '';
                const dialogueClass =
                  config.highlightDialogue && tok?.isDialogue ? ' is-dialogue' : '';

                return `<div class="genkou-cell${dialogueClass}">
                  <span class="genkou-char">${charHtml}</span>
                  ${rubyHtml}
                  ${hangingHtml}
                </div>`;
              })
              .join('');

            return `<div class="genkou-line">${cellsHtml}</div>`;
          })
          .join('');

      return `
      <section class="genkou-sheet-page" data-mode="${config.writingMode}">
        <div class="genkou-sheet-frame">
          <div class="genkou-half">${renderLines(firstHalf)}</div>
          <div class="genkou-hashira">
            <div class="genkou-gyobi-top">【</div>
            <div class="genkou-hashira-title">${escapeHtml(title)}</div>
            <div class="genkou-page-num">${page.pageIndex + 1} / ${layout.totalPages}</div>
            <div class="genkou-gyobi-bottom">】</div>
          </div>
          <div class="genkou-half">${renderLines(secondHalf)}</div>
        </div>
      </section>`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(title)} - 原稿用紙出力</title>
  <style>
    :root {
      ${cssVars}
    }
    * {
      box-sizing: border-box;
    }
    body {
      margin: 0;
      padding: var(--genkou-spacing-lg);
      background: var(--genkou-canvas-bg);
      color: var(--genkou-text-main);
      font-family: var(--genkou-font-family);
    }
    .export-header {
      max-width: 960px;
      margin: 0 auto var(--genkou-spacing-lg) auto;
      padding: var(--genkou-spacing-md) var(--genkou-spacing-lg);
      background: var(--genkou-toolbar-bg);
      border: 1px solid var(--genkou-toolbar-border);
      border-radius: var(--genkou-border-radius-md);
      font-family: var(--genkou-ui-font-family);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .export-print-btn {
      background: var(--genkou-accent-color);
      color: #fff;
      border: none;
      padding: 8px 16px;
      border-radius: var(--genkou-border-radius-sm);
      cursor: pointer;
      font-size: 13px;
    }
    .genkou-pages-container {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: var(--genkou-page-gap);
      overflow-x: auto;
    }
    .genkou-sheet-page {
      background: var(--genkou-paper-bg);
      padding: var(--genkou-page-padding);
      box-shadow: var(--genkou-page-shadow);
      border-radius: var(--genkou-border-radius-sm);
      width: max-content;
      margin-left: auto;
      margin-right: auto;
    }
    .genkou-sheet-frame {
      border: var(--genkou-outer-border-width) solid var(--genkou-grid-primary);
      display: flex;
    }
    .genkou-sheet-page[data-mode="vertical-rl"] .genkou-sheet-frame {
      flex-direction: row-reverse;
    }
    .genkou-sheet-page[data-mode="horizontal-tb"] .genkou-sheet-frame {
      flex-direction: column;
    }
    .genkou-half {
      display: flex;
    }
    .genkou-sheet-page[data-mode="vertical-rl"] .genkou-half {
      flex-direction: row-reverse;
    }
    .genkou-sheet-page[data-mode="horizontal-tb"] .genkou-half {
      flex-direction: column;
    }
    .genkou-line {
      display: flex;
      position: relative;
    }
    .genkou-sheet-page[data-mode="vertical-rl"] .genkou-line {
      flex-direction: column;
      margin-left: var(--genkou-ruby-gap);
      border-left: var(--genkou-inner-border-width) solid var(--genkou-grid-primary);
      border-right: var(--genkou-inner-border-width) solid var(--genkou-grid-primary);
    }
    .genkou-sheet-page[data-mode="horizontal-tb"] .genkou-line {
      flex-direction: row;
      margin-top: var(--genkou-ruby-gap);
      border-top: var(--genkou-inner-border-width) solid var(--genkou-grid-primary);
      border-bottom: var(--genkou-inner-border-width) solid var(--genkou-grid-primary);
    }
    .genkou-cell {
      width: var(--genkou-cell-size);
      height: var(--genkou-cell-size);
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;
      font-size: var(--genkou-cell-font-size);
      border: 0.5px solid var(--genkou-grid-sub);
    }
    .genkou-sheet-page[data-mode="vertical-rl"] .genkou-char {
      writing-mode: vertical-rl;
      text-orientation: upright;
    }
    .genkou-cell.is-dialogue .genkou-char {
      color: var(--genkou-text-dialogue);
    }
    .genkou-ruby, .genkou-bouten {
      position: absolute;
      font-size: var(--genkou-ruby-font-size);
      color: var(--genkou-text-ruby);
      line-height: 1;
      white-space: nowrap;
      pointer-events: none;
    }
    .genkou-sheet-page[data-mode="vertical-rl"] .genkou-ruby,
    .genkou-sheet-page[data-mode="vertical-rl"] .genkou-bouten {
      right: calc(-1 * var(--genkou-ruby-gap) - 1px);
      top: 50%;
      transform: translateY(-50%);
      writing-mode: vertical-rl;
    }
    .genkou-sheet-page[data-mode="horizontal-tb"] .genkou-ruby,
    .genkou-sheet-page[data-mode="horizontal-tb"] .genkou-bouten {
      top: calc(-1 * var(--genkou-ruby-gap) - 1px);
      left: 50%;
      transform: translateX(-50%);
    }
    .genkou-hanging {
      position: absolute;
      right: 1px;
      bottom: -8px;
      font-size: var(--genkou-hanging-font-size);
      color: var(--genkou-text-main);
    }
    .genkou-hashira {
      display: flex;
      align-items: center;
      justify-content: space-between;
      color: var(--genkou-grid-primary);
      font-size: 11px;
      padding: 8px 0;
      overflow: hidden;
      flex-shrink: 0;
      border-left: var(--genkou-inner-border-width) solid var(--genkou-grid-primary);
      border-right: var(--genkou-inner-border-width) solid var(--genkou-grid-primary);
    }
    .genkou-sheet-page[data-mode="vertical-rl"] .genkou-hashira {
      width: var(--genkou-hashira-width);
      flex-direction: column;
      writing-mode: horizontal-tb;
      margin-left: var(--genkou-ruby-gap);
    }
    .genkou-sheet-page[data-mode="vertical-rl"] .genkou-hashira > * {
      writing-mode: vertical-rl;
      text-orientation: upright;
      white-space: nowrap;
      line-height: 1;
    }
    .genkou-sheet-page[data-mode="vertical-rl"] .genkou-hashira-title {
      overflow: hidden;
      text-overflow: ellipsis;
      max-height: 45%;
    }
    .genkou-sheet-page[data-mode="horizontal-tb"] .genkou-hashira {
      height: var(--genkou-hashira-width);
      flex-direction: row;
      padding: 0 8px;
      border-left: none;
      border-right: none;
      border-top: var(--genkou-inner-border-width) solid var(--genkou-grid-primary);
      border-bottom: var(--genkou-inner-border-width) solid var(--genkou-grid-primary);
      margin-top: var(--genkou-ruby-gap);
    }
    .genkou-sheet-page[data-mode="horizontal-tb"] .genkou-hashira > * {
      white-space: nowrap;
      line-height: 1;
    }
    @media print {
      body {
        background: #fff;
        padding: 0;
      }
      .export-header {
        display: none;
      }
      .genkou-sheet-page {
        box-shadow: none;
        page-break-after: always;
        break-after: page;
      }
    }
  </style>
</head>
<body>
  <header class="export-header">
    <div>
      <strong>${escapeHtml(title)}</strong> — 実文字数: ${stats.effectiveChars.toLocaleString()}字 / 空白込: ${stats.charsWithSpaces.toLocaleString()}字 / 400字詰換算: ${stats.sheets400}枚（実レイアウト: ${stats.layoutPages}枚・${stats.layoutLines}行）
    </div>
    <button class="export-print-btn" onclick="window.print()">印刷 / PDFとして保存</button>
  </header>
  <main class="genkou-pages-container">
    ${pagesHtml}
  </main>
</body>
</html>`;
}
