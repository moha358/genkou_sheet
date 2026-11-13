/**
 * Workspace Isolation & Project Configuration Service (対象フォルダー限定管理サービス)
 * 指定されたフォルダーの .vscode/settings.json と .genkou.json のみを操作し、他のプロジェクトには一切干渉しない。
 */

import * as fs from 'fs';
import * as path from 'path';
import { DEFAULT_GENKOU_CONFIG, GenkouConfig } from '../core/theme';

export const GENKOU_PROJECT_FILE = '.genkou.json';
export const EDITOR_VIEW_TYPE = 'genkouSheet.editor';

export interface GenkouProjectManifest {
  version: number;
  title: string;
  files: string[];
  config?: Partial<GenkouConfig>;
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
    return true;
  }
  const settingsPath = path.join(workspaceRoot, '.vscode', 'settings.json');
  if (fs.existsSync(settingsPath)) {
    try {
      const raw = fs.readFileSync(settingsPath, 'utf-8');
      const parsed = JSON.parse(raw);
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
        title: data.title ?? defaultTitle,
        files: Array.isArray(data.files) ? data.files : [],
        config: data.config ?? {},
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
export function enableGenkouInFolder(workspaceRoot: string): void {
  const vscodeDir = path.join(workspaceRoot, '.vscode');
  if (!fs.existsSync(vscodeDir)) {
    fs.mkdirSync(vscodeDir, { recursive: true });
  }

  const settingsPath = path.join(vscodeDir, 'settings.json');
  let settings: Record<string, unknown> = {};
  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    } catch {
      settings = {};
    }
  }

  const existingAssociations =
    typeof settings['workbench.editorAssociations'] === 'object' &&
    settings['workbench.editorAssociations'] !== null
      ? (settings['workbench.editorAssociations'] as Record<string, string>)
      : {};

  settings['genkouSheet.enabled'] = true;
  settings['workbench.editorAssociations'] = {
    ...existingAssociations,
    '*.txt': EDITOR_VIEW_TYPE,
    '*.md': EDITOR_VIEW_TYPE,
  };

  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');

  // .genkou.json が未作成なら初期生成する
  const manifestPath = path.join(workspaceRoot, GENKOU_PROJECT_FILE);
  if (!fs.existsSync(manifestPath)) {
    const files = scanManuscriptFiles(workspaceRoot);
    writeProjectManifest(workspaceRoot, {
      version: 1,
      title: path.basename(workspaceRoot),
      files,
      config: {
        writingMode: DEFAULT_GENKOU_CONFIG.writingMode,
        gridColor: DEFAULT_GENKOU_CONFIG.gridColor,
        charsPerLine: DEFAULT_GENKOU_CONFIG.charsPerLine,
        linesPerPage: DEFAULT_GENKOU_CONFIG.linesPerPage,
      },
    });
  }
}

/**
 * 対象フォルダーの原稿執筆プロジェクト設定を解除する
 */
export function disableGenkouInFolder(workspaceRoot: string): void {
  const settingsPath = path.join(workspaceRoot, '.vscode', 'settings.json');
  if (fs.existsSync(settingsPath)) {
    try {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as Record<
        string,
        unknown
      >;
      settings['genkouSheet.enabled'] = false;

      if (
        typeof settings['workbench.editorAssociations'] === 'object' &&
        settings['workbench.editorAssociations'] !== null
      ) {
        const assoc = {
          ...(settings['workbench.editorAssociations'] as Record<string, string>),
        };
        if (assoc['*.txt'] === EDITOR_VIEW_TYPE) {
          delete assoc['*.txt'];
        }
        if (assoc['*.md'] === EDITOR_VIEW_TYPE) {
          delete assoc['*.md'];
        }
        if (Object.keys(assoc).length === 0) {
          delete settings['workbench.editorAssociations'];
        } else {
          settings['workbench.editorAssociations'] = assoc;
        }
      }
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
    } catch {
      // ignore
    }
  }

  const manifestPath = path.join(workspaceRoot, GENKOU_PROJECT_FILE);
  if (fs.existsSync(manifestPath)) {
    fs.unlinkSync(manifestPath);
  }
}
