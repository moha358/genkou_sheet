/**
 * Extension Entrypoint (Genkou Sheet - 原稿用紙エディタ)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  GenkouEditorProvider,
  readGenkouConfigFromVscode,
} from './providers/genkouEditorProvider';
import {
  ManuscriptTreeItem,
  ManuscriptTreeProvider,
} from './providers/manuscriptTreeProvider';
import { StatusBarCounterProvider } from './providers/statusBarProvider';
import { generateManuscriptHtml } from './services/exportService';
import {
  disableGenkouInFolder,
  EDITOR_VIEW_TYPE,
  enableGenkouInFolder,
  getOrderedManuscriptFiles,
  isFolderGenkouEnabled,
  readProjectManifest,
} from './services/workspaceService';

function getPrimaryWorkspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

export function activate(context: vscode.ExtensionContext): void {
  const statusBar = new StatusBarCounterProvider();
  const treeProvider = new ManuscriptTreeProvider(getPrimaryWorkspaceRoot);

  const syncFolderContext = () => {
    const root = getPrimaryWorkspaceRoot();
    const enabled = Boolean(root && isFolderGenkouEnabled(root));
    void vscode.commands.executeCommand(
      'setContext',
      'genkouSheet.isFolderEnabled',
      enabled
    );
    statusBar.setFolderEnabled(enabled);
    treeProvider.refresh();
  };

  const handleDocumentUpdated = (doc: vscode.TextDocument) => {
    const cfg = readGenkouConfigFromVscode();
    statusBar.updateForDocument(doc, cfg.charsPerLine, cfg.linesPerPage);
    treeProvider.refresh();
  };

  const exportSingleDocument = async (doc: vscode.TextDocument) => {
    const cfg = readGenkouConfigFromVscode();
    const title = path.basename(doc.fileName, path.extname(doc.fileName));
    const html = generateManuscriptHtml(title, doc.getText(), cfg);
    const outPath = `${doc.fileName}.genkou.html`;
    fs.writeFileSync(outPath, html, 'utf-8');
    await vscode.env.openExternal(vscode.Uri.file(outPath));
    void vscode.window.showInformationMessage(
      `組版HTMLを出力しました: ${path.basename(outPath)}（ブラウザの印刷機能からPDF保存が可能です）`
    );
  };

  const exportCombinedProject = async () => {
    const root = getPrimaryWorkspaceRoot();
    if (!root) {
      return;
    }
    const files = getOrderedManuscriptFiles(root);
    if (files.length === 0) {
      void vscode.window.showWarningMessage(
        '出力対象の原稿ファイル (.txt / .md) が見つかりませんでした。'
      );
      return;
    }
    const manifest = readProjectManifest(root);
    const combinedText = files
      .map((rel) => {
        const full = path.join(root, rel);
        return fs.existsSync(full) ? fs.readFileSync(full, 'utf-8') : '';
      })
      .filter((s) => s.length > 0)
      .join('\n\n');

    const cfg = readGenkouConfigFromVscode();
    const html = generateManuscriptHtml(manifest.title, combinedText, cfg);
    const outPath = path.join(root, `${manifest.title}.combined.genkou.html`);
    fs.writeFileSync(outPath, html, 'utf-8');
    await vscode.env.openExternal(vscode.Uri.file(outPath));
    void vscode.window.showInformationMessage(
      `全${files.length}編を結合した組版HTMLを出力しました: ${path.basename(outPath)}`
    );
  };

  const editorProvider = new GenkouEditorProvider(
    context,
    handleDocumentUpdated,
    (doc, format) => {
      if (format === 'combined') {
        void exportCombinedProject();
      } else {
        void exportSingleDocument(doc);
      }
    }
  );

  context.subscriptions.push(
    statusBar,
    vscode.window.registerCustomEditorProvider(
      GenkouEditorProvider.viewType,
      editorProvider,
      {
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: false,
      }
    ),
    vscode.window.registerTreeDataProvider(
      'genkouSheet.manuscriptTree',
      treeProvider
    ),
    vscode.commands.registerCommand('genkouSheet.enableFolder', async () => {
      const root = getPrimaryWorkspaceRoot();
      if (!root) {
        void vscode.window.showWarningMessage(
          'フォルダーをワークスペースとして開いてから実行してください。'
        );
        return;
      }
      enableGenkouInFolder(root);
      syncFolderContext();
      void vscode.window.showInformationMessage(
        'このフォルダーを原稿用紙執筆プロジェクトとして有効化しました（他のプロジェクトには影響しません）。'
      );

      const activeEditor = vscode.window.activeTextEditor;
      if (activeEditor) {
        const ext = path.extname(activeEditor.document.fileName).toLowerCase();
        if (ext === '.txt' || ext === '.md') {
          await vscode.commands.executeCommand(
            'vscode.openWith',
            activeEditor.document.uri,
            EDITOR_VIEW_TYPE
          );
        }
      }
    }),
    vscode.commands.registerCommand('genkouSheet.disableFolder', () => {
      const root = getPrimaryWorkspaceRoot();
      if (!root) {
        return;
      }
      disableGenkouInFolder(root);
      syncFolderContext();
      void vscode.window.showInformationMessage(
        'このフォルダーの原稿用紙執筆設定を解除しました。'
      );
    }),
    vscode.commands.registerCommand(
      'genkouSheet.openAsGenkou',
      async (uri?: vscode.Uri) => {
        const targetUri = uri ?? vscode.window.activeTextEditor?.document.uri;
        if (targetUri) {
          await vscode.commands.executeCommand(
            'vscode.openWith',
            targetUri,
            EDITOR_VIEW_TYPE
          );
        }
      }
    ),
    vscode.commands.registerCommand('genkouSheet.exportHtml', async () => {
      const doc =
        editorProvider.getActiveDocument() ??
        vscode.window.activeTextEditor?.document;
      if (!doc) {
        void vscode.window.showWarningMessage(
          '出力する原稿ファイルを開いてから実行してください。'
        );
        return;
      }
      await exportSingleDocument(doc);
    }),
    vscode.commands.registerCommand(
      'genkouSheet.exportCombinedHtml',
      async () => {
        await exportCombinedProject();
      }
    ),
    vscode.commands.registerCommand(
      'genkouSheet.moveFileUp',
      (item?: ManuscriptTreeItem) => {
        if (item) {
          treeProvider.moveItem(item, 'up');
        }
      }
    ),
    vscode.commands.registerCommand(
      'genkouSheet.moveFileDown',
      (item?: ManuscriptTreeItem) => {
        if (item) {
          treeProvider.moveItem(item, 'down');
        }
      }
    ),
    vscode.commands.registerCommand('genkouSheet.refreshTree', () => {
      treeProvider.refresh();
    }),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) {
        handleDocumentUpdated(editor.document);
      }
    }),
    vscode.workspace.onDidSaveTextDocument(() => {
      treeProvider.refresh();
    })
  );

  syncFolderContext();
}

export function deactivate(): void {
  // No-op
}
