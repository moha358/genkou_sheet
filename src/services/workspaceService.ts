/**
 * Workspace Isolation & Project Configuration Service (対象フォルダー限定管理サービス)
 * 指定されたフォルダーの .vscode/settings.json と .genkou.json のみを操作し、他のプロジェクトには一切干渉しない。
 */

import * as fs from 'fs';
import * as path from 'path';
import { applyEdits, modify, parse, ParseError } from 'jsonc-parser';
import { DEFAULT_GENKOU_CONFIG, GenkouConfig } from '../core/theme';

export const GENKOU_PROJECT_FILE = '.genkou.json';
export const EDITOR_VIEW_TYPE = 'genkouSheet.editor';

export interface GenkouProjectManifest {
  version: number;
  title: string;
  files: string[];
  config?: Partial<GenkouConfig>;
  enabled?: boolean;
  previousSettings?: { enabled?: unknown; associations: Record<string, unknown> };
}

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.vscode',
  '.memory',
  'dist',
  'out',
  'docs',
]);

const IGNORED_FILES = new Set([
  'README.md',
  'CHANGELOG.md',
  'AGENTS.md',
  'CLAUDE.md',
  'LICENSE.md',
]);

/**
 * 対象ディレクトリ直下に .genkou.json が存在するか、または .vscode/settings.json で有効化されているか判定する
 */
export function isFolderGenkouEnabled(workspaceRoot: string): boolean {
  const manifestPath = path.join(workspaceRoot, GENKOU_PROJECT_FILE);
  if (fs.existsSync(manifestPath)) {
    return readProjectManifest(workspaceRoot).enabled !== false;
  }
  const settingsPath = path.join(workspaceRoot, '.vscode', 'settings.json');
  if (fs.existsSync(settingsPath)) {
    try {
      const raw = fs.readFileSync(settingsPath, 'utf-8');
      const parsed = parse(raw);
      return Boolean(parsed['genkouSheet.enabled']);
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * ワークスペース内の原稿対象ファイル (.txt / .md) をスキャンする
 */
export function scanManuscriptFiles(workspaceRoot: string, subDir: string = ''): string[] {
  const fullDir = path.join(workspaceRoot, subDir);
  if (!fs.existsSync(fullDir)) {
    return [];
  }

  const results: string[] = [];
  const entries = fs.readdirSync(fullDir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name.startsWith('.')) {
      continue;
    }
    const relPath = subDir ? path.posix.join(subDir, entry.name) : entry.name;

    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) {
        results.push(...scanManuscriptFiles(workspaceRoot, relPath));
      }
    } else if (entry.isFile()) {
      if (IGNORED_FILES.has(entry.name)) {
        continue;
      }
      const ext = path.extname(entry.name).toLowerCase();
      if (ext === '.txt' || ext === '.md') {
        results.push(relPath);
      }
    }
  }

  return results.sort((a, b) => a.localeCompare(b, 'ja'));
}

/**
 * .genkou.json を読み込む（存在しない場合はデフォルト値を返す）
 */
export function readProjectManifest(workspaceRoot: string): GenkouProjectManifest {
  const manifestPath = path.join(workspaceRoot, GENKOU_PROJECT_FILE);
  const defaultTitle = path.basename(workspaceRoot);

  if (fs.existsSync(manifestPath)) {
    try {
      const raw = fs.readFileSync(manifestPath, 'utf-8');
      const data = JSON.parse(raw) as Partial<GenkouProjectManifest>;
      return {
        version: data.version ?? 1,
        title: typeof data.title === 'string' ? data.title : defaultTitle,
        files: Array.isArray(data.files) ? data.files : [],
        config: data.config ?? {},
        enabled: data.enabled,
        previousSettings: data.previousSettings,
      };
    } catch {
      // パース失敗時はフォールバック
    }
  }

  return {
    version: 1,
    title: defaultTitle,
    files: [],
    config: {},
  };
}

/**
 * .genkou.json を保存する
 */
export function writeProjectManifest(
  workspaceRoot: string,
  manifest: GenkouProjectManifest
): void {
  const manifestPath = path.join(workspaceRoot, GENKOU_PROJECT_FILE);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
}

/**
 * ワークスペース内の原稿ファイル一覧を .genkou.json の順序に従って取得・同期する
 */
export function getOrderedManuscriptFiles(workspaceRoot: string): string[] {
  const actualFiles = scanManuscriptFiles(workspaceRoot);
  const actualSet = new Set(actualFiles);
  const manifest = readProjectManifest(workspaceRoot);

  const ordered: string[] = [];
  for (const f of manifest.files) {
    if (actualSet.has(f)) {
      ordered.push(f);
      actualSet.delete(f);
    }
  }
  for (const remaining of actualFiles) {
    if (actualSet.has(remaining)) {
      ordered.push(remaining);
    }
  }

  if (
    fs.existsSync(path.join(workspaceRoot, GENKOU_PROJECT_FILE)) &&
    JSON.stringify(ordered) !== JSON.stringify(manifest.files)
  ) {
    manifest.files = ordered;
    writeProjectManifest(workspaceRoot, manifest);
  }

  return ordered;
}

