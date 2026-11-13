/**
 * Genkou Sheet Page Renderer Component (原稿用紙ページ・グリッド描画コンポーネント)
 */

import { compareGridCoords, isCellInSelection } from '../../core/cursorLogic';
import { DocumentLayoutResult, GenkouCell, GenkouLine } from '../../core/layoutEngine';
import { GenkouConfig } from '../../core/theme';

export interface CellCoordinates {
  globalLineIndex: number;
  cellIndex: number;
}

export interface SheetViewCallbacks {
  onCellClick: (
    coords: CellCoordinates,
    cell: GenkouCell,
    line: GenkouLine,
    cellElement: HTMLElement,
    shiftKey: boolean
  ) => void;
  onCellDragSelect: (
    coords: CellCoordinates,
    cell: GenkouCell,
    line: GenkouLine,
    cellElement: HTMLElement
  ) => void;
  onCellDoubleClick: (
    coords: CellCoordinates,
    cell: GenkouCell,
    line: GenkouLine
  ) => void;
}

export class GenkouSheetRenderer {
  private readonly viewport: HTMLElement;
  private activeCellEl: HTMLElement | null = null;
  private isMouseSelecting: boolean = false;
  private pageObserver: IntersectionObserver | undefined;

  constructor(
    container: HTMLElement,
    private readonly callbacks: SheetViewCallbacks
  ) {
    this.viewport = document.createElement('main');
    this.viewport.className = 'genkou-viewport';
    container.appendChild(this.viewport);

    window.addEventListener('mouseup', () => {
      this.isMouseSelecting = false;
    });
  }

  public getViewportElement(): HTMLElement {
    return this.viewport;
  }

  public getActiveCellElement(): HTMLElement | null {
    return this.activeCellEl;
  }

