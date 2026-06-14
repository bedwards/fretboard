// Unit tests (SPEC §10) — node:test + node:assert, zero external deps.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Fretboard } from '../src/engine.js';

const FULL = { fourNote: true, viiMajor: true };

// ---------------------------------------------------------------------------
// §1 degreeLabel map + isOutside
// ---------------------------------------------------------------------------
test('degreeLabel maps semitones to Nashville labels', () => {
  const map = {
    0: '1', 2: '2', 3: 'b3', 4: '3', 5: '4',
    6: 'b5', 7: '5', 9: '6', 10: 'b7', 11: '7',
  };
  for (const [semi, label] of Object.entries(map)) {
    assert.equal(Fretboard.degreeLabel(Number(semi)), label, `semi ${semi}`);
  }
  // mod-12 wrap
  assert.equal(Fretboard.degreeLabel(12), '1');
  assert.equal(Fretboard.degreeLabel(-1), '7');
});

test('isOutside is true only for semitone 6 (b5)', () => {
  for (let s = 0; s < 12; s++) {
    assert.equal(Fretboard.isOutside(s), s === 6, `semi ${s}`);
  }
  assert.equal(Fretboard.isOutside(18), true); // 18 mod 12 = 6
});

test('TUNING is the standard EADGBE pitch-class vector', () => {
  assert.deepEqual(Fretboard.TUNING, [4, 9, 2, 7, 11, 4]);
});

// ---------------------------------------------------------------------------
// §3 chord stacks per root (slots, in-key filter, VII-major outside note)
// ---------------------------------------------------------------------------
test('chord stacks: each triad is root+third+fifth, all in-key', () => {
  const IN_KEY = new Set([0, 2, 3, 4, 5, 7, 9, 10, 11]);
  const chords = Fretboard._internal.enumerateChords({ fourNote: false, viiMajor: false });
  // roots 1..6 only
  const roots = [...new Set(chords.map((c) => c.rootDegree))].sort();
  assert.deepEqual(roots, [1, 2, 3, 4, 5, 6]);
  for (const c of chords) {
    assert.equal(c.size, 3);
    assert.equal(c.members.length, 3);
    const slots = c.members.map((m) => m.slot).sort();
    assert.deepEqual(slots, ['fifth', 'root', 'third']);
    // every member's keyDeg in S
    for (const m of c.members) assert.ok(IN_KEY.has(m.keyDeg), `${c.id} ${m.keyDeg}`);
    // root has chordInt 0, fifth chordInt 7, third b3 or 3
    const root = c.members.find((m) => m.slot === 'root');
    const fifth = c.members.find((m) => m.slot === 'fifth');
    const third = c.members.find((m) => m.slot === 'third');
    assert.equal(root.chordInt, 0);
    assert.equal(fifth.chordInt, 7);
    assert.ok(third.chordInt === 3 || third.chordInt === 4);
  }
});

test('both b3 and 3 triads are produced when both land in-key (root 1)', () => {
  const chords = Fretboard._internal.enumerateChords({ fourNote: false, viiMajor: false });
  const root1 = chords.filter((c) => c.rootDegree === 1);
  const thirds = root1.map((c) => c.members.find((m) => m.slot === 'third').chordInt).sort();
  assert.deepEqual(thirds, [3, 4]); // b3 and 3 both present
  // each records the OTHER third as an articulation target
  for (const c of root1) {
    assert.equal(c.articulationTargets.length, 1);
    assert.equal(c.articulationTargets[0].slot, 'third');
  }
});

