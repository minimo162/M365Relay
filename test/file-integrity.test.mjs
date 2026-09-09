import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { copyFileExact } from '../src/file-integrity.mjs';

test('copyFileExact preserves CRLF, tabs, Unicode and a final newline byte-for-byte', async t => {
  const root = await mkdtemp(join(tmpdir(), 'relay-copy-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, 'special.txt'), destination = join(root, 'copy.txt');
  const bytes = Buffer.from('C:\\Test\\日本語\\a_b*[x].txt\r\n"quoted" & <tag>\r\n改行、\t絵文字😀、literal \\n\r\n', 'utf8');
  await writeFile(source, bytes);
  const result = await copyFileExact(source, destination);
  assert.equal(result.source_bytes, bytes.length);
  assert.equal(result.destination_bytes, bytes.length);
  assert.equal(result.byte_equal, true);
  assert.equal(result.readback_verified, true);
  assert.equal(result.source_unchanged, true);
  assert.deepEqual(await readFile(destination), bytes);
  assert.deepEqual(await readFile(source), bytes);
});

test('copyFileExact refuses to overwrite an existing destination', async t => {
  const root = await mkdtemp(join(tmpdir(), 'relay-copy-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, 'source.txt'), destination = join(root, 'copy.txt');
  await writeFile(source, 'source\r\n');
  await writeFile(destination, 'keep\r\n');
  await assert.rejects(copyFileExact(source, destination), { code: 'destination_exists' });
  assert.equal(await readFile(destination, 'utf8'), 'keep\r\n');
});

test('copyFileExact does not create a destination when the source is missing', async t => {
  const root = await mkdtemp(join(tmpdir(), 'relay-copy-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await assert.rejects(copyFileExact(join(root, 'missing.txt'), join(root, 'copy.txt')), { code: 'source_not_found' });
});

test('copyFileExact rejects a source that changes during the copy', async t => {
  const root = await mkdtemp(join(tmpdir(), 'relay-copy-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, 'source.txt'), destination = join(root, 'copy.txt');
  await writeFile(source, 'before\r\n');
  await assert.rejects(copyFileExact(source, destination, {
    copy: async (from, to, flags) => {
      await copyFile(from, to, flags);
      await writeFile(from, 'changed after copy\r\n');
    }
  }), { code: 'source_changed_during_copy' });
});
