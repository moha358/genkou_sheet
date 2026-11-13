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

const STATUS_UPDATE_DELAY_MS = 300;

function getPrimaryWorkspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isManuscriptFileName(fileName: string): boolean {
  const ext = path.extname(fileName).toLowerCase();
  return ext === '.txt' || ext === '.md';
}

export function activate(context: vscode.ExtensionContext): void {
  const statusBar = new StatusBarCounterProvider();
  const treeProvider = new ManuscriptTreeProvider(getPrimaryWorkspaceRoot);

  const syncFolderContext = () => {
    const root = getPrimaryWorkspaceRoot();
    const folderEnabled = Boolean(root && isFolderGenkouEnabled(root));
    void vscode.commands.executeCommand(
      'setContext',
      'genkouSheet.isFolderEnabled',
      folderEnabled
    );
    statusBar.setFolderEnabled(folderEnabled);
    treeProvider.refresh();
  };

  // ── ステータスバー（入力のたびに全文を数え直さないよう間引く） ──
  let statusTimer: ReturnType<typeof setTimeout> | undefined;
  let statusDoc: vscode.TextDocument | undefined;
  const handleDocumentUpdated = (doc: vscode.TextDocument) => {
    statusDoc = doc;
    if (statusTimer) clearTimeout(statusTimer);
    statusTimer = setTimeout(() => {
      statusTimer = undefined;
      const cfg = readGenkouConfigFromVscode();
      statusBar.updateForDocument(statusDoc, cfg.charsPerLine, cfg.linesPerPage);
    }, STATUS_UPDATE_DELAY_MS);
  };

  // ── HTML 出力 ──
  const writeExport = async (defaultPath: string, html: string): Promise<string | undefined> => {
    const destination = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(defaultPath), filters: { HTML: ['html'] } });
    if (!destination) return undefined;
    try {
      await vscode.workspace.fs.writeFile(destination, Buffer.from(html, 'utf-8'));
    } catch (err) {
      void vscode.window.showErrorMessage(`組版HTMLを書き出せませんでした: ${errorMessage(err)}`);
      return undefined;
    }
    await vscode.env.openExternal(destination);
    return path.basename(destination.path);
  };

  const exportSingleDocument = async (doc: vscode.TextDocument) => {
    const cfg = readGenkouConfigFromVscode();
    const title = path.basename(doc.fileName, path.extname(doc.fileName));
    const html = generateManuscriptHtml(title, doc.getText(), cfg);
    const name = await writeExport(`${doc.fileName}.genkou.html`, html);
    if (name) {
      void vscode.window.showInformationMessage(
        `組版HTMLを出力しました: ${name}（ブラウザの印刷機能からPDF保存が可能です）`
      );
    }
  };

  const exportCombinedProject = async () => {
    const root = getPrimaryWorkspaceRoot();
    if (!root) {
      void vscode.window.showWarningMessage('フォルダーをワークスペースとして開いてから実行してください。');
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
        // 開いている原稿は未保存の編集内容を優先する
        const openDoc = vscode.workspace.textDocuments.find((d) => d.uri.scheme === 'file' && d.fileName === full);
        if (openDoc) return openDoc.getText();
        return fs.existsSync(full) ? fs.readFileSync(full, 'utf-8') : '';
      })
      .filter((s) => s.length > 0)
      .join('\n\n');

    const cfg = readGenkouConfigFromVscode();
    const html = generateManuscriptHtml(manifest.title, combinedText, cfg);
    const safeTitle = manifest.title.replace(/[\\/:*?\"<>|\x00-\x1f]/g, '_').replace(/^\.+$/, '_').trim() || 'manuscript';
    const name = await writeExport(path.join(root, `${safeTitle}.combined.genkou.html`), html);
    if (name) {
      void vscode.window.showInformationMessage(
        `全${files.length}編を結合した組版HTMLを出力しました: ${name}`
      );
    }
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

  // ── 原稿ツリー（入力のたびではなく、保存・ファイル増減・設定変更時に更新） ──
  const manuscriptWatcher = vscode.workspace.createFileSystemWatcher('**/*.{txt,md}', false, true, false);
  const manifestWatcher = vscode.workspace.createFileSystemWatcher('**/.genkou.json');

  context.subscriptions.push(
    statusBar,
    manuscriptWatcher,
    manifestWatcher,
    manuscriptWatcher.onDidCreate(() => treeProvider.refresh()),
    manuscriptWatcher.onDidDelete(() => treeProvider.refresh()),
    manifestWatcher.onDidCreate(syncFolderContext),
    manifestWatcher.onDidChange(syncFolderContext),
    manifestWatcher.onDidDelete(syncFolderContext),
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
      try {
        enableGenkouInFolder(root);
      } catch (err) {
        void vscode.window.showErrorMessage(`執筆プロジェクトとして有効化できませんでした: ${errorMessage(err)}`);
        return;
      }
      syncFolderContext();
      void vscode.window.showInformationMessage(
        'このフォルダーを原稿用紙執筆プロジェクトとして有効化しました（他のプロジェクトには影響しません）。'
      );

      const activeEditor = vscode.window.activeTextEditor;
      if (activeEditor && isManuscriptFileName(activeEditor.document.fileName)) {
        await vscode.commands.executeCommand(
          'vscode.openWith',
          activeEditor.document.uri,
          EDITOR_VIEW_TYPE
        );
      }
    }),
    vscode.commands.registerCommand('genkouSheet.disableFolder', () => {
      const root = getPrimaryWorkspaceRoot();
      if (!root) {
        return;
      }
      try {
        disableGenkouInFolder(root);
      } catch (err) {
        void vscode.window.showErrorMessage(`執筆プロジェクト設定を解除できませんでした: ${errorMessage(err)}`);
        return;
      }
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
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('genkouSheet.charsPerLine') || e.affectsConfiguration('genkouSheet.linesPerPage')) {
        treeProvider.refresh();
      }
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(syncFolderContext),
    {
      dispose: () => {
        if (statusTimer) clearTimeout(statusTimer);
      },
    }
  );

  syncFolderContext();
}

export function deactivate(): void {
  // No-op
}