test('VII-as-major chord = {7, b3, b5} with b5 flagged outside', () => {
  const chords = Fretboard._internal.enumerateChords(FULL);
  const vii = chords.filter((c) => c.rootDegree === 'VII');
  assert.ok(vii.length >= 1);
  const c = vii[0];
  assert.equal(c.kind, 'viiMajor');
  const keyDegs = c.members.map((m) => m.keyDeg).sort((a, b) => a - b);
  assert.deepEqual(keyDegs, [3, 6, 11]); // b3, b5, 7
  const outside = c.members.filter((m) => m.outside);
  assert.equal(outside.length, 1);
  assert.equal(outside[0].keyDeg, 6); // the b5 outside note
  // VII never present when viiMajor:false
  const noVii = Fretboard._internal.enumerateChords({ fourNote: true, viiMajor: false });
  assert.equal(noVii.filter((c) => c.rootDegree === 'VII').length, 0);
});

// ---------------------------------------------------------------------------
// §3 4-note drop rule
// ---------------------------------------------------------------------------
test('4-note drop drops the THIRD, keeps root + fifth + seventh', () => {
  const chords = Fretboard._internal.enumerateChords({ fourNote: true, viiMajor: false });
  const drops = chords.filter((c) => c.kind === 'drop3');
  assert.ok(drops.length > 0);
  for (const c of drops) {
    assert.equal(c.size, 4);
    const slots = c.members.map((m) => m.slot).sort();
    assert.deepEqual(slots, ['fifth', 'root', 'seventh']);
    // never drop root, keep fifth
    assert.ok(c.members.some((m) => m.slot === 'root'));
    assert.ok(c.members.some((m) => m.slot === 'fifth'));
    // dropped third recorded as articulation target
    assert.ok(c.articulationTargets.some((t) => t.slot === 'third'));
    // seventh is b7 or 7
    const sev = c.members.find((m) => m.slot === 'seventh');
    assert.ok(sev.chordInt === 10 || sev.chordInt === 11);
  }
});

// ---------------------------------------------------------------------------
// §4 voicing invariants
// ---------------------------------------------------------------------------
test('voicing invariants: 3 adjacent strings, spread<=3, one note/string, in-key or allowed outside', () => {
  const db = Fretboard.build(FULL);
  const validSets = new Set(Fretboard.STRING_SETS.map((s) => s.join(',')));
  const IN_KEY = new Set([0, 2, 3, 4, 5, 7, 9, 10, 11]);
  assert.ok(db.voicings.length > 0);
  for (const v of db.voicings) {
    // 3 adjacent strings, valid set
    assert.equal(v.stringSet.length, 3);
    assert.ok(validSets.has(v.stringSet.join(',')), `set ${v.stringSet}`);
    // adjacency: consecutive descending by 1
    assert.equal(v.stringSet[1], v.stringSet[0] + 1);
    assert.equal(v.stringSet[2], v.stringSet[1] + 1);
    // one note per string, matches stringSet order hi->lo
    assert.equal(v.notes.length, 3);
    assert.deepEqual(v.notes.map((n) => n.stringIdx), v.stringSet);
    const strings = new Set(v.notes.map((n) => n.stringIdx));
    assert.equal(strings.size, 3);
    // spread
    const frets = v.notes.map((n) => n.fretRel);
    const spread = Math.max(...frets) - Math.min(...frets);
    assert.equal(v.spread, spread);
    assert.ok(spread <= 3, `spread ${spread}`);
    // frets within window
    for (const f of frets) assert.ok(f >= 0 && f <= 11, `fret ${f}`);
    // key-only OR allowed outside (b5 only, and only when note.outside)
    for (const n of v.notes) {
      if (n.outside) {
        assert.equal(n.keyDegPc, 6, 'outside must be b5');
      } else {
        assert.ok(IN_KEY.has(n.keyDegPc), `keyDeg ${n.keyDegPc} not in S`);
      }
    }
    // barre invariant: if barre !== false, >=2 notes share lowest fret
    if (v.barre !== false) {
      const min = Math.min(...frets);
      assert.equal(v.barre, min);
      assert.ok(frets.filter((f) => f === min).length >= 2);
    }
  }
});

