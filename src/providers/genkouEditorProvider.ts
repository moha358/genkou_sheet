/**
 * Custom Text Editor Provider (原稿用紙カスタムエディタプロバイダー)
 */

import * as crypto from 'crypto';
import * as path from 'path';
import * as vscode from 'vscode';
import { computeMinimalEdit } from '../core/textDiff';
import {
  GenkouConfig,
  HostToWebviewMessage,
  sanitizeGenkouConfig,
  WebviewToHostMessage,
} from '../core/theme';
import { EDITOR_VIEW_TYPE } from '../services/workspaceService';

export function readGenkouConfigFromVscode(): GenkouConfig {
  const cfg = vscode.workspace.getConfiguration('genkouSheet');
  // 設定値はワークスペースの settings.json から任意の値を書き込めるため、必ず正規化してから使う
  return sanitizeGenkouConfig({
    enabled: cfg.get('enabled'),
    writingMode: cfg.get('writingMode'),
    gridColor: cfg.get('gridColor'),
    charsPerLine: cfg.get('charsPerLine'),
    linesPerPage: cfg.get('linesPerPage'),
    autoIndent: cfg.get('autoIndent'),
    highlightDialogue: cfg.get('highlightDialogue'),
  });
}

const WEBVIEW_CONFIG_KEYS: ReadonlyArray<keyof GenkouConfig> = [
  'writingMode',
  'gridColor',
  'charsPerLine',
  'linesPerPage',
  'autoIndent',
  'highlightDialogue',
];

/** Webview 側は常に LF で扱い、CRLF 文書との間で改行コードを相互変換する */
function toWebviewText(document: vscode.TextDocument): string {
  const text = document.getText();
  return document.eol === vscode.EndOfLine.CRLF ? text.replace(/\r\n/g, '\n') : text;
}

function fromWebviewText(document: vscode.TextDocument, text: string): string {
  return document.eol === vscode.EndOfLine.CRLF ? text.replace(/\r?\n/g, '\r\n') : text;
}

