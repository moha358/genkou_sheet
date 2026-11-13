/**
 * Status Bar Counter Provider (ステータスバー文字数・原稿用紙枚数リアルタイム表示)
 */

import * as vscode from 'vscode';
import { countManuscript } from '../core/counter';

export class StatusBarCounterProvider implements vscode.Disposable {
  private readonly statusBarItem: vscode.StatusBarItem;
  private isFolderEnabled: boolean = false;

  constructor() {
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
    this.statusBarItem.command = 'genkouSheet.exportHtml';
    this.statusBarItem.tooltip =
      '原稿用紙カウント（クリックで現在の原稿を組版HTML / PDF印刷用に出力）';
  }

  public setFolderEnabled(enabled: boolean): void {
    this.isFolderEnabled = enabled;
    if (!enabled) {
      this.statusBarItem.hide();
    }
  }

  public updateForDocument(
    document: vscode.TextDocument | undefined,
    charsPerLine: number = 20,
    linesPerPage: number = 20
  ): void {
    if (!this.isFolderEnabled || !document) {
      this.statusBarItem.hide();
      return;
    }

    const fileName = document.fileName.toLowerCase();
    if (!fileName.endsWith('.txt') && !fileName.endsWith('.md')) {
      this.statusBarItem.hide();
      return;
    }

    const stats = countManuscript(document.getText(), charsPerLine, linesPerPage);
    this.statusBarItem.text = `$(book) ${stats.effectiveChars.toLocaleString()}字 | 400字×${stats.sheets400}枚 (実${stats.layoutPages}枚/${stats.layoutLines}行)`;
    this.statusBarItem.show();
  }

  public dispose(): void {
    this.statusBarItem.dispose();
  }
}
