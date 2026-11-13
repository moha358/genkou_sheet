/**
 * Webview Entrypoint (原稿用紙カスタムエディタ フロントエンドメイン)
 */

import { countManuscript } from '../core/counter';
import {
  compareGridCoords,
  getSelectedRangeInfo,
  GridCursorCoords,
  gridCoordsToRawOffset,
  insertTextAtOffset,
  rawOffsetToGridCoords,
} from '../core/cursorLogic';
import { DocumentLayoutResult, layoutDocument } from '../core/layoutEngine';
import {
  buildCssVariables,
  DEFAULT_GENKOU_CONFIG,
  GenkouConfig,
  HostToWebviewMessage,
  WebviewToHostMessage,
} from '../core/theme';
import { GenkouSheetRenderer } from './components/GenkouPage';
import { GridInputController } from './components/InputController';
import { RubyModal } from './components/RubyModal';
import { EditorToolbar } from './components/Toolbar';

declare function acquireVsCodeApi(): {
  postMessage(msg: WebviewToHostMessage): void;
  getState(): unknown;
  setState(state: unknown): void;
};

class GenkouWebviewApp {
  private readonly vscode = acquireVsCodeApi();
  private text: string = '';
  private version: number = 0;
  private fileName: string = '原稿';
  private config: GenkouConfig = { ...DEFAULT_GENKOU_CONFIG };
  private layout: DocumentLayoutResult = layoutDocument('', 20, 20);
  private cursorRawOffset: number = 0;
  private cursorCoords: GridCursorCoords = { globalLineIndex: 0, cellIndex: 0 };
  private selectionAnchorCoords: GridCursorCoords | null = null;

  private readonly toolbar: EditorToolbar;
  private readonly sheetRenderer: GenkouSheetRenderer;
  private readonly rubyModal: RubyModal;
  private readonly inputController: GridInputController;

  constructor(rootContainer: HTMLElement) {
    this.applyThemeVariables();

    this.toolbar = new EditorToolbar(rootContainer, {
      onConfigChange: (partial) => {
        this.config = { ...this.config, ...partial };
        this.applyThemeVariables();
        this.refreshLayout(false);
        this.vscode.postMessage({
          type: 'UPDATE_CONFIG',
          partialConfig: partial,
        });
      },
      onOpenRubyModal: () => this.openRubyModalForCursor(),
      onInsertBouten: () => this.insertBoutenAtCursor(),
      onRequestExport: (format) => {
        this.vscode.postMessage({ type: 'REQUEST_EXPORT', format });
      },
    });

    this.sheetRenderer = new GenkouSheetRenderer(rootContainer, {
      onCellClick: (coords, cell, line, _cellEl, shiftKey) => {
        if (shiftKey) {
          if (!this.selectionAnchorCoords) {
            this.selectionAnchorCoords = { ...this.cursorCoords };
          }
        } else {
          this.selectionAnchorCoords = { ...coords };
        }
        this.cursorCoords = coords;
        this.cursorRawOffset = cell.token
          ? cell.token.rawStart
          : line.paragraphIndex === -1
            ? this.text.length
            : line.lineEndRawOffset;
        this.refreshLayout(true);
      },
      onCellDragSelect: (coords, cell, line) => {
        if (!this.selectionAnchorCoords) {
          this.selectionAnchorCoords = { ...this.cursorCoords };
        }
        if (compareGridCoords(this.cursorCoords, coords) === 0) {
          return;
        }
        this.cursorCoords = coords;
        this.cursorRawOffset = cell.token
          ? cell.token.rawStart
          : line.paragraphIndex === -1
            ? this.text.length
            : line.lineEndRawOffset;
        this.refreshLayout(true);
      },
      onCellDoubleClick: (coords, cell) => {
        this.cursorCoords = coords;
        if (cell.token) {
          this.cursorRawOffset = cell.token.rawStart;
        }
        this.openRubyModalForCursor();
      },
    });

    this.rubyModal = new RubyModal(rootContainer, (result) => {
      const formatted = result.rubyText
        ? `｜${result.baseText}《${result.rubyText}》`
        : result.baseText;

      this.selectionAnchorCoords = null;
      if (result.replaceRange) {
        const before = this.text.slice(0, result.replaceRange.start);
        const after = this.text.slice(result.replaceRange.end);
        const newText = before + formatted + after;
        const newOffset = before.length + formatted.length;
        this.applyLocalTextEdit(newText, newOffset);
      } else {
        const { newText, newOffset } = insertTextAtOffset(
          this.text,
          this.cursorRawOffset,
          formatted,
          false
        );
        this.applyLocalTextEdit(newText, newOffset);
      }
    });

    this.inputController = new GridInputController(rootContainer, {
      getText: () => this.text,
      getLayout: () => this.layout,
      getConfig: () => this.config,
      getCursorOffset: () => this.cursorRawOffset,
      getCursorCoords: () => this.cursorCoords,
      getSelectionInfo: () =>
        getSelectedRangeInfo(
          this.layout,
          this.text,
          this.selectionAnchorCoords,
          this.cursorCoords
        ),
      onTextEdited: (newText, newOffset) => {
        this.selectionAnchorCoords = null;
        this.applyLocalTextEdit(newText, newOffset);
      },
      onCursorMoved: (newCoords, extendSelection) => {
        if (extendSelection) {
          if (!this.selectionAnchorCoords) {
            this.selectionAnchorCoords = { ...this.cursorCoords };
          }
        } else {
          this.selectionAnchorCoords = null;
        }
        this.cursorCoords = newCoords;
        this.cursorRawOffset = gridCoordsToRawOffset(this.layout, newCoords);
        this.refreshLayout(true);
      },
      onOpenRubyShortcut: () => this.openRubyModalForCursor(),
    });

    this.sheetRenderer.getViewportElement().addEventListener('scroll', () => {
      const activeCell = this.sheetRenderer.getActiveCellElement();
      if (activeCell) {
        this.inputController.focusAtCell(activeCell);
      }
    });

    window.addEventListener('message', (event: MessageEvent<HostToWebviewMessage>) => {
      this.handleHostMessage(event.data);
    });

    this.vscode.postMessage({ type: 'READY' });
  }

