/**
 * Custom Text Editor Provider (原稿用紙カスタムエディタプロバイダー)
 */

import * as crypto from 'crypto';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  DEFAULT_GENKOU_CONFIG,
  GenkouConfig,
  GridColorTheme,
  HostToWebviewMessage,
  WebviewToHostMessage,
  WritingMode,
} from '../core/theme';
import { EDITOR_VIEW_TYPE } from '../services/workspaceService';

export function readGenkouConfigFromVscode(): GenkouConfig {
  const cfg = vscode.workspace.getConfiguration('genkouSheet');
  return {
    enabled: cfg.get<boolean>('enabled', DEFAULT_GENKOU_CONFIG.enabled),
    writingMode: cfg.get<WritingMode>(
      'writingMode',
      DEFAULT_GENKOU_CONFIG.writingMode
    ),
    gridColor: cfg.get<GridColorTheme>(
      'gridColor',
      DEFAULT_GENKOU_CONFIG.gridColor
    ),
    charsPerLine: cfg.get<number>(
      'charsPerLine',
      DEFAULT_GENKOU_CONFIG.charsPerLine
    ),
    linesPerPage: cfg.get<number>(
      'linesPerPage',
      DEFAULT_GENKOU_CONFIG.linesPerPage
    ),
    autoIndent: cfg.get<boolean>(
      'autoIndent',
      DEFAULT_GENKOU_CONFIG.autoIndent
    ),
    highlightDialogue: cfg.get<boolean>(
      'highlightDialogue',
      DEFAULT_GENKOU_CONFIG.highlightDialogue
    ),
  };
}

export class GenkouEditorProvider implements vscode.CustomTextEditorProvider {
  public static readonly viewType = EDITOR_VIEW_TYPE;
  private activeDocument: vscode.TextDocument | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly onDocumentUpdated: (doc: vscode.TextDocument) => void,
    private readonly onExportRequested: (
      doc: vscode.TextDocument,
      format: 'html' | 'combined'
    ) => void
  ) {}

  public getActiveDocument(): vscode.TextDocument | undefined {
    return this.activeDocument;
  }

  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
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

    let isApplyingWebviewEdit = false;

    const postToWebview = (message: HostToWebviewMessage) => {
      void webviewPanel.webview.postMessage(message);
    };

    const msgSubscription = webviewPanel.webview.onDidReceiveMessage(
      async (msg: WebviewToHostMessage) => {
        switch (msg.type) {
          case 'READY': {
            postToWebview({
              type: 'INIT_DOCUMENT',
              text: document.getText(),
              config: readGenkouConfigFromVscode(),
              version: document.version,
              fileName: path.basename(document.fileName),
            });
            break;
          }
          case 'EDIT_TEXT': {
            if (msg.text === document.getText()) {
              return;
            }
            isApplyingWebviewEdit = true;
            try {
              const edit = new vscode.WorkspaceEdit();
              const fullRange = new vscode.Range(
                document.positionAt(0),
                document.positionAt(document.getText().length)
              );
              edit.replace(document.uri, fullRange, msg.text);
              await vscode.workspace.applyEdit(edit);
              this.onDocumentUpdated(document);
            } finally {
              isApplyingWebviewEdit = false;
            }
            break;
          }
          case 'UPDATE_CONFIG': {
            const cfg = vscode.workspace.getConfiguration('genkouSheet');
            const entries = Object.entries(msg.partialConfig) as [
              keyof GenkouConfig,
              unknown,
            ][];
            for (const [key, val] of entries) {
              if (val !== undefined) {
                await cfg.update(
                  key,
                  val,
                  vscode.ConfigurationTarget.Workspace
                );
              }
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
        if (!isApplyingWebviewEdit && e.contentChanges.length > 0) {
          postToWebview({
            type: 'DOCUMENT_CHANGED',
            text: document.getText(),
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
      }
    });

    webviewPanel.onDidDispose(() => {
      msgSubscription.dispose();
      changeDocSubscription.dispose();
      changeConfigSubscription.dispose();
      viewStateSubscription.dispose();
    });
  }

  private getHtmlForWebview(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview.js')
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'globalTheme.css')
    );
    const nonce = crypto.randomBytes(16).toString('base64');

    return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource};" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${styleUri}" />
  <title>Genkou Sheet</title>
</head>
<body>
  <div id="genkou-root" class="genkou-app"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
