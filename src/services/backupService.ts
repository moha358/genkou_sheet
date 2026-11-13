/**
 * Manuscript Auto Backup Service (原稿の自動バックアップ・スナップショット管理)
 * マシンの再起動・クラッシュ・未保存のまま閉じた場合に備え、編集中の原稿を拡張機能専用の保存領域へ
 * 定期的に書き出す。プロジェクトフォルダーには一切ファイルを作らない。
 *
 * 保存形式:
 *   <rootDir>/<key>/meta.json             … 元ファイルの URI と表示名
 *   <rootDir>/<key>/<作成時刻ms>.txt        … スナップショット本文（最新のものは更新され続ける）
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export interface BackupOptions {
  /** 1ファイルあたり保持するスナップショット数 */
  maxSnapshots: number;
  /** 最新スナップショットを作成してからこの時間が経つまでは、新規作成せず最新を上書きする */
  snapshotIntervalMs: number;
  /** true の場合は間隔に関係なく新しいスナップショットを作る（復元直前の退避など） */
  forceNewSnapshot?: boolean;
  now?: number;
}

export interface BackupSnapshot {
  key: string;
  filePath: string;
  /** スナップショットの作成時刻 */
  createdAt: number;
  /** 最後に内容を書き込んだ時刻 */
  updatedAt: number;
}

export interface BackupEntry {
  key: string;
  sourceUri: string;
  displayName: string;
  updatedAt: number;
}

interface BackupMeta {
  sourceUri: string;
  displayName: string;
  updatedAt: number;
}

const SNAPSHOT_RE = /^(\d{13})\.txt$/;

function writeFileAtomic(filePath: string, content: string): void {
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, content, 'utf-8');
  fs.renameSync(tmp, filePath);
}

export class BackupStore {
  constructor(private readonly rootDir: string) {}

  public static keyFor(sourceUri: string): string {
    return crypto.createHash('sha256').update(sourceUri).digest('hex').slice(0, 32);
  }

  private dirFor(key: string): string {
    return path.join(this.rootDir, key);
  }

  /**
   * 原稿の内容をバックアップする。直前のスナップショットと同一内容なら何もしない。
   * @returns 書き込みを行った場合 true
   */
  public write(sourceUri: string, displayName: string, text: string, options: BackupOptions): boolean {
    const now = options.now ?? Date.now();
    const key = BackupStore.keyFor(sourceUri);
    const dir = this.dirFor(key);
    fs.mkdirSync(dir, { recursive: true });

    const snapshots = this.listSnapshotsByKey(key);
    const latest = snapshots[0];
    if (latest && this.readSnapshot(latest) === text) {
      return false;
    }

    const reuseLatest =
      latest !== undefined &&
      !options.forceNewSnapshot &&
      now - latest.createdAt < options.snapshotIntervalMs;
    let createdAt = reuseLatest ? latest.createdAt : now;
    if (!reuseLatest && latest && createdAt <= latest.createdAt) createdAt = latest.createdAt + 1;
    writeFileAtomic(path.join(dir, `${String(createdAt).padStart(13, '0')}.txt`), text);

    const meta: BackupMeta = { sourceUri, displayName, updatedAt: now };
    writeFileAtomic(path.join(dir, 'meta.json'), JSON.stringify(meta));

    const keep = Math.max(1, Math.floor(options.maxSnapshots));
    for (const old of this.listSnapshotsByKey(key).slice(keep)) {
      fs.rmSync(old.filePath, { force: true });
    }
    return true;
  }

  /** 指定ファイルのスナップショットを新しい順に返す */
  public listSnapshots(sourceUri: string): BackupSnapshot[] {
    return this.listSnapshotsByKey(BackupStore.keyFor(sourceUri));
  }

  public listSnapshotsByKey(key: string): BackupSnapshot[] {
    const dir = this.dirFor(key);
    if (!fs.existsSync(dir)) return [];
    const result: BackupSnapshot[] = [];
    for (const name of fs.readdirSync(dir)) {
      const m = SNAPSHOT_RE.exec(name);
      if (!m) continue;
      const filePath = path.join(dir, name);
      try {
        result.push({ key, filePath, createdAt: Number(m[1]), updatedAt: fs.statSync(filePath).mtimeMs });
      } catch {
        // 削除と競合した場合は無視
      }
    }
    return result.sort((a, b) => b.createdAt - a.createdAt);
  }

  /** バックアップが存在する全ファイルを、最終更新の新しい順に返す */
  public listEntries(): BackupEntry[] {
    if (!fs.existsSync(this.rootDir)) return [];
    const entries: BackupEntry[] = [];
    for (const key of fs.readdirSync(this.rootDir)) {
      try {
        const meta = JSON.parse(fs.readFileSync(path.join(this.dirFor(key), 'meta.json'), 'utf-8')) as BackupMeta;
        if (typeof meta.sourceUri !== 'string') continue;
        entries.push({ key, sourceUri: meta.sourceUri, displayName: String(meta.displayName ?? meta.sourceUri), updatedAt: Number(meta.updatedAt) || 0 });
      } catch {
        // meta.json が無い・壊れているディレクトリは無視
      }
    }
    return entries.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  public readSnapshot(snapshot: BackupSnapshot): string {
    return fs.readFileSync(snapshot.filePath, 'utf-8');
  }
}
