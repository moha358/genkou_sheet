/**
 * Manuscript Tree Provider (原稿ツリービュー・全体集計・順序管理)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { countManuscript, ManuscriptStats } from '../core/counter';
import {
  EDITOR_VIEW_TYPE,
  getOrderedManuscriptFiles,
  isFolderGenkouEnabled,
  moveManuscriptFileOrder,
} from '../services/workspaceService';

export class ManuscriptTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly relativePath?: string,
    public readonly fullPath?: string,
    public readonly stats?: ManuscriptStats
  ) {
    super(label, collapsibleState);

    if (relativePath && fullPath && stats) {
      this.contextValue = 'manuscriptFile';
      this.description = `${stats.effectiveChars.toLocaleString()}字 (${stats.sheets400}枚)`;
      this.tooltip = `${relativePath}\n実文字数: ${stats.effectiveChars.toLocaleString()}字\n空白込: ${stats.charsWithSpaces.toLocaleString()}字\n400字詰換算: ${stats.sheets400}枚（実組版: ${stats.layoutPages}枚 / ${stats.layoutLines}行）`;
      this.resourceUri = vscode.Uri.file(fullPath);
      this.command = {
        command: 'vscode.openWith',
        title: '原稿用紙エディタで開く',
        arguments: [vscode.Uri.file(fullPath), EDITOR_VIEW_TYPE],
      };
    } else {
      this.contextValue = 'manuscriptSummary';
      this.iconPath = new vscode.ThemeIcon('library');
    }
  }
}

export class ManuscriptTreeProvider
  implements vscode.TreeDataProvider<ManuscriptTreeItem>
{
  private _onDidChangeTreeData = new vscode.EventEmitter<
    ManuscriptTreeItem | undefined | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly getWorkspaceRoot: () => string | undefined) {}

  public refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  public moveItem(item: ManuscriptTreeItem, direction: 'up' | 'down'): void {
    const root = this.getWorkspaceRoot();
    if (!root || !item.relativePath) {
      return;
    }
    moveManuscriptFileOrder(root, item.relativePath, direction);
    this.refresh();
  }

  public getTreeItem(element: ManuscriptTreeItem): vscode.TreeItem {
    return element;
  }

  public async getChildren(
    element?: ManuscriptTreeItem
  ): Promise<ManuscriptTreeItem[]> {
    if (element) {
      return [];
    }

    const root = this.getWorkspaceRoot();
    if (!root || !isFolderGenkouEnabled(root)) {
      return [];
    }

    const config = vscode.workspace.getConfiguration('genkouSheet');
    const charsPerLine = config.get<number>('charsPerLine', 20);
    const linesPerPage = config.get<number>('linesPerPage', 20);

    const files = getOrderedManuscriptFiles(root);
    let totalEffective = 0;
    let totalWithSpaces = 0;
    let totalLayoutLines = 0;

    const fileItems: ManuscriptTreeItem[] = [];

    for (const relPath of files) {
      const fullPath = path.join(root, relPath);
      let content = '';
      try {
        content = fs.readFileSync(fullPath, 'utf-8');
      } catch {
        continue;
      }
      const stats = countManuscript(content, charsPerLine, linesPerPage);
      totalEffective += stats.effectiveChars;
      totalWithSpaces += stats.charsWithSpaces;
      totalLayoutLines += stats.layoutLines;

      fileItems.push(
        new ManuscriptTreeItem(
          relPath,
          vscode.TreeItemCollapsibleState.None,
          relPath,
          fullPath,
          stats
        )
      );
    }

    const totalSheets400 =
      totalWithSpaces === 0 ? 0 : Math.ceil(totalWithSpaces / 400);
    const summaryItem = new ManuscriptTreeItem(
      `全${fileItems.length}編 合計: ${totalEffective.toLocaleString()}字 (400字詰 ${totalSheets400}枚 / 実${totalLayoutLines}行)`,
      vscode.TreeItemCollapsibleState.None
    );

    return [summaryItem, ...fileItems];
  }
}
