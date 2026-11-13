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
import { BackupSnapshot, BackupStore, matchesSavedFile } from './services/backupService';
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
const BACKUP_DELAY_MS = 1500;
const BACKUP_SCHEME = 'genkou-backup';

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

function isInsideFolder(filePath: string, folder: string): boolean {
  const rel = path.relative(folder, filePath);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function readBackupSettings() {
  const cfg = vscode.workspace.getConfiguration('genkouSheet.backup');
  const num = (v: unknown, fallback: number, min: number, max: number) =>
    Math.max(min, Math.min(max, typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : fallback));
  return {
    enabled: cfg.get('enabled') !== false,
    maxSnapshots: num(cfg.get('maxSnapshots'), 50, 1, 500),
    snapshotIntervalMs: num(cfg.get('intervalMinutes'), 5, 1, 120) * 60_000,
  };
}

export function activate(context: vscode.ExtensionContext): void {
  const statusBar = new StatusBarCounterProvider();
  const treeProvider = new ManuscriptTreeProvider(getPrimaryWorkspaceRoot);
  const backupStore = new BackupStore(path.join(context.globalStorageUri.fsPath, 'backups'));
  let folderEnabled = false;

  const syncFolderContext = () => {
    const root = getPrimaryWorkspaceRoot();
    folderEnabled = Boolean(root && isFolderGenkouEnabled(root));
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

  // ── 自動バックアップ ──
  let editorProvider: GenkouEditorProvider;
  const backupTimers = new Map<string, ReturnType<typeof setTimeout>>();

  const shouldBackup = (doc: vscode.TextDocument): boolean => {
    if (doc.uri.scheme !== 'file' || !isManuscriptFileName(doc.fileName)) return false;
    if (editorProvider?.isOpenInGenkou(doc)) return true;
    const root = getPrimaryWorkspaceRoot();
    return Boolean(folderEnabled && root && isInsideFolder(doc.fileName, root));
  };

  const backupNow = (doc: vscode.TextDocument, forceNewSnapshot = false) => {
    const key = doc.uri.toString();
    const timer = backupTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      backupTimers.delete(key);
    }
    const settings = readBackupSettings();
    if (!settings.enabled) return;
    const text = doc.getText();
    // 保存済みの内容は原稿ファイル自体に残っている。「保存しない」で閉じた際の revert で
    // 未保存の本文を持つ最新世代を上書きしないよう、ディスクと同じ内容は書き込まない。
    // ただし復元直前の退避（forceNewSnapshot）は、復元後に保存すると失われるため必ず書く。
    if (!forceNewSnapshot && matchesSavedFile(doc.fileName, text)) return;
    try {
      backupStore.write(key, path.basename(doc.fileName), text, { ...settings, forceNewSnapshot });
    } catch (err) {
      console.error('[Genkou Sheet] backup failed:', err);
    }
  };

  const scheduleBackup = (doc: vscode.TextDocument) => {
    if (!shouldBackup(doc) || !readBackupSettings().enabled) return;
    const key = doc.uri.toString();
    const timer = backupTimers.get(key);
    if (timer) clearTimeout(timer);
    backupTimers.set(key, setTimeout(() => backupNow(doc), BACKUP_DELAY_MS));
  };

  const flushAllBackups = () => {
    for (const key of [...backupTimers.keys()]) {
      const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === key);
      if (doc) backupNow(doc);
    }
  };

  const backupContentProvider: vscode.TextDocumentContentProvider = {
    provideTextDocumentContent(uri) {
      // 読み取り専用で表示する（uri.path = /<key>/<スナップショット名>）
      const [key, name] = uri.path.replace(/^\//, '').split('/');
      const snapshot = backupStore.listSnapshotsByKey(key).find((s) => path.basename(s.filePath) === name);
      return snapshot ? backupStore.readSnapshot(snapshot) : '';
    },
  };

  const snapshotUri = (s: BackupSnapshot, displayName: string) =>
    vscode.Uri.from({ scheme: BACKUP_SCHEME, path: `/${s.key}/${path.basename(s.filePath)}`, query: displayName });

  /** 原稿をバックアップの内容に置き換える（Undo 可能。置き換え前の内容も新しい世代として退避する） */
  const restoreSnapshotText = async (target: vscode.Uri, text: string, displayName: string) => {
    const doc = await vscode.workspace.openTextDocument(target);
    backupNow(doc, true);
    const edit = new vscode.WorkspaceEdit();
    edit.replace(doc.uri, new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)), text);
    if (await vscode.workspace.applyEdit(edit)) {
      void vscode.window.showInformationMessage(`「${displayName}」をバックアップの内容に戻しました。確認後に保存してください。`);
    }
  };

  /** アクティブなタブが「バックアップ ↔ 現在」の差分なら、その左右の URI を返す */
  const activeBackupDiff = (): { original: vscode.Uri; modified: vscode.Uri } | undefined => {
    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    return input instanceof vscode.TabInputTextDiff && input.original.scheme === BACKUP_SCHEME
      ? { original: input.original, modified: input.modified }
      : undefined;
  };

  const syncBackupDiffContext = () => {
    void vscode.commands.executeCommand('setContext', 'genkouSheet.backupDiffActive', Boolean(activeBackupDiff()));
  };

  const applyBackupInDiff = async () => {
    const diff = activeBackupDiff();
    if (!diff) {
      void vscode.window.showWarningMessage('バックアップとの差分画面を開いてから実行してください。');
      return;
    }
    const displayName = diff.original.query || path.basename(diff.modified.fsPath);
    const choice = await vscode.window.showWarningMessage(
      `「${displayName}」の全文を、左側のバックアップの内容に置き換えますか？（元に戻す (Undo) で取り消せます）`,
      { modal: true },
      '置き換える'
    );
    if (choice !== '置き換える') return;
    try {
      const text = await backupContentProvider.provideTextDocumentContent(diff.original, new vscode.CancellationTokenSource().token);
      await restoreSnapshotText(diff.modified, text ?? '', displayName);
    } catch (err) {
      void vscode.window.showErrorMessage(`バックアップを復元できませんでした: ${errorMessage(err)}`);
    }
  };

  const restoreBackup = async () => {
    const activeDoc = editorProvider.getActiveDocument() ?? vscode.window.activeTextEditor?.document;
    let sourceUri = activeDoc?.uri.toString();
    let displayName = activeDoc ? path.basename(activeDoc.fileName) : '';
    let snapshots = sourceUri ? backupStore.listSnapshots(sourceUri) : [];

    if (snapshots.length === 0) {
      const entries = backupStore.listEntries();
      if (entries.length === 0) {
        void vscode.window.showInformationMessage('復元できるバックアップはまだありません。');
        return;
      }
      const picked = await vscode.window.showQuickPick(
        entries.map((e) => ({
          label: `$(file) ${e.displayName}`,
          description: new Date(e.updatedAt).toLocaleString('ja-JP'),
          detail: e.sourceUri.startsWith('file:') ? vscode.Uri.parse(e.sourceUri).fsPath : e.sourceUri,
          entry: e,
        })),
        { title: 'バックアップから復元: 原稿を選択', matchOnDetail: true }
      );
      if (!picked) return;
      sourceUri = picked.entry.sourceUri;
      displayName = picked.entry.displayName;
      snapshots = backupStore.listSnapshotsByKey(picked.entry.key);
    }

    // 現在の原稿（開いていれば編集中の内容、閉じていればディスク上の内容）と同じ世代を見分けられるようにする
    let currentText: string | undefined;
    if (sourceUri) {
      const openDoc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === sourceUri);
      if (openDoc) currentText = openDoc.getText();
      else {
        const uri = vscode.Uri.parse(sourceUri);
        try {
          if (uri.scheme === 'file') currentText = fs.readFileSync(uri.fsPath, 'utf-8');
        } catch {
          // 削除済みなど
        }
      }
    }

    const snapshotItems = snapshots.map((s) => {
      let text = '';
      try {
        text = backupStore.readSnapshot(s);
      } catch {
        // 読めないスナップショットは空として表示
      }
      const firstLine = text.split(/\r?\n/).find((l) => l.trim()) ?? '';
      return {
        label: `$(history) ${new Date(s.updatedAt).toLocaleString('ja-JP')}`,
        description: `${text.length.toLocaleString()}文字${text === currentText ? '（現在の原稿と同じ）' : ''}`,
        detail: firstLine.trim().slice(0, 60),
        snapshot: s,
        text,
      };
    });
    const pickedSnapshot = await vscode.window.showQuickPick(snapshotItems, {
      title: `バックアップから復元: ${displayName}（新しい順）`,
    });
    if (!pickedSnapshot || !sourceUri) return;

    const target = vscode.Uri.parse(sourceUri);
    const targetExists = target.scheme === 'file' && fs.existsSync(target.fsPath);
    const actions = [
      ...(targetExists
        ? [
            { label: '$(diff) 現在の原稿との差分を表示', id: 'diff' as const },
            { label: '$(discard) 原稿をこの内容に戻す', description: '元に戻す (Undo) で取り消せます', id: 'restore' as const },
          ]
        : []),
      { label: '$(new-file) 新しい未保存タブで開く', id: 'open' as const },
    ];
    const action = await vscode.window.showQuickPick(actions, { title: 'バックアップの操作を選択' });
    if (!action) return;

    try {
      if (action.id === 'diff') {
        if (pickedSnapshot.text === currentText) {
          void vscode.window.showInformationMessage('このバックアップは現在の原稿と同じ内容です。より古い日時のバックアップを選ぶと差分を確認できます。');
          return;
        }
        await vscode.commands.executeCommand(
          'vscode.diff',
          snapshotUri(pickedSnapshot.snapshot, displayName),
          target,
          `${displayName}（バックアップ ↔ 現在）`
        );
        void vscode.window.showInformationMessage(
          '左がバックアップ、右が現在の原稿です。中央の矢印で変更箇所ごとに、右上のボタンで全文をバックアップの内容に戻せます。戻した後は保存してください。'
        );
      } else if (action.id === 'restore') {
        await restoreSnapshotText(target, pickedSnapshot.text, displayName);
      } else {
        const doc = await vscode.workspace.openTextDocument({ content: pickedSnapshot.text, language: 'plaintext' });
        await vscode.window.showTextDocument(doc, { preview: false });
      }
    } catch (err) {
      void vscode.window.showErrorMessage(`バックアップを復元できませんでした: ${errorMessage(err)}`);
    }
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

  editorProvider = new GenkouEditorProvider(
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
    vscode.workspace.registerTextDocumentContentProvider(BACKUP_SCHEME, backupContentProvider),
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
    vscode.commands.registerCommand('genkouSheet.restoreBackup', restoreBackup),
    vscode.commands.registerCommand('genkouSheet.applyBackupInDiff', applyBackupInDiff),
    vscode.window.tabGroups.onDidChangeTabs(syncBackupDiffContext),
    vscode.window.tabGroups.onDidChangeTabGroups(syncBackupDiffContext),
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
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.contentChanges.length > 0) scheduleBackup(e.document);
    }),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      if (backupTimers.has(doc.uri.toString())) backupNow(doc);
    }),
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (backupTimers.has(doc.uri.toString())) backupNow(doc);
      treeProvider.refresh();
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('genkouSheet.charsPerLine') || e.affectsConfiguration('genkouSheet.linesPerPage')) {
        treeProvider.refresh();
      }
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(syncFolderContext),
    { dispose: flushAllBackups },
    {
      dispose: () => {
        if (statusTimer) clearTimeout(statusTimer);
      },
    }
  );

  syncFolderContext();
}

export function deactivate(): void {
  // 未書き込みのバックアップは context.subscriptions の dispose で書き出す
}
