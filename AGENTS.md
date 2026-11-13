# AGENTS.md — Multi-AI Orchestration & Development Guide

このリポジトリは、複数のAIエージェント（コーディネーター、サブエージェント、ワーカー）が協調して **VS Code 拡張機能「Genkou Sheet（原稿用紙エディタ）」** を開発・公開できるよう設計されています。

---

## 1. エージェント起動時の必須プロトコル (Boot Sequence)

作業を開始するすべてのAIエージェントは、コードを書く前に**必ず以下の順序で永続メモリーと仕様書を確認**してください。

1. **[.memory/handoff.md](./.memory/handoff.md)**: 現在のフェーズ、直前の作業内容、次に着手すべきタスクを確認する。
2. **[.memory/project-context.md](./.memory/project-context.md)**: プロジェクトの不変ルール（対象フォルダー限定動作、グローバルテーマによるスタイル一元管理など）を確認する。
3. **[.memory/decisions.md](./.memory/decisions.md)**: 確定済みのアーキテクチャ意思決定（ADR-001〜005）を確認する（合意済みの決定を独断で変更しないこと）。
4. **[.memory/tasks.md](./.memory/tasks.md)**: 自身の担当タスク（スコープ対象ファイル）と検証基準（Verify条件）を確認する。

---

## 2. 詳細仕様ドキュメントの格納場所 (`docs/`)

| ディレクトリ / ファイル | 内容 |
| :--- | :--- |
| **[docs/requirements/requirements.md](./docs/requirements/requirements.md)** | 機能要件（FR-01〜04）・非機能要件（NFR-01〜04）の定義 |
| **[docs/specs/architecture.md](./docs/specs/architecture.md)** | システム構成図、ディレクトリ構成、対象フォルダー限定機構、Host⇔Webview通信規約、Global Theme設計 |
| **[docs/specs/grid-and-typography.md](./docs/specs/grid-and-typography.md)** | 400字詰め原稿用紙の視覚構造、ルビ・傍点パース、20マス目句読点ぶら下げ（禁則処理）、直接入力・IME制御仕様 |
| **[docs/specs/publishing.md](./docs/specs/publishing.md)** | VS Code Marketplace および GitHub 公開に向けたメタデータ、バンドル、CSPセキュリティ仕様 |

---

## 3. マルチエージェント並列作業のルール (Orchestration Rules)

1. **ファイル責務（Ownership）の厳守:**
   複数のワーカーが同時に作業する場合、[.memory/tasks.md](./.memory/tasks.md) に記載された「担当スコープ」外のファイルを無断で編集しないこと。
   * **Core Agent:** `src/core/**`, `test/core/**`
   * **Host / Services Agent:** `src/providers/**`, `src/services/**`, `src/extension.ts`
   * **Webview UI Agent:** `src/webview/**`
2. **インターフェース契約の維持:**
   Host ⇔ Webview 間のメッセージ型や `src/core/` の公開関数シグネチャを変更する場合は、先に `docs/specs/architecture.md` を更新して整合性を保つこと。
3. **スタイルのハードコード厳禁:**
   UI要素の色・フォント・余白・サイズ・角丸・影はすべて `src/core/theme.ts` および `src/webview/styles/globalTheme.css` の CSS Variables で一元管理すること。
4. **作業完了時のメモリー更新:**
   タスクが完了し Verify 条件をクリアしたら、必ず [.memory/tasks.md](./.memory/tasks.md) のチェックボックスを `[x]` に更新し、[.memory/handoff.md](./.memory/handoff.md) に進捗と引き継ぎ事項を記録すること。
