/**
 * Grid Direct Input & IME Controller (マス目直接タイピング・IME変換・範囲選択制御コントローラ)
 */

import {
  deleteBackwardAtOffset,
  deleteForwardAtOffset,
  GridCursorCoords,
  insertNewlineAtOffset,
  insertTextAtOffset,
  moveCursorByKey,
  SelectedRangeInfo,
} from '../../core/cursorLogic';
import { DocumentLayoutResult } from '../../core/layoutEngine';
import { GenkouConfig } from '../../core/theme';

export interface InputControllerCallbacks {
  getText: () => string;
  getLayout: () => DocumentLayoutResult;
  getConfig: () => GenkouConfig;
  getCursorOffset: () => number;
  getCursorCoords: () => GridCursorCoords;
  getSelectionInfo: () => SelectedRangeInfo;
  onTextEdited: (newText: string, newCursorOffset: number) => void;
  onCursorMoved: (newCoords: GridCursorCoords, extendSelection: boolean) => void;
  onOpenRubyShortcut: () => void;
}

export class GridInputController {
  private readonly textarea: HTMLTextAreaElement;
  private isComposing: boolean = false;

  constructor(
    container: HTMLElement,
    private readonly callbacks: InputControllerCallbacks
  ) {
    this.textarea = document.createElement('textarea');
    this.textarea.className = 'genkou-ime-input';
    this.textarea.setAttribute('autocorrect', 'off');
    this.textarea.setAttribute('autocapitalize', 'off');
    this.textarea.setAttribute('spellcheck', 'false');
    container.appendChild(this.textarea);

    this.bindEvents();
  }

  public focusAtCell(cellElement: HTMLElement | null): void {
    if (cellElement) {
      const rect = cellElement.getBoundingClientRect();
      this.textarea.style.left = `${Math.max(0, rect.left)}px`;
      this.textarea.style.top = `${Math.max(0, rect.top)}px`;
    }
    this.textarea.focus({ preventScroll: true });
  }