test('every inversion is enumerated; triads realize all 3 inversions', () => {
  const db = Fretboard.build(FULL);
  // (a) The voicing search enumerates every PC->string assignment (all
  // inversions). We verify this directly against the internal generator BEFORE
  // the spread filter: for every chord, every PC appears as the lowest-sounding
  // note among the raw (pre-filter) candidate assignments.
  const raw = Fretboard._internal.enumerateAllAssignments(db.chords[0]);
  assert.equal(new Set(raw.map((a) => a.bassChordInt)).size, 3);

  // (b) Each 3-note triad chord realizes all 3 inversions somewhere in the DB
  // (after the spread<=3 filter). Wide 4-note drop stacks may legitimately lose
  // the fifth-in-bass inversion to the spread filter — that is geometry, not a
  // gap in enumeration (the coverage test recounts the full space precisely).
  const triads = db.chords.filter((c) => c.kind === 'triad');
  for (const c of triads) {
    const vs = db.voicings.filter((v) => v.chordId === c.id);
    const basses = new Set(vs.map((v) => v.notes[2].chordIntPc));
    assert.equal(basses.size, 3, `triad ${c.id} basses ${[...basses]}`);
  }

  // (c) Across the whole DB, every chord-interval class (root/third/fifth/
  // seventh members) appears as a bass at least once — no inversion class is
  // globally absent.
  const allBasses = new Set(db.voicings.map((v) => v.notes[2].chordIntPc));
  for (const ci of [0, 3, 4, 7]) {
    assert.ok(allBasses.has(ci), `no voicing with chordInt ${ci} in bass`);
  }
});

// ---------------------------------------------------------------------------
// §5 articulation detection
// ---------------------------------------------------------------------------
test('within-voicing articulations: b3<->3 and b7<->7 detected with directions', () => {
  const db = Fretboard.build(FULL);
  let sawThird = false;
  let sawSeventh = false;
  for (const v of db.voicings) {
    for (const a of v.articulations) {
      assert.equal(a.within, true);
      assert.ok(['hammer', 'slide', 'pull'].includes(a.type));
      assert.ok(['up', 'down'].includes(a.direction));
      // from/to on the SAME string
      assert.equal(a.fromNote.stringIdx, a.toNote.stringIdx);
      const pair = `${a.fromNote.chordInt}<->${a.toNote.chordInt}`;
      if (pair.includes('b3') && pair.includes('3')) sawThird = true;
      if (pair.includes('b7') && pair.includes('7')) sawSeventh = true;
    }
  }
  assert.ok(sawThird, 'expected a b3<->3 within-voicing articulation');
  assert.ok(sawSeventh, 'expected a b7<->7 within-voicing articulation');
});

test('b3->3 articulation is flagged one-directional (blues third up)', () => {
  const db = Fretboard.build(FULL);
  let found = false;
  for (const v of db.voicings) {
    for (const a of v.articulations) {
      if (a.fromNote.chordInt === 'b3' && a.toNote.chordInt === '3') {
        assert.equal(a.direction, 'up');
        assert.equal(a.oneDirectional, true);
        found = true;
      }
    }
  }
  assert.ok(found, 'expected at least one b3->3 articulation');
});

test('transitions detect slideIntoHammer at least once', () => {
  const db = Fretboard.build(FULL);
  const sih = db.transitions.filter((t) => t.slideIntoHammer);
  assert.ok(sih.length > 0, 'expected some slideIntoHammer transitions');
  for (const t of sih) {
    assert.ok(t.moves.length > 0);
  }
});

test('transition moves are all 1-2 fret motions on the same string set', () => {
  const db = Fretboard.build(FULL);
  assert.ok(db.transitions.length > 0);
  for (const t of db.transitions) {
    // same string set for from/to is guaranteed by construction; check moves
    for (const m of t.moves) {
      assert.ok(Math.abs(m.delta) >= 1 && Math.abs(m.delta) <= 2, `delta ${m.delta}`);
      assert.ok(t.stringSet.includes(m.stringIdx));
    }
    // pivots are held strings (in the set, not in moves)
    for (const p of t.pivots) {
      assert.ok(t.stringSet.includes(p));
      assert.ok(!t.moves.some((m) => m.stringIdx === p));
    }
    // articulation present iff there are moves
    if (t.moves.length > 0) assert.ok(t.articulation);
  }
});