  public render(
    layout: DocumentLayoutResult,
    config: GenkouConfig,
    cursorCoords: CellCoordinates,
    selectionAnchorCoords: CellCoordinates | null,
    fileName: string
  ): void {
    this.pageObserver?.disconnect();
    const oldScrollTop = this.viewport.scrollTop;
    this.viewport.innerHTML = '';
    this.activeCellEl = null;

    const halfLines = Math.floor(config.linesPerPage / 2);

    // 現在のカーソルがルビ付き文字の上にある場合、同一ルビグループ全体をハイライトする
    const activeLine = layout.pages
      .flatMap((p) => p.lines)
      .find((l) => l.globalLineIndex === cursorCoords.globalLineIndex);
    const activeCell = activeLine?.cells[cursorCoords.cellIndex];
    const activeRubyGroupStart = activeCell?.token?.ruby?.groupRawStart;

    const makePage = (page: DocumentLayoutResult['pages'][number]): HTMLElement => {
      const pageEl = document.createElement('section');
      pageEl.className = 'genkou-sheet-page';
      pageEl.dataset.mode = config.writingMode;

      const frameEl = document.createElement('div');
      frameEl.className = 'genkou-sheet-frame';

      const firstHalfLines = page.lines.slice(0, halfLines);
      const secondHalfLines = page.lines.slice(halfLines);

      frameEl.appendChild(
        this.renderHalfBlock(
          firstHalfLines,
          config,
          cursorCoords,
          selectionAnchorCoords,
          activeRubyGroupStart
        )
      );

      // 中央の柱（魚尾・タイトル・ページ番号）
      const hashiraEl = document.createElement('div');
      hashiraEl.className = 'genkou-hashira';

      const topGyobi = document.createElement('span');
      topGyobi.className = 'genkou-gyobi';
      topGyobi.textContent = '【';

      const hashiraTitle = document.createElement('span');
      hashiraTitle.className = 'genkou-hashira-title';
      hashiraTitle.textContent = fileName;

      const pageNumber = document.createElement('span');
      pageNumber.className = 'genkou-page-num';
      pageNumber.textContent = `${page.pageIndex + 1}/${layout.totalPages}`;

      const bottomGyobi = document.createElement('span');
      bottomGyobi.className = 'genkou-gyobi';
      bottomGyobi.textContent = '】';

      hashiraEl.append(topGyobi, hashiraTitle, pageNumber, bottomGyobi);
      frameEl.appendChild(hashiraEl);

      frameEl.appendChild(
        this.renderHalfBlock(
          secondHalfLines,
          config,
          cursorCoords,
          selectionAnchorCoords,
          activeRubyGroupStart
        )
      );

      pageEl.appendChild(frameEl);
      return pageEl;
    };

    // Measure a real page once, then keep lightweight placeholders for off-screen pages.
    const activePage = Math.min(layout.pages.length - 1, Math.floor(cursorCoords.globalLineIndex / config.linesPerPage));
    const activeElement = makePage(layout.pages[activePage]);
    this.viewport.appendChild(activeElement);
    const rect = activeElement.getBoundingClientRect();
    this.viewport.style.setProperty('--genkou-measured-page-height', `${rect.height}px`);
    this.viewport.style.setProperty('--genkou-measured-page-width', `${rect.width}px`);
    activeElement.remove();
    const shells = layout.pages.map((page, index) => {
      const shell = document.createElement('div');
      shell.className = 'genkou-page-placeholder';
      if (index === activePage) shell.appendChild(activeElement);
      this.viewport.appendChild(shell);
      return { shell, page, index };
    });
    this.viewport.scrollTop = oldScrollTop;
    const pagesByElement = new Map(shells.map((entry) => [entry.shell, entry]));
    this.pageObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const item = pagesByElement.get(entry.target as HTMLDivElement);
        if (!item) continue;
        if (entry.isIntersecting && !item.shell.firstChild) item.shell.appendChild(makePage(item.page));
        else if (!entry.isIntersecting && item.index !== activePage) item.shell.replaceChildren();
      }
    }, { root: this.viewport, rootMargin: '100% 0px' });
    shells.forEach(({ shell }) => this.pageObserver!.observe(shell));
  }

  private renderHalfBlock(
    lines: GenkouLine[],
    config: GenkouConfig,
    cursorCoords: CellCoordinates,
    selectionAnchorCoords: CellCoordinates | null,
    activeRubyGroupStart: number | undefined
  ): HTMLElement {
    const halfEl = document.createElement('div');
    halfEl.className = 'genkou-half';

    const hasMultiSelection =
      selectionAnchorCoords !== null &&
      compareGridCoords(selectionAnchorCoords, cursorCoords) !== 0;

    for (const line of lines) {
      const lineEl = document.createElement('div');
      lineEl.className = 'genkou-line';
      lineEl.dataset.globalLine = String(line.globalLineIndex);

      for (const cell of line.cells) {
        const cellEl = document.createElement('div');
        cellEl.className = 'genkou-cell';
        cellEl.dataset.globalLine = String(line.globalLineIndex);
        cellEl.dataset.cellIndex = String(cell.cellIndex);

        const coords: CellCoordinates = {
          globalLineIndex: line.globalLineIndex,
          cellIndex: cell.cellIndex,
        };

        const isCursor =
          line.globalLineIndex === cursorCoords.globalLineIndex &&
          cell.cellIndex === cursorCoords.cellIndex;

        if (isCursor) {
          cellEl.classList.add('is-cursor');
          this.activeCellEl = cellEl;
        }

        if (
          hasMultiSelection &&
          isCellInSelection(coords, selectionAnchorCoords, cursorCoords)
        ) {
          cellEl.classList.add('is-selected');
        }

        if (
          activeRubyGroupStart !== undefined &&
          cell.token?.ruby?.groupRawStart === activeRubyGroupStart
        ) {
          cellEl.classList.add('is-ruby-group');
        }

        if (config.highlightDialogue && cell.token?.isDialogue) {
          cellEl.classList.add('is-dialogue');
        }

        if (cell.token) {
          const charSpan = document.createElement('span');
          charSpan.className = 'genkou-char';
          charSpan.textContent = cell.token.char;
          cellEl.appendChild(charSpan);

          if (cell.token.cellRuby) {
            const rubySpan = document.createElement('span');
            rubySpan.className = 'genkou-ruby';
            rubySpan.textContent = cell.token.cellRuby;
            cellEl.appendChild(rubySpan);
          } else if (cell.token.bouten) {
            const boutenSpan = document.createElement('span');
            boutenSpan.className = 'genkou-bouten';
            boutenSpan.textContent = '﹅';
            cellEl.appendChild(boutenSpan);
          }
        }

        if (cell.hangingTokens.length > 0) {
          const hangSpan = document.createElement('span');
          hangSpan.className = 'genkou-hanging';
          hangSpan.textContent = cell.hangingTokens.map((t) => t.char).join('');
          cellEl.appendChild(hangSpan);
        }

        cellEl.addEventListener('mousedown', (e) => {
          if (e.button !== 0) {
            return;
          }
          e.preventDefault();
          this.isMouseSelecting = true;
          this.callbacks.onCellClick(coords, cell, line, cellEl, e.shiftKey);
        });

        cellEl.addEventListener('mouseenter', (e) => {
          if (!this.isMouseSelecting || (e.buttons & 1) === 0) {
            return;
          }
          this.callbacks.onCellDragSelect(coords, cell, line, cellEl);
        });

        cellEl.addEventListener('dblclick', (e) => {
          e.preventDefault();
          this.isMouseSelecting = false;
          this.callbacks.onCellDoubleClick(coords, cell, line);
        });

        lineEl.appendChild(cellEl);
      }

      halfEl.appendChild(lineEl);
    }

    return halfEl;
  }
}
