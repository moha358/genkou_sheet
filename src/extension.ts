/**
 * Extension Entrypoint (Genkou Sheet - 原稿用紙エディタ)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  buildWebviewHtml,
  GenkouEditorProvider,
  readGenkouConfigFromVscode,
} from './providers/genkouEditorProvider';
import {
  ManuscriptTreeItem,
  ManuscriptTreeProvider,
} from './providers/manuscriptTreeProvider';
import { StatusBarCounterProvider } from './providers/statusBarProvider';
import { CompareHostToWebviewMessage, CompareWebviewToHostMessage } from './core/theme';
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

  // 差分表示用の読み取り専用文書（genkou-backup: スキーム）。
  // パスを .txt / .md で終わらせないことで、執筆フォルダーの editorAssociations（*.txt → 原稿用紙エディタ）が
  // 差分画面に適用されず、色付きのテキスト差分で表示されるようにする。
  //   /<key>/<作成時刻ms>   … バックアップ世代
  //   /current/<連番>        … 差分を開いた時点の原稿の内容（メモリ上に保持）
  // query には復元先の原稿 URI（target）と表示名（name）を持たせる。
  const currentTexts = new Map<string, string>();
  let currentSeq = 0;

  const backupContentProvider: vscode.TextDocumentContentProvider = {
    provideTextDocumentContent(uri) {
      const [dir, name] = uri.path.replace(/^\//, '').split('/');
      if (dir === 'current') return currentTexts.get(name) ?? '';
      const snapshot = backupStore.listSnapshotsByKey(dir).find((s) => path.basename(s.filePath) === `${name}.txt`);
      return snapshot ? backupStore.readSnapshot(snapshot) : '';
    },
  };

  const diffQuery = (target: string, displayName: string) => new URLSearchParams({ target, name: displayName }).toString();

  const snapshotUri = (s: BackupSnapshot, target: string, displayName: string) =>
    vscode.Uri.from({ scheme: BACKUP_SCHEME, path: `/${s.key}/${path.basename(s.filePath, '.txt')}`, query: diffQuery(target, displayName) });

  const currentUri = (text: string, target: string, displayName: string) => {
    const id = String(++currentSeq);
    currentTexts.set(id, text);
    return vscode.Uri.from({ scheme: BACKUP_SCHEME, path: `/current/${id}`, query: diffQuery(target, displayName) });
  };

  /** 原稿をバックアップの内容に置き換える（Undo 可能。置き換え前の内容も新しい世代として退避する） */
  const restoreSnapshotText = async (target: vscode.Uri, text: string, displayName: string): Promise<boolean> => {
    const doc = await vscode.workspace.openTextDocument(target);
    backupNow(doc, true);
    const edit = new vscode.WorkspaceEdit();
    edit.replace(doc.uri, new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)), text);
    if (!(await vscode.workspace.applyEdit(edit))) return false;
    void vscode.window.showInformationMessage(`「${displayName}」をバックアップの内容に戻しました。確認後に保存してください。`);
    return true;
  };

  interface BackupDiffInfo {
    snapshot: vscode.Uri;
    target: vscode.Uri;
    displayName: string;
  }

  const diffInfoFrom = (snapshot: vscode.Uri): BackupDiffInfo | undefined => {
    const params = new URLSearchParams(snapshot.query);
    const target = params.get('target');
    return target ? { snapshot, target: vscode.Uri.parse(target), displayName: params.get('name') || path.basename(vscode.Uri.parse(target).path) } : undefined;
  };

  /** アクティブなタブがバックアップとの差分なら、そのバックアップと復元先を返す */
  const activeBackupDiff = (): BackupDiffInfo | undefined => {
    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    return input instanceof vscode.TabInputTextDiff && input.original.scheme === BACKUP_SCHEME
      ? diffInfoFrom(input.original)
      : undefined;
  };

  const syncBackupDiffContext = () => {
    void vscode.commands.executeCommand('setContext', 'genkouSheet.backupDiffActive', Boolean(activeBackupDiff()));
  };

  const applyBackup = async (diff: BackupDiffInfo) => {
    const choice = await vscode.window.showWarningMessage(
      `「${diff.displayName}」の全文を、左側のバックアップの内容に置き換えますか？（元に戻す (Undo) で取り消せます）`,
      { modal: true },
      '置き換える'
    );
    if (choice !== '置き換える') return;
    try {
      const text = await backupContentProvider.provideTextDocumentContent(diff.snapshot, new vscode.CancellationTokenSource().token);
      await restoreSnapshotText(diff.target, text ?? '', diff.displayName);
    } catch (err) {
      void vscode.window.showErrorMessage(`バックアップを復元できませんでした: ${errorMessage(err)}`);
    }
  };

  const applyBackupInDiff = async () => {
    const diff = activeBackupDiff();
    if (!diff) {
      void vscode.window.showWarningMessage('バックアップとの差分画面を開いてから実行してください。');
      return;
    }
    await applyBackup(diff);
  };

  /**
   * バックアップと現在の原稿を、原稿用紙2枚の並列表示で比較する。
   * 左右は連動してスクロールし、各ペインの「こちらを採用」で結果を確定する。
   */
  const openComparePanel = (info: { target: vscode.Uri; displayName: string; backupText: string; backupTime: number; currentText: string }) => {
    const panel = vscode.window.createWebviewPanel(
      'genkouSheet.compare',
      `${info.displayName}（バックアップと比較）`,
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist')],
      }
    );
    panel.webview.html = buildWebviewHtml(panel.webview, context.extensionUri, 'compare.js', 'バックアップと比較');
    const message: CompareHostToWebviewMessage = {
      type: 'INIT_COMPARE',
      config: readGenkouConfigFromVscode(),
      fileName: info.displayName,
      left: {
        label: 'バックアップ',
        detail: new Date(info.backupTime).toLocaleString('ja-JP'),
        text: info.backupText,
        adoptLabel: 'こちら（バックアップ）を採用',
      },
      right: {
        label: '現在の原稿',
        detail: '比較を開いた時点',
        text: info.currentText,
        adoptLabel: 'こちら（現在の原稿）を採用',
      },
    };
    panel.webview.onDidReceiveMessage(async (msg: CompareWebviewToHostMessage) => {
      if (msg.type === 'COMPARE_READY') {
        void panel.webview.postMessage(message);
      } else if (msg.type === 'ADOPT') {
        if (msg.side === 'right') {
          panel.dispose();
          void vscode.window.showInformationMessage(`「${info.displayName}」は現在の内容のまま変更していません。`);
          return;
        }
        try {
          if (await restoreSnapshotText(info.target, info.backupText, info.displayName)) panel.dispose();
        } catch (err) {
          void vscode.window.showErrorMessage(`バックアップを復元できませんでした: ${errorMessage(err)}`);
        }
      }
    });
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
            { label: '$(book) 原稿用紙で比較して、どちらかを採用', description: '左右連動・変更のある段落を強調', id: 'compare' as const },
            { label: '$(diff) テキストの差分を表示', id: 'diff' as const },
            { label: '$(discard) 原稿をこの内容に戻す', description: '元に戻す (Undo) で取り消せます', id: 'restore' as const },
          ]
        : []),
      { label: '$(new-file) 新しい未保存タブで開く', id: 'open' as const },
    ];
    const action = await vscode.window.showQuickPick(actions, { title: 'バックアップの操作を選択' });
    if (!action) return;

    try {
      if (action.id === 'compare') {
        openComparePanel({
          target,
          displayName,
          backupText: pickedSnapshot.text,
          backupTime: pickedSnapshot.snapshot.updatedAt,
          currentText: currentText ?? '',
        });
      } else if (action.id === 'diff') {
        if (pickedSnapshot.text === currentText) {
          void vscode.window.showInformationMessage('このバックアップは現在の原稿と同じ内容です。より古い日時のバックアップを選ぶと差分を確認できます。');
          return;
        }
        const left = snapshotUri(pickedSnapshot.snapshot, sourceUri, displayName);
        await vscode.commands.executeCommand(
          'vscode.diff',
          left,
          currentUri(currentText ?? '', sourceUri, displayName),
          `${displayName}（バックアップ ↔ 現在）`
        );
        syncBackupDiffContext();
        const replace = '全文をこのバックアップに置き換える';
        const picked = await vscode.window.showInformationMessage(
          '左がバックアップ、右が差分を開いた時点の原稿です。全文を戻すには、このボタンか差分画面右上のボタンを押してください。一部だけ戻す場合は、左側から必要な箇所をコピーしてください。',
          replace
        );
        if (picked === replace) {
          const info = diffInfoFrom(left);
          if (info) await applyBackup(info);
        }
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
    vscode.window.onDidChangeActiveTextEditor(syncBackupDiffContext),
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
      if (doc.uri.scheme === BACKUP_SCHEME && doc.uri.path.startsWith('/current/')) {
        currentTexts.delete(doc.uri.path.slice('/current/'.length));
      }
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