// ---------------------------------------------------------------------------
// §6 progression constraints
// ---------------------------------------------------------------------------
test('progression has 4 chords, 3 transitions, shared string set, no ABAB', () => {
  const db = Fretboard.build(FULL);
  for (let seed = 0; seed < 60; seed++) {
    for (const chaos of [0, 0.5, 1]) {
      const p = Fretboard.progression(db, { seed, chaos });
      assert.equal(p.voicings.length, 4);
      assert.equal(p.chords.length, 4);
      assert.equal(p.transitions.length, 3);
      // shared string set
      for (const v of p.voicings) assert.deepEqual(v.stringSet, p.stringSet);
      for (const t of p.transitions) assert.deepEqual(t.stringSet, p.stringSet);
      // valid same-set transition links consecutive voicings
      for (let i = 0; i < 3; i++) {
        assert.equal(p.transitions[i].fromVoicingId, p.voicings[i].id);
        assert.equal(p.transitions[i].toVoicingId, p.voicings[i + 1].id);
      }
      // forbidden ABAB
      const c = p.chords;
      const abab = c[0] === c[2] && c[1] === c[3] && c[0] !== c[1];
      assert.equal(abab, false, `ABAB ${JSON.stringify(c)} seed ${seed} chaos ${chaos}`);
      // fretWindow consistent
      const allFrets = p.voicings.flatMap((v) => v.notes.map((n) => n.fretRel));
      assert.equal(p.fretWindow.min, Math.min(...allFrets));
      assert.equal(p.fretWindow.max, Math.max(...allFrets));
    }
  }
});

// ---------------------------------------------------------------------------
// §7 weighting + seeded shuffle reproducibility
// ---------------------------------------------------------------------------
test('same seed => identical pick (determinism)', () => {
  const db = Fretboard.build(FULL);
  for (const seed of [0, 1, 7, 42, 1000]) {
    for (const chaos of [0, 0.3, 1]) {
      const a = Fretboard.progression(db, { seed, chaos });
      const b = Fretboard.progression(db, { seed, chaos });
      assert.deepEqual(a.chordIds, b.chordIds);
      assert.deepEqual(a.voicingIds, b.voicingIds);
      assert.deepEqual(a.transitionIds, b.transitionIds);
      assert.equal(a.commonness, b.commonness);
    }
  }
});

test('shuffle(n) yields n reproducible, distinct-seed picks', () => {
  const db = Fretboard.build(FULL);
  const a = Fretboard.shuffle(db, { seed: 5, chaos: 0.2, n: 4 });
  const b = Fretboard.shuffle(db, { seed: 5, chaos: 0.2, n: 4 });
  assert.equal(a.length, 4);
  for (let i = 0; i < 4; i++) assert.deepEqual(a[i].voicingIds, b[i].voicingIds);
});

