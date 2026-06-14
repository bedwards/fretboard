// Regression snapshot test (SPEC §10). Serializes the full build() database
// with stable key ordering plus fixed (seed=1,chaos=0) and (seed=1,chaos=1)
// progression samples, and asserts deep equality with the committed snapshot.
//
// Regenerate the snapshot deliberately with:  node scripts/snapshot.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSnapshot, SNAPSHOT_PATH } from '../scripts/snapshot.mjs';

test('build() + fixed progressions match the committed snapshot', () => {
  const current = buildSnapshot();
  const committed = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'));
  assert.deepEqual(current, committed);
});

test('snapshot serialization is itself deterministic (re-run equals)', () => {
  const a = JSON.stringify(buildSnapshot());
  const b = JSON.stringify(buildSnapshot());
  assert.equal(a, b);
});
