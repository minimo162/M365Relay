import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Ledger } from '../src/state.mjs';

test('ledger archives closed records before accepting the 10000th-plus request and keeps duplicate fingerprints', async t => {
  const home = await mkdtemp(join(tmpdir(), 'relay-ledger-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const ledger = new Ledger(home, 'key', { maxRecords: 3, rotateTo: 1 });
  ledger.records = {
    old_a: { id: 'a', status: 'response_validated', at: '2026-01-01T00:00:00.000Z' },
    old_b: { id: 'b', status: 'unknown_or_invalid', at: '2026-01-02T00:00:00.000Z' },
    active: { id: 'c', status: 'sending', at: '2026-01-03T00:00:00.000Z' }
  };
  await ledger.flush();
  ledger.fingerprint = () => 'new_hash';
  await ledger.reserve({ requestId: 'new', payload: { request_id: 'new' } });
  assert.equal(Object.keys(ledger.records).length, 2);
  const archive = await readFile(join(home, 'requests.archive.jsonl'), 'utf8');
  assert.match(archive, /old_a/);
  assert.match(archive, /old_b/);

  const fresh = new Ledger(home, 'key', { maxRecords: 3, rotateTo: 1 });
  await fresh.load();
  assert.equal(fresh.archived.get('old_a').id, 'a');
  fresh.fingerprint = () => 'old_a';
  await assert.rejects(fresh.reserve({ requestId: 'retry', payload: { request_id: 'retry' } }), { code: 'duplicate_request' });
});

test('ledger refuses a truncated archive instead of losing duplicate information', async t => {
  const home = await mkdtemp(join(tmpdir(), 'relay-ledger-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  await writeFile(join(home, 'requests.archive.jsonl'), '{"hash":"broken"}\n');
  await assert.rejects(new Ledger(home, 'key').load(), { code: 'invalid_ledger' });
});

test('default ten-thousand record ledger rotates, reloads, and blocks an archived duplicate', async t => {
  const home = await mkdtemp(join(tmpdir(), 'relay-ledger-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const ledger = new Ledger(home, 'key');
  const records = {};
  for (let i = 0; i < 10000; i++) {
    records[`hash-${String(i).padStart(5, '0')}`] = {
      id: `request-${i}`, status: 'response_validated', at: `2026-01-01T00:${String(i % 60).padStart(2, '0')}:00.000Z`
    };
  }
  ledger.records = records;
  await ledger.flush();
  ledger.fingerprint = () => 'new-after-ten-thousand';
  await ledger.reserve({ requestId: 'new-after-ten-thousand', payload: { request_id: 'new-after-ten-thousand' } });
  assert.equal(Object.keys(ledger.records).length, 9001);
  assert.equal(ledger.archived.size, 1000);

  const reloaded = new Ledger(home, 'key');
  await reloaded.load();
  assert.equal(Object.keys(reloaded.records).length, 9001);
  assert.equal(reloaded.archived.size, 1000);
  reloaded.fingerprint = () => 'hash-00000';
  await assert.rejects(reloaded.reserve({ requestId: 'same-semantic-request', payload: { request_id: 'same-semantic-request' } }), { code: 'duplicate_request' });
});