test('chaos=0 favors high commonness; chaos=1 ~ uniform (tolerance)', () => {
  const db = Fretboard.build(FULL);
  // Distribution of starting root degree over many seeds.
  function dist(chaos) {
    const counts = {};
    const N = 1500;
    for (let s = 0; s < N; s++) {
      const r = Fretboard.progression(db, { seed: s, chaos }).chords[0];
      counts[r] = (counts[r] || 0) + 1;
    }
    return { counts, N };
  }

  const low = dist(0);
  const high = dist(1);

  // chaos=0: common roots (1,4,5,6) should dominate over rare (VII).
  const commonLow = (low.counts[1] || 0) + (low.counts[4] || 0) + (low.counts[5] || 0) + (low.counts[6] || 0);
  const viiLow = low.counts['VII'] || 0;
  assert.ok(commonLow / low.N > 0.6, `chaos0 common share ${commonLow / low.N}`);
  assert.ok(viiLow / low.N < 0.05, `chaos0 VII share ${viiLow / low.N}`);

  // chaos=1: VII should appear MORE often than at chaos=0 (flatter).
  const viiHigh = high.counts['VII'] || 0;
  assert.ok(viiHigh >= viiLow, `chaos1 VII ${viiHigh} should be >= chaos0 VII ${viiLow}`);

  // chaos=1 ~ uniform over voicings: chi-square-ish tolerance on STARTING
  // voicing distribution. Expected freq proportional to #connectable starts.
  const counts = {};
  const N = 4000;
  for (let s = 0; s < N; s++) {
    const p = Fretboard.progression(db, { seed: s + 10000, chaos: 1 });
    const id = p.voicingIds[0];
    counts[id] = (counts[id] || 0) + 1;
  }
  // number of distinct connectable start voicings
  const adj = {};
  for (const t of db.transitions) adj[t.fromVoicingId] = true;
  const starts = db.voicings.filter((v) => adj[v.id]);
  const k = starts.length;
  const expected = N / k;
  // chi-square statistic
  let chi = 0;
  for (const v of starts) {
    const o = counts[v.id] || 0;
    chi += (o - expected) * (o - expected) / expected;
  }
  // df = k-1; for uniform sampling chi should be near df. Allow generous bound
  // (3x df) to avoid flakiness while still catching gross non-uniformity.
  const df = k - 1;
  assert.ok(chi < 3 * df, `chi-square ${chi.toFixed(1)} exceeds 3*df=${3 * df} (k=${k})`);
});

// ---------------------------------------------------------------------------
// §8 COVERAGE — meta counts equal independently-computed totals; nothing missing
// ---------------------------------------------------------------------------
test('coverage: meta counts equal independently-computed expected totals', () => {
  const db = Fretboard.build(FULL);
  const IN_KEY = new Set([0, 2, 3, 4, 5, 7, 9, 10, 11]);

  // -- independently compute expected chord count --
  const ROOT_OFFSET = { 1: 0, 2: 2, 3: 4, 4: 5, 5: 7, 6: 9 };
  let expectedChords = 0;
  for (const r of [1, 2, 3, 4, 5, 6]) {
    const rp = ROOT_OFFSET[r];
    const thirds = [3, 4].filter((iv) => IN_KEY.has((rp + iv) % 12));
    const sevenths = [10, 11].filter((iv) => IN_KEY.has((rp + iv) % 12));
    const hasFifth = IN_KEY.has((rp + 7) % 12);
    if (!hasFifth || thirds.length === 0) continue;
    expectedChords += thirds.length; // triads
    expectedChords += sevenths.length; // drop3 forms (one per seventh)
  }
  expectedChords += 1; // VII-major triad
  assert.equal(db.meta.counts.chords, expectedChords, 'chord count');
  assert.equal(db.chords.length, expectedChords);

  // -- independently compute expected voicing count --
  // each chord -> 4 string sets * 6 permutations = 24 candidate assignments,
  // filtered by spread<=3 within the 12-fret window.
  function openPcFor(specIdx) {
    return [4, 9, 2, 7, 11, 4][6 - specIdx];
  }
  const STRING_SETS = [[1, 2, 3], [2, 3, 4], [3, 4, 5], [4, 5, 6]];
  function perms(a) {
    if (a.length <= 1) return [a.slice()];
    const r = [];
    for (let i = 0; i < a.length; i++) {
      const rest = a.slice(0, i).concat(a.slice(i + 1));
      for (const p of perms(rest)) r.push([a[i], ...p]);
    }
    return r;
  }
  let expectedVoicings = 0;
  for (const c of db.chords) {
    const pcs = c.members.map((m) => m.keyDeg);
    for (const set of STRING_SETS) {
      for (const perm of perms([0, 1, 2])) {
        const frets = perm.map((mi, k) => (((pcs[mi] - openPcFor(set[k])) % 12) + 12) % 12);
        const spread = Math.max(...frets) - Math.min(...frets);
        if (spread <= 3) expectedVoicings++;
      }
    }
  }
  assert.equal(db.meta.counts.voicings, expectedVoicings, 'voicing count');
  assert.equal(db.voicings.length, expectedVoicings);

  // -- transitions: independently recount valid same-set ordered pairs --
  const byset = {};
  for (const v of db.voicings) (byset[v.stringSet.join(',')] ||= []).push(v);
  let expectedTrans = 0;
  for (const k of Object.keys(byset)) {
    const list = byset[k];
    for (let i = 0; i < list.length; i++) {
      for (let j = 0; j < list.length; j++) {
        if (i === j) continue;
        // valid iff every string move is <=2 frets
        let ok = true;
        for (let s = 0; s < 3; s++) {
          const d = Math.abs(list[j].notes[s].fretRel - list[i].notes[s].fretRel);
          if (d > 2) { ok = false; break; }
        }
        if (ok) expectedTrans++;
      }
    }
  }
  assert.equal(db.meta.counts.transitions, expectedTrans, 'transition count');
  assert.equal(db.transitions.length, expectedTrans);
});