  private applyThemeVariables(): void {
    document.documentElement.style.cssText = buildCssVariables(this.config);
  }

  private handleHostMessage(msg: HostToWebviewMessage): void {
    switch (msg.type) {
      case 'INIT_DOCUMENT': {
        this.text = msg.text;
        this.version = msg.version;
        this.fileName = msg.fileName;
        this.config = msg.config;
        this.selectionAnchorCoords = null;
        this.applyThemeVariables();
        this.toolbar.syncConfig(this.config);
        this.cursorRawOffset = Math.min(this.cursorRawOffset, this.text.length);
        this.refreshLayout(true, true);
        break;
      }
      case 'DOCUMENT_CHANGED': {
        if (msg.text !== this.text) {
          this.text = msg.text;
          this.version = msg.version;
          this.selectionAnchorCoords = null;
          this.cursorRawOffset = Math.min(this.cursorRawOffset, this.text.length);
          this.refreshLayout(true, true);
        }
        break;
      }
      case 'CONFIG_CHANGED': {
        this.config = msg.config;
        this.applyThemeVariables();
        this.toolbar.syncConfig(this.config);
        this.refreshLayout(false);
        break;
      }
    }
  }

  private applyLocalTextEdit(newText: string, newCursorOffset: number): void {
    this.text = newText;
    this.cursorRawOffset = newCursorOffset;
    this.version += 1;
    this.refreshLayout(true, true);
    this.vscode.postMessage({
      type: 'EDIT_TEXT',
      text: this.text,
      version: this.version,
    });
  }

  private refreshLayout(focusInput: boolean, recomputeCoordsFromOffset: boolean = false): void {
    this.layout = layoutDocument(
      this.text,
      this.config.charsPerLine,
      this.config.linesPerPage
    );

    if (recomputeCoordsFromOffset) {
      this.cursorCoords = rawOffsetToGridCoords(this.layout, this.cursorRawOffset);
    }

    const stats = countManuscript(
      this.text,
      this.config.charsPerLine,
      this.config.linesPerPage
    );
    this.toolbar.updateStats(stats);

    this.sheetRenderer.render(
      this.layout,
      this.config,
      this.cursorCoords,
      this.selectionAnchorCoords,
      this.fileName
    );

    if (focusInput) {
      const activeCell = this.sheetRenderer.getActiveCellElement();
      if (activeCell) {
        activeCell.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
      this.inputController.focusAtCell(activeCell);
    }
  }

  private openRubyModalForCursor(): void {
    const sel = getSelectedRangeInfo(
      this.layout,
      this.text,
      this.selectionAnchorCoords,
      this.cursorCoords
    );

    const restoreFocus = () => {
      this.inputController.focusAtCell(
        this.sheetRenderer.getActiveCellElement()
      );
    };

    if (sel.baseText) {
      this.rubyModal.open(
        sel.baseText,
        sel.existingRubyText,
        {
          start: sel.rawStart,
          end: sel.rawEnd,
        },
        restoreFocus
      );
    } else {
      this.rubyModal.open('', '', undefined, restoreFocus);
    }
  }

  private insertBoutenAtCursor(): void {
    const sel = getSelectedRangeInfo(
      this.layout,
      this.text,
      this.selectionAnchorCoords,
      this.cursorCoords
    );

    this.selectionAnchorCoords = null;
    if (sel.baseText) {
      const before = this.text.slice(0, sel.rawStart);
      const after = this.text.slice(sel.rawEnd);
      const inserted = `《《${sel.baseText}》》`;
      this.applyLocalTextEdit(
        before + inserted + after,
        before.length + inserted.length
      );
    } else {
      const { newText, newOffset } = insertTextAtOffset(
        this.text,
        this.cursorRawOffset,
        '《《強調》》',
        false
      );
      this.applyLocalTextEdit(newText, newOffset);
    }
  }
}

window.addEventListener('DOMContentLoaded', () => {
  const appRoot = document.getElementById('genkou-root');
  if (appRoot) {
    new GenkouWebviewApp(appRoot);
  }
});
