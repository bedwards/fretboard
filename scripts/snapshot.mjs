// Snapshot builder + generator. Kept OUTSIDE test/ so Node's test discovery
// never executes it as a test.
//
// - `buildSnapshot()` produces the stable-ordered serializable object used by
//   the regression test and the generator (single source of truth).
// - Run directly to (re)write the committed snapshot:
//       node scripts/snapshot.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Fretboard } from '../src/engine.js';

// Recursively sort object keys for stable, byte-identical JSON; drop internal
// memoization fields (prefixed with '_').
export function stableSort(value) {
  if (Array.isArray(value)) return value.map(stableSort);
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value).sort()) {
      if (k.startsWith('_')) continue;
      out[k] = stableSort(value[k]);
    }
    return out;
  }
  return value;
}

export function buildSnapshot() {
  const db = Fretboard.build({ fourNote: true, viiMajor: true });
  const progLow = Fretboard.progression(db, { seed: 1, chaos: 0 });
  const progHigh = Fretboard.progression(db, { seed: 1, chaos: 1 });

  const dbSerializable = {
    options: db.options,
    chords: db.chords,
    voicings: db.voicings,
    transitions: db.transitions,
    meta: db.meta,
  };

  return stableSort({
    db: dbSerializable,
    progressions: {
      'seed1-chaos0': progLow,
      'seed1-chaos1': progHigh,
    },
  });
}

const __dirname = dirname(fileURLToPath(import.meta.url));
export const SNAPSHOT_PATH = join(__dirname, '..', 'test', '__snapshots__', 'db.json');

// Only write when executed directly (not when imported by the test).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  mkdirSync(dirname(SNAPSHOT_PATH), { recursive: true });
  writeFileSync(SNAPSHOT_PATH, JSON.stringify(buildSnapshot(), null, 2) + '\n');
  console.log('wrote', SNAPSHOT_PATH);
}