export class GenkouEditorProvider implements vscode.CustomTextEditorProvider {
  public static readonly viewType = EDITOR_VIEW_TYPE;
  private activeDocument: vscode.TextDocument | undefined;
  private readonly openDocuments = new Map<string, number>();

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly onDocumentUpdated: (doc: vscode.TextDocument) => void,
    private readonly onExportRequested: (
      doc: vscode.TextDocument,
      format: 'html' | 'combined'
    ) => void
  ) {}

  /** 現在フォーカスされている原稿用紙エディタの文書（無ければ undefined） */
  public getActiveDocument(): vscode.TextDocument | undefined {
    return this.activeDocument;
  }

  /** 原稿用紙エディタで開かれている文書か */
  public isOpenInGenkou(document: vscode.TextDocument): boolean {
    return this.openDocuments.has(document.uri.toString());
  }

  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    const docKey = document.uri.toString();
    this.openDocuments.set(docKey, (this.openDocuments.get(docKey) ?? 0) + 1);
    this.activeDocument = document;
    this.onDocumentUpdated(document);

    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, 'dist'),
        vscode.Uri.joinPath(this.context.extensionUri, 'assets'),
      ],
    };

    webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);

    let applyingWebviewText: string | undefined;

    const postToWebview = (message: HostToWebviewMessage) => {
      void webviewPanel.webview.postMessage(message);
    };

    const msgSubscription = webviewPanel.webview.onDidReceiveMessage(
      async (msg: WebviewToHostMessage) => {
        switch (msg.type) {
          case 'READY': {
            postToWebview({
              type: 'INIT_DOCUMENT',
              text: toWebviewText(document),
              config: readGenkouConfigFromVscode(),
              version: document.version,
              fileName: path.basename(document.fileName),
            });
            break;
          }
          case 'EDIT_TEXT': {
            let accepted = msg.version === document.version;
            const nextText = fromWebviewText(document, msg.text);
            const current = document.getText();
            const diff = accepted ? computeMinimalEdit(current, nextText) : null;
            if (diff) {
              applyingWebviewText = nextText;
              try {
                const edit = new vscode.WorkspaceEdit();
                edit.replace(
                  document.uri,
                  new vscode.Range(document.positionAt(diff.start), document.positionAt(diff.end)),
                  diff.text
                );
                accepted = await vscode.workspace.applyEdit(edit);
              } finally {
                applyingWebviewText = undefined;
              }
            }
            postToWebview({ type: 'EDIT_RESULT', accepted, text: toWebviewText(document), version: document.version });
            break;
          }
          case 'PRESERVE_CONFLICT': {
            const recovered = await vscode.workspace.openTextDocument({ content: msg.text, language: document.languageId });
            await vscode.window.showTextDocument(recovered, { preview: false, viewColumn: vscode.ViewColumn.Beside });
            void vscode.window.showWarningMessage('原稿の編集が競合したため、未反映の内容を新しい未保存文書に退避しました。内容を確認して保存してください。');
            break;
          }
          case 'UPDATE_CONFIG': {
            const cfg = vscode.workspace.getConfiguration('genkouSheet');
            const target = vscode.workspace.workspaceFolders?.length
              ? vscode.ConfigurationTarget.Workspace
              : vscode.ConfigurationTarget.Global;
            const merged = sanitizeGenkouConfig({ ...readGenkouConfigFromVscode(), ...msg.partialConfig });
            try {
              for (const key of WEBVIEW_CONFIG_KEYS) {
                if (msg.partialConfig[key] !== undefined) {
                  await cfg.update(key, merged[key], target);
                }
              }
            } catch (err) {
              void vscode.window.showErrorMessage(`原稿用紙の設定を保存できませんでした: ${err instanceof Error ? err.message : String(err)}`);
            }
            break;
          }
          case 'REQUEST_EXPORT': {
            this.onExportRequested(document, msg.format);
            break;
          }
        }
      }
    );

    const changeDocSubscription = vscode.workspace.onDidChangeTextDocument(
      (e) => {
        if (e.document.uri.toString() !== document.uri.toString()) {
          return;
        }
        this.onDocumentUpdated(document);
        if (document.getText() !== applyingWebviewText && e.contentChanges.length > 0) {
          postToWebview({
            type: 'DOCUMENT_CHANGED',
            text: toWebviewText(document),
            version: document.version,
          });
        }
      }
    );

    const changeConfigSubscription =
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('genkouSheet')) {
          postToWebview({
            type: 'CONFIG_CHANGED',
            config: readGenkouConfigFromVscode(),
          });
          this.onDocumentUpdated(document);
        }
      });

    const viewStateSubscription = webviewPanel.onDidChangeViewState(() => {
      if (webviewPanel.active) {
        this.activeDocument = document;
        this.onDocumentUpdated(document);
      } else if (this.activeDocument === document) {
        this.activeDocument = undefined;
      }
    });

    webviewPanel.onDidDispose(() => {
      if (this.activeDocument === document) {
        this.activeDocument = undefined;
      }
      const remaining = (this.openDocuments.get(docKey) ?? 1) - 1;
      if (remaining > 0) this.openDocuments.set(docKey, remaining);
      else this.openDocuments.delete(docKey);
      msgSubscription.dispose();
      changeDocSubscription.dispose();
      changeConfigSubscription.dispose();
      viewStateSubscription.dispose();
    });
  }

  private getHtmlForWebview(webview: vscode.Webview): string {
    return buildWebviewHtml(webview, this.context.extensionUri, 'webview.js', 'Genkou Sheet');
  }
}

/**
 * 原稿用紙 Webview 共通の HTML を生成する（nonce 付き CSP・外部通信なし）
 */
export function buildWebviewHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  scriptFile: string,
  title: string
): string {
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', scriptFile));
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'globalTheme.css'));
  const nonce = crypto.randomBytes(16).toString('base64');
  const safeTitle = title.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource};" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${styleUri}" />
  <title>${safeTitle}</title>
</head>
<body>
  <div id="genkou-root" class="genkou-app"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}