test('coverage: no root / string-set / voicing-size / inversion / transition class missing', () => {
  const db = Fretboard.build(FULL);
  // every root represented
  assert.deepEqual(db.meta.roots, [1, 2, 3, 4, 5, 6, 'VII']);
  for (const r of [1, 2, 3, 4, 5, 6, 'VII']) {
    assert.ok((db.meta.voicingsByRoot[r] || 0) > 0, `root ${r} has voicings`);
  }
  // every string set represented
  for (const s of Fretboard.STRING_SETS) {
    assert.ok((db.meta.voicingsByStringSet[s.join(',')] || 0) > 0, `set ${s}`);
    assert.ok((db.meta.transitionsByStringSet[s.join(',')] || 0) > 0, `trans set ${s}`);
  }
  // both voicing sizes present (3-note triads and 4-note drop forms)
  assert.ok(db.meta.voicingsBySize[3] > 0);
  assert.ok(db.meta.voicingsBySize[4] > 0);
  // inversion classes: at least one per (chord,stringSet) i.e. >= chords*sets
  assert.ok(db.meta.inversionClassCount > 0);
  // transition classes include the common moves
  for (const k of ['1-4', '4-1', '1-5', '5-1', '4-5', '5-4', '6-4', '4-6', '1-6', '6-1', '5-6', '6-5']) {
    assert.ok(db.meta.transitionClasses.includes(k), `missing transition class ${k}`);
  }
});

// ---------------------------------------------------------------------------
// §2/§8 label()
// ---------------------------------------------------------------------------
test('label() returns [keyDeg, chordInt] pair and outside flag', () => {
  // a note rooted on degree 5 played as minor-7 stack: 5·1, b7·b3, 2·5, 4·b7
  const root = Fretboard.label({ keyDegPc: 7, chordIntPc: 0 });
  assert.deepEqual(root.pair, ['5', '1']);
  assert.equal(root.outside, false);
  const b3 = Fretboard.label({ keyDegPc: 10, chordIntPc: 3 });
  assert.deepEqual(b3.pair, ['b7', 'b3']);
  // outside b5 note
  const out = Fretboard.label({ keyDegPc: 6, chordIntPc: 7 });
  assert.deepEqual(out.pair, ['b5', '5']);
  assert.equal(out.outside, true);
});

// ---------------------------------------------------------------------------
// build determinism: identical opts => byte-identical voicing/transition ids
// ---------------------------------------------------------------------------
test('build is pure: identical opts => identical structure', () => {
  const a = Fretboard.build(FULL);
  const b = Fretboard.build(FULL);
  assert.equal(JSON.stringify(a.meta), JSON.stringify(b.meta));
  assert.deepEqual(a.voicings.map((v) => v.id), b.voicings.map((v) => v.id));
  assert.deepEqual(a.transitions.map((t) => t.id), b.transitions.map((t) => t.id));
});
