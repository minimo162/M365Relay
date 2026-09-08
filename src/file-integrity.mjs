import { constants, createReadStream } from 'node:fs';
import { copyFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { assert, BridgeError } from './errors.mjs';

async function fingerprint(path) {
  const hash = createHash('sha256');
  let bytes = 0;
  try {
    for await (const chunk of createReadStream(path)) {
      bytes += chunk.length;
      hash.update(chunk);
    }
  } catch (error) {
    throw new BridgeError('file_read_failed', 'ファイルを読み取れません。コピー結果を判定せず停止しました。', 400,
      { path, reason: error?.code ?? 'read_failed' });
  }
  return { bytes, sha256: hash.digest('hex') };
}

/**
 * Copy a file without decoding/re-encoding it, then read both files back and
 * compare byte count and SHA-256. The destination must be new; an existing
 * file is never overwritten as part of a verification retry.
 */
export async function copyFileExact(sourceInput, destinationInput, {copy=copyFile,statFile=stat,readFingerprint=fingerprint}={}) {
  assert(typeof sourceInput === 'string' && sourceInput.length > 0 &&
    typeof destinationInput === 'string' && destinationInput.length > 0,
    'file_path_required', 'コピー元とコピー先のパスが必要です。', 400);
  const source = resolve(sourceInput), destination = resolve(destinationInput);
  assert(source !== destination, 'file_path_same', 'コピー元とコピー先が同じです。', 400);
  let sourceStat;
  try { sourceStat = await statFile(source); }
  catch (error) { throw new BridgeError('source_not_found', 'コピー元を確認できません。', 400, { reason: error?.code ?? 'stat_failed' }); }
  assert(sourceStat.isFile(), 'source_not_file', 'コピー元が通常のファイルではありません。', 400);

  // Capture the source before copying as well as after it. This does not lock
  // a file against an external writer, but it detects the common case where
  // the source changes while the copy is in progress instead of reporting a
  // mixed snapshot as a successful exact copy.
  const sourceBefore = await readFingerprint(source);

  try {
    await copy(source, destination, constants.COPYFILE_EXCL);
  } catch (error) {
    if (error?.code === 'EEXIST') {
      throw new BridgeError('destination_exists', 'コピー先が既に存在するため上書きしません。', 409);
    }
    throw new BridgeError('copy_failed', 'ファイルを決定論的にコピーできません。元ファイルは変更していません。', 400,
      { reason: error?.code ?? 'copy_failed' });
  }

  const sourceFingerprint = await readFingerprint(source);
  const destinationFingerprint = await readFingerprint(destination);
  const sourceStable = sourceBefore.bytes === sourceFingerprint.bytes &&
    sourceBefore.sha256 === sourceFingerprint.sha256;
  assert(sourceStable, 'source_changed_during_copy', 'コピー中に元ファイルが変更されたため、結果を採用せず停止しました。', 409,
    { before: sourceBefore, after: sourceFingerprint });
  const byteEqual = sourceFingerprint.bytes === destinationFingerprint.bytes &&
    sourceFingerprint.sha256 === destinationFingerprint.sha256;
  assert(byteEqual, 'copy_integrity_failed', 'コピー後のバイト数またはSHA-256が一致しません。手作業で修復せず停止しました。', 502,
    { source_bytes: sourceFingerprint.bytes, destination_bytes: destinationFingerprint.bytes,
      source_sha256: sourceFingerprint.sha256, destination_sha256: destinationFingerprint.sha256 });
  return {
    protocol: 'm365-relay.file-integrity.v1',
    action: 'copy_verified',
    source, destination,
    source_before_bytes: sourceBefore.bytes, source_before_sha256: sourceBefore.sha256,
    source_bytes: sourceFingerprint.bytes, destination_bytes: destinationFingerprint.bytes,
    source_sha256: sourceFingerprint.sha256, destination_sha256: destinationFingerprint.sha256,
    source_unchanged: true, byte_equal: true, readback_verified: true
  };
}
