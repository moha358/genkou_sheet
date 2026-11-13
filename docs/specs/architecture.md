# アーキテクチャ・技術仕様書 (Architecture Specification)

## 1. システム全体構成

本拡張機能は **Extension Host（Node.js / TypeScript）** と **Webview（ブラウザ環境 / TypeScript + CSS Grid/Canvas）** の2層で構成され、クリーンアーキテクチャの原則に従い責務を明確に分離する。

```mermaid
flowchart TD
    subgraph ExtensionHost["Extension Host (Node.js)"]
        Entry["extension.ts (Activation & Commands)"]
        WorkspaceMgr["WorkspaceInitializer (対象フォルダー限定管理)"]
        CustomEditor["GenkouEditorProvider (CustomTextEditorProvider)"]
        TreeProvider["ManuscriptTreeProvider (原稿ツリー・順序管理)"]
        StatusBar["StatusBarCounter (文字数・枚数集計)"]
        Exporter["HtmlPdfExporter (組版・HTML/PDF出力)"]
    end

    subgraph CoreDomain["Core Domain (Pure TypeScript / 共有ロジック)"]
        Parser["AozoraParser (ルビ・傍点・会話文解析)"]
        LayoutEngine["GenkouLayoutEngine (禁則処理・マス目割り付け・枚数計算)"]
        ThemeTokens["GlobalThemeTokens (色・フォント・サイズ一元管理)"]
    end

    subgraph WebviewUI["Webview UI (Custom Editor Screen)"]
        Toolbar["EditorToolbar (縦横・テーマ・サイズ切替・ルビ挿入)"]
        SheetView["GenkouSheetRenderer (原稿用紙グリッド・柱・魚尾・ルビ描画)"]
        InputCtrl["GridInputController (直接入力・IME変換・カーソル制御)"]
    end

    Entry --> WorkspaceMgr
    Entry --> CustomEditor
    Entry --> TreeProvider
    Entry --> StatusBar
    Entry --> Exporter

    CustomEditor <-->|"postMessage (JSON Protocol)"| WebviewUI
    CustomEditor --> CoreDomain
    TreeProvider --> CoreDomain
    StatusBar --> CoreDomain
    Exporter --> CoreDomain
    WebviewUI --> CoreDomain
```

---

## 2. ディレクトリ構造（実装時のターゲット構成）

```text
genkou_sheet/
├── AGENTS.md                        # マルチAIエージェント共通ガイドライン
├── CLAUDE.md                        # Claude Code / AI向けエントリポイント
├── .memory/                         # マルチAIオーケストレーション用永続メモリー
│   ├── project-context.md           # プロジェクト全体コンテキスト・不変ルール
│   ├── decisions.md                 # アーキテクチャ意思決定記録 (ADR)
│   ├── tasks.md                     # タスク分解・進捗・検証基準ボード
│   └── handoff.md                   # エージェント間引き継ぎ・最新状態ログ
├── docs/                            # ドキュメント格納ディレクトリ
│   ├── requirements/
│   │   └── requirements.md          # 要件定義書
│   └── specs/
│       ├── architecture.md          # アーキテクチャ仕様書（本ファイル）
│       ├── grid-and-typography.md   # 原稿用紙組版・UI仕様書
│       └── publishing.md            # Marketplace・GitHub公開仕様書
├── src/
│   ├── extension.ts                 # エントリポイント
│   ├── core/                        # 環境非依存の純粋ロジック（単体テスト対象）
│   │   ├── parser.ts                # 青空文庫ルビ・傍点・会話文パーサー
│   │   ├── layoutEngine.ts          # マス目割り付け・禁則処理・枚数計算エンジン
│   │   ├── counter.ts               # 文字数・原稿用紙換算カウントロジック
│   │   └── theme.ts                 # グローバルテーマ定義（Design Tokens）
│   ├── providers/                   # VS Code API 連携層
│   │   ├── genkouEditorProvider.ts  # CustomTextEditorProvider 実装
│   │   ├── manuscriptTreeProvider.ts# 原稿ツリー TreeDataProvider 実装
│   │   └── statusBarProvider.ts     # StatusBarItem 制御
│   ├── services/                    # ワークスペース操作・出力サービス
│   │   ├── workspaceService.ts      # 対象フォルダー初期化・解除 (.genkou.json)
│   │   └── exportService.ts         # HTML / PDF 組版出力サービス
│   └── webview/                     # Webview フロントエンド実装
│       ├── index.ts                 # Webview エントリ
│       ├── components/              # 疎結合UIコンポーネント群
│       │   ├── Toolbar.ts           # 上部ツールバー
│       │   ├── GenkouPage.ts        # 原稿用紙1ページ（20×20・柱・魚尾）描画
│       │   ├── RubyModal.ts         # ルビ・傍点編集ポップオーバー
│       │   └── InputController.ts   # IME・カーソル・直接入力ハンドラ
│       └── styles/
│           └── globalTheme.css      # CSS Variables による一元管理スタイル
└── test/                            # 自動テスト
    ├── core/
    │   ├── parser.test.ts
    │   └── layoutEngine.test.ts
    └── integration/
```