  private bindEvents(): void {
    this.textarea.addEventListener('compositionstart', () => {
      this.isComposing = true;
      this.textarea.classList.add('is-composing');
    });

    this.textarea.addEventListener('compositionend', (e: CompositionEvent) => {
      this.isComposing = false;
      this.textarea.classList.remove('is-composing');
      const committed = e.data || this.textarea.value;
      this.textarea.value = '';
      if (committed) {
        this.commitInputText(committed);
      }
    });

    this.textarea.addEventListener('input', () => {
      if (this.isComposing) {
        return;
      }
      const val = this.textarea.value;
      if (!val) {
        return;
      }
      this.textarea.value = '';
      const cleaned = val.replace(/\r?\n/g, '');
      if (cleaned) {
        this.commitInputText(cleaned);
      }
    });

    this.textarea.addEventListener('paste', (e: ClipboardEvent) => {
      e.preventDefault();
      const pasted = e.clipboardData?.getData('text/plain');
      if (pasted) {
        const normalized = pasted.replace(/\r\n/g, '\n');
        this.commitInputText(normalized);
      }
    });

    this.textarea.addEventListener('copy', (e: ClipboardEvent) => {
      const sel = this.callbacks.getSelectionInfo();
      if (sel.rawEnd > sel.rawStart) {
        e.preventDefault();
        const rawSlice = this.callbacks
          .getText()
          .slice(sel.rawStart, sel.rawEnd);
        e.clipboardData?.setData('text/plain', rawSlice);
      }
    });

    this.textarea.addEventListener('cut', (e: ClipboardEvent) => {
      const sel = this.callbacks.getSelectionInfo();
      if (sel.rawEnd > sel.rawStart) {
        e.preventDefault();
        const fullText = this.callbacks.getText();
        const rawSlice = fullText.slice(sel.rawStart, sel.rawEnd);
        e.clipboardData?.setData('text/plain', rawSlice);
        const newText =
          fullText.slice(0, sel.rawStart) + fullText.slice(sel.rawEnd);
        this.callbacks.onTextEdited(newText, sel.rawStart);
      }
    });

    this.textarea.addEventListener('keydown', (e: KeyboardEvent) => {
      if (this.isComposing || e.isComposing) {
        return;
      }

      // Cmd/Ctrl + R: ルビ編集モーダル起動
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'r') {
        e.preventDefault();
        this.callbacks.onOpenRubyShortcut();
        return;
      }

      if (e.metaKey || e.ctrlKey || e.altKey) {
        return;
      }

      if (
        e.key === 'ArrowUp' ||
        e.key === 'ArrowDown' ||
        e.key === 'ArrowLeft' ||
        e.key === 'ArrowRight'
      ) {
        e.preventDefault();
        const nextCoords = moveCursorByKey(
          this.callbacks.getLayout(),
          this.callbacks.getCursorCoords(),
          e.key,
          this.callbacks.getConfig().writingMode
        );
        this.callbacks.onCursorMoved(nextCoords, e.shiftKey);
        return;
      }

      if (e.key === 'Enter') {
        e.preventDefault();
        const sel = this.callbacks.getSelectionInfo();
        const currentText = this.callbacks.getText();
        if (sel.hasMultiSelection && sel.rawEnd > sel.rawStart) {
          const reduced =
            currentText.slice(0, sel.rawStart) + currentText.slice(sel.rawEnd);
          const { newText, newOffset } = insertNewlineAtOffset(
            reduced,
            sel.rawStart,
            this.callbacks.getConfig().autoIndent,
            e.shiftKey
          );
          this.callbacks.onTextEdited(newText, newOffset);
          return;
        }

        const { newText, newOffset } = insertNewlineAtOffset(
          currentText,
          this.callbacks.getCursorOffset(),
          this.callbacks.getConfig().autoIndent,
          e.shiftKey
        );
        this.callbacks.onTextEdited(newText, newOffset);
        return;
      }

      if (e.key === 'Backspace') {
        e.preventDefault();
        const sel = this.callbacks.getSelectionInfo();
        const currentText = this.callbacks.getText();
        if (sel.hasMultiSelection && sel.rawEnd > sel.rawStart) {
          const newText =
            currentText.slice(0, sel.rawStart) + currentText.slice(sel.rawEnd);
          this.callbacks.onTextEdited(newText, sel.rawStart);
          return;
        }

        const { newText, newOffset } = deleteBackwardAtOffset(
          currentText,
          this.callbacks.getCursorOffset()
        );
        this.callbacks.onTextEdited(newText, newOffset);
        return;
      }

      if (e.key === 'Delete') {
        e.preventDefault();
        const sel = this.callbacks.getSelectionInfo();
        const currentText = this.callbacks.getText();
        if (sel.hasMultiSelection && sel.rawEnd > sel.rawStart) {
          const newText =
            currentText.slice(0, sel.rawStart) + currentText.slice(sel.rawEnd);
          this.callbacks.onTextEdited(newText, sel.rawStart);
          return;
        }

        const { newText, newOffset } = deleteForwardAtOffset(
          currentText,
          this.callbacks.getCursorOffset()
        );
        this.callbacks.onTextEdited(newText, newOffset);
        return;
      }
    });
  }

  private commitInputText(inserted: string): void {
    const sel = this.callbacks.getSelectionInfo();
    const currentText = this.callbacks.getText();

    if (sel.hasMultiSelection && sel.rawEnd > sel.rawStart) {
      const reduced =
        currentText.slice(0, sel.rawStart) + currentText.slice(sel.rawEnd);
      const { newText, newOffset } = insertTextAtOffset(
        reduced,
        sel.rawStart,
        inserted,
        this.callbacks.getConfig().autoIndent
      );
      this.callbacks.onTextEdited(newText, newOffset);
      return;
    }

    const { newText, newOffset } = insertTextAtOffset(
      currentText,
      this.callbacks.getCursorOffset(),
      inserted,
      this.callbacks.getConfig().autoIndent
    );
    this.callbacks.onTextEdited(newText, newOffset);
  }
}
