# Marketplace・GitHub 公開仕様書 (Publishing & Release Specification)

## 1. 公開ターゲット
1. **Visual Studio Code Marketplace**（および Open VSX Registry 対応可能構成）
2. **GitHub Public Repository**（OSSとして公開）

---

## 2. `package.json` 必須メタデータ仕様

Marketplace 公開審査および検索性（SEO）を満たすため、`package.json` に以下のフィールドを完備する。

```json
{
  "name": "genkou-sheet",
  "displayName": "Genkou Sheet - 原稿用紙エディタ",
  "description": "原稿用紙のマス目（緑・赤罫線、縦書き・横書き）に直接タイピングできる小説・文章執筆用VS Code拡張機能。対象フォルダー限定動作、ルビ・禁則処理、文字数・枚数カウント、原稿ツリー管理に対応。",
  "version": "0.1.0",
  "publisher": "<publisher-id>",
  "license": "MIT",
  "engines": {
    "vscode": "^1.85.0"
  },
  "activationEvents": [
    "workspaceContains:.genkou.json"
  ],
  "categories": [
    "Other"
  ],
  "keywords": [
    "novel",
    "japanese",
    "vertical",
    "genkou",
    "原稿用紙",
    "縦書き",
    "小説",
    "執筆"
  ],
  "icon": "assets/icon.png",
  "repository": {
    "type": "git",
    "url": "https://github.com/<owner>/genkou-sheet.git"
  }
}
```

---

## 3. パッケージング・バンドル戦略

* **バンドラ:** `esbuild` を使用し、Extension Host 用スクリプト（`dist/extension.js`）と Webview 用スクリプト（`dist/webview.js`）を高速・軽量にバンドルする。
* **ランタイム依存ゼロ:** `node_modules` を `.vsix` に同梱せず、単一バンドル化することでインストールサイズを最小化（目標 500KB 未満）し、起動速度を最大化する。
* **型定義の固定:** `@types/vscode` は `engines.vscode` と同じ下限（`~1.85.0`）に固定し、対応バージョンに存在しない API を使っていないことを型チェックで保証する。
* **カテゴリー:** Marketplace の公式カテゴリー一覧にある値のみを使う（`Custom Editors` は公式カテゴリーではなく、`Formatters` は機能と合わないため使わない）。
* **activationEvents:** VS Code 1.74 以降はコマンド・カスタムエディタ・ビューの起動イベントが自動生成されるため、`workspaceContains:.genkou.json` のみを記載する。
* **`.vscodeignore` 設計:**
  * `.memory/`、`docs/`、`src/`、`test/`、設定ファイル群を `.vsix` パッケージから除外し、`dist/`、`assets/`、`README.md`、`CHANGELOG.md`、`LICENSE` のみをパッケージに含める。

---

## 4. セキュリティおよび品質要件

1. **厳格な Content Security Policy (CSP):**
   Webview HTML では `nonce` ベースのスクリプト実行のみを許可し、インラインスクリプトや外部ネットワーク接続を完全に遮断する。
   出力 HTML に埋め込む設定値は `sanitizeGenkouConfig` で正規化し、文字列はすべて HTML エスケープする。
   ```html
   <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource};">
   ```
2. **他プロジェクトへの非干渉保証:**
   `customEditors` の `priority` は必ず `"option"` とし、`activationEvents` およびコマンド実行によって対象フォルダー（`.vscode/settings.json` または `.genkou.json` が存在するワークスペース）以外では自動で `.txt` / `.md` を乗っ取らない設計を厳守する。
3. **OSS 標準ドキュメントの整備:**
   * `README.md`: スクリーンショット／GIFデモ、クイックスタート（フォルダーの有効化手順）、機能一覧、キーボード操作、出力・バックアップ復元の手順、設定一覧、既知の制限を記載。Marketplace の利用者向けページになるため、開発者・AI 向けの内部ドキュメント（`docs/`、`AGENTS.md`）へのリンクは載せない。
   * `CHANGELOG.md`: Keep a Changelog 形式でバージョン履歴を管理。
   * `LICENSE`: MIT License。