/**
 * 原稿ツリー内のファイル順序を上下に移動する
 */
export function moveManuscriptFileOrder(
  workspaceRoot: string,
  relativeFilePath: string,
  direction: 'up' | 'down'
): string[] {
  const files = getOrderedManuscriptFiles(workspaceRoot);
  const idx = files.indexOf(relativeFilePath);
  if (idx === -1) {
    return files;
  }
  const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (targetIdx < 0 || targetIdx >= files.length) {
    return files;
  }

  const swapped = [...files];
  const temp = swapped[idx];
  swapped[idx] = swapped[targetIdx];
  swapped[targetIdx] = temp;

  const manifest = readProjectManifest(workspaceRoot);
  manifest.files = swapped;
  writeProjectManifest(workspaceRoot, manifest);
  return swapped;
}

/**
 * 対象フォルダーを原稿執筆プロジェクトとして有効化する
 * (.vscode/settings.json の workbench.editorAssociations と .genkou.json を構成)
 */
function readSettings(settingsPath: string): { text: string; settings: Record<string, unknown> } {
  const text = fs.existsSync(settingsPath) ? fs.readFileSync(settingsPath, 'utf-8') : '{}';
  const errors: ParseError[] = [];
  const settings: unknown = parse(text, errors, { allowTrailingComma: true });
  if (errors.length || !settings || typeof settings !== 'object' || Array.isArray(settings)) {
    throw new Error('settings.json を読み取れません。設定ファイルを修正してから再実行してください。');
  }
  return { text, settings: settings as Record<string, unknown> };
}

function updateSetting(text: string, key: string, value: unknown): string {
  return applyEdits(text, modify(text, [key], value, {
    formattingOptions: { insertSpaces: true, tabSize: 2 },
  }));
}

export function enableGenkouInFolder(workspaceRoot: string): void {
  const vscodeDir = path.join(workspaceRoot, '.vscode');
  const settingsPath = path.join(vscodeDir, 'settings.json');
  const { text, settings } = readSettings(settingsPath);
  const manifestPath = path.join(workspaceRoot, GENKOU_PROJECT_FILE);
  const manifest = readProjectManifest(workspaceRoot);
  const associations = settings['workbench.editorAssociations'];
  if (associations !== undefined && (!associations || typeof associations !== 'object' || Array.isArray(associations))) {
    throw new Error('workbench.editorAssociations の形式を確認してください。');
  }
  const existing = (associations ?? {}) as Record<string, unknown>;
  if (!manifest.previousSettings) {
    const previous: Record<string, unknown> = {};
    for (const key of ['*.txt', '*.md']) {
      if (Object.hasOwn(existing, key)) previous[key] = existing[key];
    }
    manifest.previousSettings = { enabled: settings['genkouSheet.enabled'], associations: previous };
  }
  if (!fs.existsSync(manifestPath)) manifest.files = scanManuscriptFiles(workspaceRoot);
  manifest.enabled = true;
  const nextAssociations = { ...existing, '*.txt': EDITOR_VIEW_TYPE, '*.md': EDITOR_VIEW_TYPE };
  const updated = updateSetting(updateSetting(text, 'genkouSheet.enabled', true), 'workbench.editorAssociations', nextAssociations);
  fs.mkdirSync(vscodeDir, { recursive: true });
  writeProjectManifest(workspaceRoot, manifest);
  fs.writeFileSync(settingsPath, updated, 'utf-8');
}

export function disableGenkouInFolder(workspaceRoot: string): void {
  const settingsPath = path.join(workspaceRoot, '.vscode', 'settings.json');
  const manifest = readProjectManifest(workspaceRoot);
  if (fs.existsSync(settingsPath)) {
    const { text, settings } = readSettings(settingsPath);
    const current = settings['workbench.editorAssociations'];
    if (current !== undefined && (!current || typeof current !== 'object' || Array.isArray(current))) {
      throw new Error('workbench.editorAssociations の形式を確認してください。');
    }
    const associations = { ...(current as Record<string, unknown> | undefined) };
    for (const key of ['*.txt', '*.md']) {
      if (associations[key] === EDITOR_VIEW_TYPE) {
        if (manifest.previousSettings && Object.hasOwn(manifest.previousSettings.associations, key)) {
          associations[key] = manifest.previousSettings.associations[key];
        } else delete associations[key];
      }
    }
    const enabled = settings['genkouSheet.enabled'] === true ? manifest.previousSettings?.enabled : settings['genkouSheet.enabled'];
    const updated = updateSetting(updateSetting(text, 'genkouSheet.enabled', enabled), 'workbench.editorAssociations', Object.keys(associations).length ? associations : undefined);
    fs.writeFileSync(settingsPath, updated, 'utf-8');
  }
  manifest.enabled = false;
  delete manifest.previousSettings;
  writeProjectManifest(workspaceRoot, manifest);
}