---

## 3. 対象フォルダー限定の動作制御仕様

他のプロジェクトへの影響をゼロにするため、以下の2段階のガードを設ける。

1. **Workspace 設定による Editor Association 制御:**
   * `package.json` の `contributes.customEditors` では、`priority` を `"option"` に設定する。これにより、拡張機能をインストールしただけでは、どのフォルダーの `.txt` / `.md` も勝手には原稿用紙エディタで開かない。
   * ユーザーが対象フォルダーで `Genkou: このフォルダーを執筆プロジェクトとして有効化` を実行したときのみ、そのワークスペースの `.vscode/settings.json` に以下を書き込む：
     ```json
     {
       "genkouSheet.enabled": true,
       "workbench.editorAssociations": {
         "*.txt": "genkouSheet.editor",
         "*.md": "genkouSheet.editor"
       }
     }
     ```
2. **`.genkou.json` によるプロジェクト設定・原稿順序管理:**
   * 対象フォルダー直下に `.genkou.json` を作成し、原稿ツリーの並び順やデフォルトの用紙設定（色・縦横・字数×行数）を保存する。

---

## 4. Extension Host ⇔ Webview メッセージングプロトコル

型安全な判別共用体（Discriminated Unions）で通信を行う。

### Host → Webview (`HostToWebviewMessage`)
* `INIT_DOCUMENT`: `{ type: 'INIT_DOCUMENT', text: string, config: GenkouConfig, version: number }`
* `DOCUMENT_CHANGED`: `{ type: 'DOCUMENT_CHANGED', text: string, version: number }`（外部変更やUndo/Redo時）
* `CONFIG_CHANGED`: `{ type: 'CONFIG_CHANGED', config: GenkouConfig }`

### Webview → Host (`WebviewToHostMessage`)
* `READY`: `{ type: 'READY' }`
* `EDIT_TEXT`: `{ type: 'EDIT_TEXT', text: string, range?: TextRange, version: number }`
* `UPDATE_CONFIG`: `{ type: 'UPDATE_CONFIG', partialConfig: Partial<GenkouConfig> }`
* `REQUEST_EXPORT`: `{ type: 'REQUEST_EXPORT', format: 'html' | 'print' }`

---

## 5. グローバルテーマ設計 (Global Theme Management)

コンポーネント内でのスタイル直書き（ハードコード）を禁止し、`src/core/theme.ts` および `globalTheme.css` の CSS カスタムプロパティ（Design Tokens）で一元管理する。

| カテゴリ | トークン例 | 説明 |
| :--- | :--- | :--- |
| **Color Palette** | `--genkou-paper-bg`, `--genkou-grid-primary`, `--genkou-grid-sub`, `--genkou-text-main`, `--genkou-text-dialogue`, `--genkou-cursor-bg` | 緑罫線（コクヨ風）、赤罫線（丸善風）、ダークテーマをクラス切替のみで反映 |
| **Typography** | `--genkou-font-family`, `--genkou-cell-font-size`, `--genkou-ruby-font-size` | 游明朝・ヒラギノ明朝・Noto Serif JP 等の明朝体フォールバックと比率定義 |
| **Spacing & Grid** | `--genkou-cell-size`, `--genkou-ruby-gap`, `--genkou-page-padding`, `--genkou-hashira-width` | 1マスの寸法、ルビ欄の幅、中央の柱（魚尾エリア）の寸法 |
| **Radius & Shadow** | `--genkou-border-radius`, `--genkou-page-shadow` | 原稿用紙のドロップシャドウおよびツールバー・モーダルの角丸 |
