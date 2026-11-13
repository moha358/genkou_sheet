import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { BackupStore } from '../../src/services/backupService';

const URI = 'file:///novel/chapter1.txt';
const MIN = 60_000;

describe('BackupStore (原稿の自動バックアップ)', () => {
  let dir: string;
  let store: BackupStore;
  const opts = { maxSnapshots: 3, snapshotIntervalMs: 5 * MIN };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'genkou-backup-'));
    store = new BackupStore(dir);
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('間隔内の編集は最新世代を上書きし、間隔を過ぎると新しい世代を作る', () => {
    const t0 = 1_700_000_000_000;
    assert.equal(store.write(URI, 'chapter1.txt', 'あ', { ...opts, now: t0 }), true);
    store.write(URI, 'chapter1.txt', 'あい', { ...opts, now: t0 + MIN });
    let snaps = store.listSnapshots(URI);
    assert.equal(snaps.length, 1);
    assert.equal(store.readSnapshot(snaps[0]), 'あい');

    store.write(URI, 'chapter1.txt', 'あいう', { ...opts, now: t0 + 6 * MIN });
    snaps = store.listSnapshots(URI);
    assert.equal(snaps.length, 2);
    assert.equal(store.readSnapshot(snaps[0]), 'あいう');
    assert.equal(store.readSnapshot(snaps[1]), 'あい');
  });

  it('同一内容は書き込まず、上限を超えた古い世代を削除する', () => {
    const t0 = 1_700_000_000_000;
    for (let i = 0; i < 5; i++) store.write(URI, 'c.txt', `本文${i}`, { ...opts, now: t0 + i * 10 * MIN });
    assert.equal(store.write(URI, 'c.txt', '本文4', { ...opts, now: t0 + 60 * MIN }), false);
    const snaps = store.listSnapshots(URI);
    assert.deepEqual(snaps.map((s) => store.readSnapshot(s)), ['本文4', '本文3', '本文2']);
  });

  it('forceNewSnapshot は間隔内でも新しい世代を作り、一覧に元ファイルを返す', () => {
    const t0 = 1_700_000_000_000;
    store.write(URI, 'chapter1.txt', '復元前', { ...opts, now: t0 });
    store.write(URI, 'chapter1.txt', '復元後', { ...opts, now: t0, forceNewSnapshot: true });
    assert.equal(store.listSnapshots(URI).length, 2);
    const entries = store.listEntries();
    assert.equal(entries.length, 1);
    assert.equal(entries[0].sourceUri, URI);
    assert.equal(entries[0].displayName, 'chapter1.txt');
  });
});
