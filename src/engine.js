// engine.js — Deterministic music-theory engine for the Fretboard app.
// ZERO dependencies. Works as a browser global (window.Fretboard) AND as an
// ES module (`import { Fretboard }` / `import Fretboard`).
//
// All math is key-relative, in pitch classes (mod 12). See SPEC.md §1-§8.

// ===========================================================================
// WEIGHTS — all tunable constants live here so they can be swapped later (§7).
// ===========================================================================
const WEIGHTS = {
  // Chord-function priors, keyed by root scale degree (1..6) and 'VII' for the
  // VII-as-major special chord. Folk/rock/blues/country: 1,4,5,6 high; 2,3
  // lower; VII-major low/characteristic. Values in (0,1].
  func: {
    1: 1.0,
    2: 0.45,
    3: 0.4,
    4: 0.9,
    5: 0.95,
    6: 0.8,
    VII: 0.15,
  },

  // Multiplier applied to voicings derived from a 4-note (drop-third) stack —
  // sevenths are rarer than plain triads in this genre frame.
  fourNotePenalty: 0.6,

  // Shape bonuses (multiplicative on a voicing's commonness), see §7.
  shape: {
    lowSpreadBonus: 0.25, // * (1 - spread/3): tighter => bigger bonus
    barreBonus: 0.18, //      index-barre available
    withinArticBonus: 0.15, // within-voicing b3<->3 or b7<->7 pair present
  },

  // Transition priors. Keyed "a-b" where a,b are root degrees (or 'VII').
  // direction is the idiomatic motion; oneDirectional flags one-way moves.
  transition: {
    '1-4': { w: 0.95, direction: 'up', oneDirectional: false },
    '4-1': { w: 0.95, direction: 'down', oneDirectional: false }, // plagal
    '1-5': { w: 0.95, direction: 'up', oneDirectional: false },
    '5-1': { w: 1.0, direction: 'down', oneDirectional: false }, // cadential
    '4-5': { w: 0.85, direction: 'up', oneDirectional: false },
    '5-4': { w: 0.8, direction: 'down', oneDirectional: false },
    '6-4': { w: 0.8, direction: 'down', oneDirectional: false },
    '4-6': { w: 0.7, direction: 'up', oneDirectional: false },
    '1-6': { w: 0.85, direction: 'down', oneDirectional: false },
    '6-1': { w: 0.85, direction: 'up', oneDirectional: false },
    '5-6': { w: 0.7, direction: 'up', oneDirectional: true }, // deceptive, one-way
    '6-5': { w: 0.75, direction: 'down', oneDirectional: false },
  },
  // Prior used for a transition between chords with no entry above (still legal,
  // just uncommon). Same-chord repeats use repeatPrior.
  defaultTransitionPrior: 0.25,
  repeatPrior: 0.35,

  // Articulation directionality table (§5/§7): idiomatic one-way motions, by
  // chordInt change on a string within a transition / within a voicing.
  // Keyed "from->to" using chordInt labels.
  articDirection: {
    'b3->3': { direction: 'up', oneDirectional: true }, // blues third, up
    '3->b3': { direction: 'down', oneDirectional: false },
    'b7->7': { direction: 'up', oneDirectional: false },
    '7->b7': { direction: 'down', oneDirectional: false },
    '7->1': { direction: 'up', oneDirectional: true }, // leading tone resolves up
    '4->3': { direction: 'down', oneDirectional: true }, // suspension resolves down
  },

  // Bonus applied to a transition that slides into a fret from which a
  // within-voicing hammer is available (the "prize" moment, §5).
  slideIntoHammerBonus: 0.3,

  // Bonus applied to a transition whose articulation is a 1-fret hammer/pull.
  smallMoveBonus: 0.12,
};

// ===========================================================================
// §1 — Note & degree system
// ===========================================================================

// Open-string pitch classes, low E -> high E (absolute PCs). §4.
const TUNING = [4, 9, 2, 7, 11, 4];

// Base in-key set S (§1). Outside note = 6 (b5), used only by VII-major.
const IN_KEY = new Set([0, 2, 3, 4, 5, 7, 9, 10, 11]);
const OUTSIDE_PC = 6;

// semitone -> Nashville label. 6 => 'b5'.
const DEGREE_LABELS = {
  0: '1',
  2: '2',
  3: 'b3',
  4: '3',
  5: '4',
  6: 'b5',
  7: '5',
  9: '6',
  10: 'b7',
  11: '7',
};

function mod12(n) {
  return ((n % 12) + 12) % 12;
}

function degreeLabel(semi) {
  const s = mod12(semi);
  const lbl = DEGREE_LABELS[s];
  return lbl === undefined ? String(s) : lbl;
}

function isOutside(semi) {
  return mod12(semi) === OUTSIDE_PC;
}

// ===========================================================================
// §7 chaos — seeded PRNG (mulberry32). Deterministic.
// ===========================================================================
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Weighted sample of an index given weights and a PRNG draw in [0,1).
function sampleIndex(weights, r) {
  let total = 0;
  for (let i = 0; i < weights.length; i++) total += weights[i];
  if (total <= 0) return Math.min(weights.length - 1, Math.floor(r * weights.length));
  let x = r * total;
  for (let i = 0; i < weights.length; i++) {
    x -= weights[i];
    if (x < 0) return i;
  }
  return weights.length - 1;
}

// ===========================================================================
// §3 — Chord model
// ===========================================================================

// Root scale degrees -> semitone offset.
const ROOT_OFFSET = { 1: 0, 2: 2, 3: 4, 4: 5, 5: 7, 6: 9 };
const ROOT_DEGREES = [1, 2, 3, 4, 5, 6];

// chordInt (interval above chord root, in semis) -> label.
function chordIntLabel(semi) {
  const m = {
    0: '1',
    3: 'b3',
    4: '3',
    7: '5',
    6: 'b5',
    10: 'b7',
    11: '7',
  };
  return m[mod12(semi)] || String(mod12(semi));
}

// Returns the keyDeg pitch class for a chord-root degree + interval above root.
function keyPcOf(rootDeg, interval) {
  if (rootDeg === 'VII') {
    // VII-major rooted at semitone 11.
    return mod12(11 + interval);
  }
  return mod12(ROOT_OFFSET[rootDeg] + interval);
}

// Build the set of chord pitch-class "members" for a given root degree.
// Each member: { interval (above root), keyDeg (pc in key), outside }.
// Returns slots for third/fifth/seventh; both members of a slot kept if in S.
function chordMembers(rootDeg, opts) {
  if (rootDeg === 'VII') {
    // Special VII-as-major triad {7, b3, b5} relative to key = {11, 3, 6}.
    // Intervals above root(=11): root 0, third b3=>+? root pc 11; b3 pc 3 =>
    // interval = (3-11) mod12 = 4 (a major third above the VII root). b5 pc 6 =>
    // interval (6-11)mod12 = 7 (a perfect fifth above the VII root).
    // So as a *chord*, VII-major is root + major-third + fifth.
    const root = { interval: 0, keyDeg: 11, outside: false, chordInt: 0 };
    const third = { interval: 4, keyDeg: 3, outside: false, chordInt: 4 };
    const fifth = { interval: 7, keyDeg: 6, outside: true, chordInt: 7 }; // b5 in key = outside
    return { root, thirds: [third], fifth, sevenths: [] };
  }

  const rootPc = ROOT_OFFSET[rootDeg];
  const root = { interval: 0, keyDeg: rootPc, outside: false, chordInt: 0 };

  // third slot: +3 (b3) and/or +4 (3), kept if keyDeg in S.
  const thirds = [];
  for (const iv of [3, 4]) {
    const kd = mod12(rootPc + iv);
    if (IN_KEY.has(kd)) thirds.push({ interval: iv, keyDeg: kd, outside: false, chordInt: iv });
  }

  // fifth slot: +7 (kept if in S).
  let fifth = null;
  {
    const kd = mod12(rootPc + 7);
    if (IN_KEY.has(kd)) fifth = { interval: 7, keyDeg: kd, outside: false, chordInt: 7 };
  }

  // seventh slot (4-note only): +10 (b7) and/or +11 (7), kept if in S.
  const sevenths = [];
  if (opts.fourNote) {
    for (const iv of [10, 11]) {
      const kd = mod12(rootPc + iv);
      if (IN_KEY.has(kd)) sevenths.push({ interval: iv, keyDeg: kd, outside: false, chordInt: iv });
    }
  }

  return { root, thirds, fifth, sevenths };
}

// Enumerate the chord "definitions" (each = the abstract chord identity + the
// 3 pitch-class members chosen for a particular voicing). One def per concrete
// 3-note PC selection (third choice, and for 4-note the seventh choice).
//
// Returns array of:
// { id, rootDegree, size:3|4, kind:'triad'|'drop3'|'viiMajor',
//   members:[{pc,keyDeg,chordInt,interval,isRoot,outside,slot}] (3 members),
//   articulationTargets:[{slot, chordInt, keyDeg}], commonnessBase }
function enumerateChords(opts) {
  const chords = [];

  const roots = [...ROOT_DEGREES];
  if (opts.viiMajor) roots.push('VII');

  for (const rootDeg of roots) {
    const m = chordMembers(rootDeg, opts);
    if (!m.fifth) continue; // need a fifth to form our 3-string triad model
    if (m.thirds.length === 0 && rootDeg !== 'VII') continue;

    const funcKey = rootDeg === 'VII' ? 'VII' : rootDeg;
    const funcW = WEIGHTS.func[funcKey];

    // --- 3-note triads: root + (each available third) + fifth ---
    for (let ti = 0; ti < m.thirds.length; ti++) {
      const third = m.thirds[ti];
      const otherThird = m.thirds.find((x) => x !== third) || null;
      const members = [
        { ...m.root, isRoot: true, slot: 'root' },
        { ...third, isRoot: false, slot: 'third' },
        { ...m.fifth, isRoot: false, slot: 'fifth' },
      ].map((x) => ({ pc: x.keyDeg, keyDeg: x.keyDeg, chordInt: x.chordInt, interval: x.interval, isRoot: x.isRoot, outside: x.outside, slot: x.slot }));

      const articulationTargets = [];
      if (otherThird) {
        articulationTargets.push({ slot: 'third', chordInt: otherThird.chordInt, keyDeg: otherThird.keyDeg, interval: otherThird.interval });
      }

      chords.push({
        id: `c:${rootDeg}:tri:${third.chordInt}`,
        rootDegree: rootDeg,
        size: 3,
        kind: rootDeg === 'VII' ? 'viiMajor' : 'triad',
        members,
        articulationTargets,
        commonnessBase: funcW,
      });
    }

    // --- 4-note drop-third forms: root + fifth + (each available seventh) ---
    // Drop rule: never drop root, prefer keep fifth, so drop the third =>
    // resulting voicing = root + fifth + seventh. The dropped third becomes an
    // articulation target. (§3)
    if (opts.fourNote && rootDeg !== 'VII') {
      for (let si = 0; si < m.sevenths.length; si++) {
        const seventh = m.sevenths[si];
        // which third would have been there (record one as artic target):
        // prefer the b3/3 that exists; if both, record both as targets.
        const members = [
          { ...m.root, isRoot: true, slot: 'root' },
          { ...m.fifth, isRoot: false, slot: 'fifth' },
          { ...seventh, isRoot: false, slot: 'seventh' },
        ].map((x) => ({ pc: x.keyDeg, keyDeg: x.keyDeg, chordInt: x.chordInt, interval: x.interval, isRoot: x.isRoot, outside: x.outside, slot: x.slot }));

        const articulationTargets = [];
        // dropped third(s) -> articulation targets (hammer the 3rd back in)
        for (const th of m.thirds) {
          articulationTargets.push({ slot: 'third', chordInt: th.chordInt, keyDeg: th.keyDeg, interval: th.interval });
        }
        // the other seventh (if both b7 and 7 available) is also a target
        const otherSeventh = m.sevenths.find((x) => x !== seventh);
        if (otherSeventh) {
          articulationTargets.push({ slot: 'seventh', chordInt: otherSeventh.chordInt, keyDeg: otherSeventh.keyDeg, interval: otherSeventh.interval });
        }

        chords.push({
          id: `c:${rootDeg}:drop3:${seventh.chordInt}`,
          rootDegree: rootDeg,
          size: 4,
          kind: 'drop3',
          members,
          articulationTargets,
          commonnessBase: funcW * WEIGHTS.fourNotePenalty,
        });
      }
    }
  }

  return chords;
}

// ===========================================================================
// §4 — Voicings on the neck
// ===========================================================================

// Adjacent three-string sets, named high->low (1=high E..6=low E).
// Internally we use ZERO-based "string indices" 0..5 where 0 = low E (tuning[0])
// up to 5 = high E (tuning[5]). The SPEC naming (1=high E..6=low E) is exposed
// as `stringIdx` = (6 - tuningIndex). We store stringSet as [hi,mid,lo] in SPEC
// naming where hi is the *highest sounding* (smallest SPEC index).
//
// SPEC string sets: {1,2,3} {2,3,4} {3,4,5} {4,5,6}.
const STRING_SETS = [
  [1, 2, 3],
  [2, 3, 4],
  [3, 4, 5],
  [4, 5, 6],
];

// Map SPEC string index (1=high E..6=low E) -> tuning array index (0=low E..5=high E).
function tuningIndex(specIdx) {
  return 6 - specIdx;
}

// Open pitch class for a SPEC string index.
function openPc(specIdx) {
  return TUNING[tuningIndex(specIdx)];
}

const FRET_WINDOW = 12; // one octave window (§6)
const MAX_SPREAD = 3; // spread = max-min <= 3 (span <= 4 frets) (§4)

// For a target pitch class on a given SPEC string, frets (relative, 0..11) that
// sound it within the 12-fret window.
function fretsForPc(specIdx, pc) {
  const open = openPc(specIdx);
  const f = mod12(pc - open);
  // within a 12-window each pc appears exactly once at fret f (0..11).
  return [f];
}

// Fingerability score (§5): higher = easier. Heuristic from spread + barre.
function computeFingerScore(spread, barre) {
  // spread 0 => easiest; spread 3 => hardest. barre helps reachability.
  let s = 1 - spread / (MAX_SPREAD + 1);
  if (barre !== false) s += 0.1;
  if (s > 1) s = 1;
  if (s < 0) s = 0;
  return Math.round(s * 1000) / 1000;
}

let _voicingCounter = 0;

// Build every voicing for a chord definition (every string set, every inversion
// = every PC->string assignment) within the window with spread <= 3.
function voicingsForChord(chord) {
  const out = [];
  const pcs = chord.members; // 3 members, each {pc,keyDeg,chordInt,...}

  for (const set of STRING_SETS) {
    // set is [hi, mid, lo] SPEC indices (hi = highest sounding string).
    // every assignment (permutation) of the 3 members to the 3 strings.
    const perms = permutations([0, 1, 2]);
    for (const perm of perms) {
      // perm[k] = index into members assigned to set[k]
      const noteFrets = [];
      let ok = true;
      for (let k = 0; k < 3; k++) {
        const member = pcs[perm[k]];
        const specIdx = set[k];
        const frets = fretsForPc(specIdx, member.pc);
        if (frets.length === 0) {
          ok = false;
          break;
        }
        noteFrets.push({ specIdx, fretRel: frets[0], member });
      }
      if (!ok) continue;

      const fretVals = noteFrets.map((n) => n.fretRel);
      const minFret = Math.min(...fretVals);
      const maxFret = Math.max(...fretVals);
      const spread = maxFret - minFret;
      if (spread > MAX_SPREAD) continue;

      // barre: >=2 notes share the lowest fret => index barre at that fret.
      const countAtMin = fretVals.filter((f) => f === minFret).length;
      const barre = countAtMin >= 2 ? minFret : false;

      const fingerScore = computeFingerScore(spread, barre);

      const notes = noteFrets.map((n) => ({
        stringIdx: n.specIdx,
        fretRel: n.fretRel,
        pc: n.member.pc,
        keyDeg: degreeLabel(n.member.keyDeg),
        keyDegPc: n.member.keyDeg,
        chordInt: chordIntLabel(n.member.chordInt),
        chordIntPc: n.member.chordInt,
        slot: n.member.slot,
        isRoot: !!n.member.isRoot,
        outside: !!n.member.outside,
      }));

      const id = `v${_voicingCounter++}`;
      const v = {
        id,
        chordId: chord.id,
        rootDegree: chord.rootDegree,
        size: chord.size,
        kind: chord.kind,
        stringSet: [...set], // [hi, mid, lo] SPEC indices
        notes, // length 3, ordered hi->lo to match stringSet
        spread,
        barre,
        fingerScore,
        // articulation opportunities within this voicing:
        articulations: withinVoicingArticulations(notes, chord),
        commonness: 0, // filled below
      };
      v.commonness = voicingCommonness(v, chord);
      out.push(v);
    }
  }
  return out;
}

// Enumerate ALL raw PC->string assignments (every string set x every inversion)
// for a chord, BEFORE the spread<=3 filter. Used to prove inversion coverage.
function enumerateAllAssignments(chord) {
  const out = [];
  const pcs = chord.members;
  for (const set of STRING_SETS) {
    for (const perm of permutations([0, 1, 2])) {
      const frets = [];
      for (let k = 0; k < 3; k++) {
        const member = pcs[perm[k]];
        frets.push({ specIdx: set[k], fretRel: fretsForPc(set[k], member.pc)[0], member });
      }
      const fretVals = frets.map((f) => f.fretRel);
      const spread = Math.max(...fretVals) - Math.min(...fretVals);
      // bass = lowest-sounding = the note on the largest SPEC string index (lo)
      const bass = frets[frets.length - 1].member;
      out.push({ stringSet: [...set], spread, bassChordInt: bass.chordInt });
    }
  }
  return out;
}

function permutations(arr) {
  if (arr.length <= 1) return [arr.slice()];
  const res = [];
  for (let i = 0; i < arr.length; i++) {
    const rest = arr.slice(0, i).concat(arr.slice(i + 1));
    for (const p of permutations(rest)) res.push([arr[i], ...p]);
  }
  return res;
}

// ===========================================================================
// §5 — Articulations: within a voicing
// ===========================================================================
// b3<->3 (1 fret) and b7<->7 (1 fret) on the SAME string within reach, plus
// 4->3 bend/suspension cases. We look at each note: if the chord offers the
// slot-partner (or a suspension target) reachable on the same string within the
// window, emit an articulation.
function withinVoicingArticulations(notes, chord) {
  const arts = [];
  for (const note of notes) {
    // candidate partners for this note's slot:
    const partners = [];
    if (note.slot === 'third') {
      // partner = the other third (b3<->3) if it exists as an artic target
      for (const t of chord.articulationTargets) {
        if (t.slot === 'third' && t.chordInt !== note.chordIntPc) {
          partners.push({ chordInt: t.chordInt, keyDeg: t.keyDeg });
        }
      }
    }
    if (note.slot === 'seventh') {
      for (const t of chord.articulationTargets) {
        if (t.slot === 'seventh' && t.chordInt !== note.chordIntPc) {
          partners.push({ chordInt: t.chordInt, keyDeg: t.keyDeg });
        }
      }
    }
    if (note.slot === 'fifth' && chord.size === 4) {
      // drop-third voicing: the dropped 3rd can be hammered in on the 5th's
      // string? No — different pc means different string position. Skip; the
      // dropped-third target is handled as a transition/target, not same-string.
    }

    for (const partner of partners) {
      // partner sounds on the same string at fret = note.fretRel + delta
      const deltaSemi = mod12(partner.chordInt - note.chordIntPc);
      // pick the signed minimal fret delta (within +/-2)
      let delta = deltaSemi;
      if (delta > 6) delta -= 12;
      if (Math.abs(delta) > 2) continue; // not reachable on same string
      const partnerFret = note.fretRel + delta;
      if (partnerFret < 0 || partnerFret > FRET_WINDOW - 1) continue;

      const fromLabel = chordIntLabel(note.chordIntPc);
      const toLabel = chordIntLabel(partner.chordInt);
      const dirKey = `${fromLabel}->${toLabel}`;
      const dirRule = WEIGHTS.articDirection[dirKey];
      const direction = dirRule ? dirRule.direction : delta > 0 ? 'up' : 'down';
      const oneDirectional = dirRule ? dirRule.oneDirectional : false;
      const type = Math.abs(delta) === 1 ? 'hammer' : 'slide';

      arts.push({
        type, // 'hammer' (1 fret) | 'slide' (2 frets)
        slot: note.slot,
        fromNote: { stringIdx: note.stringIdx, fretRel: note.fretRel, chordInt: fromLabel },
        toNote: { stringIdx: note.stringIdx, fretRel: partnerFret, chordInt: toLabel },
        direction,
        oneDirectional,
        within: true,
      });
    }
  }
  return arts;
}

// ===========================================================================
// §7 — Voicing commonness (function + shape).
// ===========================================================================
function voicingCommonness(v, chord) {
  let c = chord.commonnessBase; // already includes 4-note penalty & func

  // shape bonuses (multiplicative-ish, kept in [0,1])
  let bonus = 0;
  bonus += WEIGHTS.shape.lowSpreadBonus * (1 - v.spread / MAX_SPREAD);
  if (v.barre !== false) bonus += WEIGHTS.shape.barreBonus;
  if (v.articulations.length > 0) bonus += WEIGHTS.shape.withinArticBonus;

  c = c * (1 + bonus);
  // normalize to [0,1] via a soft cap
  if (c > 1) c = 1;
  if (c < 0) c = 0;
  return Math.round(c * 1e6) / 1e6;
}

// ===========================================================================
// §5 — Transitions: between two voicings on the SAME string set.
// ===========================================================================
let _transitionCounter = 0;

function buildTransition(from, to) {
  // must share the exact same string set
  if (from.stringSet.join(',') !== to.stringSet.join(',')) return null;
  if (from.id === to.id) return null;

  const moves = [];
  const pivots = [];
  // notes are ordered hi->lo matching stringSet for both.
  for (let k = 0; k < 3; k++) {
    const a = from.notes[k];
    const b = to.notes[k];
    const delta = b.fretRel - a.fretRel;
    if (delta === 0) {
      pivots.push(a.stringIdx);
    } else {
      moves.push({
        stringIdx: a.stringIdx,
        fromFret: a.fretRel,
        toFret: b.fretRel,
        delta,
        fromChordInt: a.chordInt,
        toChordInt: b.chordInt,
      });
    }
  }

  // Only treat as a usable transition if every moving string moves by 1-2 frets
  // (the articulation range, §5). If any string jumps >2 frets it's not a
  // smooth same-set transition.
  for (const mv of moves) {
    if (Math.abs(mv.delta) > 2) return null;
  }
  // need at least one moving string OR same chord identity wouldn't move;
  // allow zero moves only when chords differ but happen to share positions —
  // that's still a valid (trivial) transition. We keep it.

  // combined spread across both voicings (cluster tightness)
  const allFrets = from.notes.map((n) => n.fretRel).concat(to.notes.map((n) => n.fretRel));
  const spread = Math.max(...allFrets) - Math.min(...allFrets);

  // primary articulation = the (first) moving string's motion
  let articulation = null;
  let direction = null;
  let oneDirectional = false;
  if (moves.length > 0) {
    // choose the move with the smallest |delta| as the featured articulation
    const featured = moves.slice().sort((x, y) => Math.abs(x.delta) - Math.abs(y.delta))[0];
    const type = Math.abs(featured.delta) === 1 ? (featured.delta > 0 ? 'hammer' : 'pull') : 'slide';
    const dirKey = `${featured.fromChordInt}->${featured.toChordInt}`;
    const dirRule = WEIGHTS.articDirection[dirKey];
    direction = dirRule ? dirRule.direction : featured.delta > 0 ? 'up' : 'down';
    oneDirectional = dirRule ? dirRule.oneDirectional : false;
    articulation = { type, direction };
  }

  // slideIntoHammer: a moving string slides into a fret from which a
  // within-voicing hammer (b3->3/b7->7) is available in the destination voicing
  // on that same string.
  let slideIntoHammer = false;
  if (moves.length > 0 && to.articulations.length > 0) {
    for (const mv of moves) {
      if (Math.abs(mv.delta) >= 1) {
        for (const art of to.articulations) {
          if (art.fromNote.stringIdx === mv.stringIdx && art.within) {
            slideIntoHammer = true;
            break;
          }
        }
      }
      if (slideIntoHammer) break;
    }
  }

  const t = {
    id: `t${_transitionCounter++}`,
    fromVoicingId: from.id,
    toVoicingId: to.id,
    fromRoot: from.rootDegree,
    toRoot: to.rootDegree,
    stringSet: [...from.stringSet],
    moves,
    pivots,
    articulation,
    oneDirectional,
    direction,
    slideIntoHammer,
    spread,
    commonness: 0,
  };
  t.commonness = transitionCommonness(t, from, to);
  return t;
}

function transitionKey(a, b) {
  return `${a}-${b}`;
}

function transitionCommonness(t, from, to) {
  let base;
  if (from.rootDegree === to.rootDegree) {
    base = WEIGHTS.repeatPrior;
  } else {
    const key = transitionKey(from.rootDegree, to.rootDegree);
    const entry = WEIGHTS.transition[key];
    base = entry ? entry.w : WEIGHTS.defaultTransitionPrior;
  }

  let bonus = 0;
  bonus += WEIGHTS.shape.lowSpreadBonus * (1 - Math.min(t.spread, 6) / 6);
  if (t.pivots.length >= 2) bonus += WEIGHTS.shape.barreBonus; // held barre
  if (t.slideIntoHammer) bonus += WEIGHTS.slideIntoHammerBonus;
  if (t.articulation && (t.articulation.type === 'hammer' || t.articulation.type === 'pull')) {
    bonus += WEIGHTS.smallMoveBonus;
  }

  let c = base * (1 + bonus);
  if (c > 1) c = 1;
  if (c < 0) c = 0;
  return Math.round(c * 1e6) / 1e6;
}

// ===========================================================================
// §8 — build(): exhaustive database.
// ===========================================================================
function build(opts = {}) {
  const options = {
    fourNote: !!opts.fourNote,
    viiMajor: !!opts.viiMajor,
    expanded: !!opts.expanded,
  };

  // reset deterministic counters so ids are pure functions of opts
  _voicingCounter = 0;
  _transitionCounter = 0;

  const chords = enumerateChords(options);

  // voicings
  const voicings = [];
  const voicingsByChord = {};
  for (const chord of chords) {
    const vs = voicingsForChord(chord);
    voicingsByChord[chord.id] = vs;
    for (const v of vs) voicings.push(v);
  }

  // index voicings by string set for transition enumeration
  const byStringSet = {};
  for (const v of voicings) {
    const key = v.stringSet.join(',');
    (byStringSet[key] || (byStringSet[key] = [])).push(v);
  }

  // transitions: every valid same-string-set ordered pair (from != to) whose
  // moves are all within 1-2 frets.
  const transitions = [];
  for (const key of Object.keys(byStringSet)) {
    const list = byStringSet[key];
    for (let i = 0; i < list.length; i++) {
      for (let j = 0; j < list.length; j++) {
        if (i === j) continue;
        const t = buildTransition(list[i], list[j]);
        if (t) transitions.push(t);
      }
    }
  }

  // ---- meta coverage counts (§8) ----
  const meta = computeMeta(options, chords, voicings, transitions);

  return {
    options,
    chords,
    voicings,
    transitions,
    meta,
  };
}

function computeMeta(options, chords, voicings, transitions) {
  const voicingsByRoot = {};
  const voicingsByStringSet = {};
  const voicingsBySize = {};
  const inversionClasses = new Set(); // chordId|stringSet|bassChordInt
  for (const v of voicings) {
    voicingsByRoot[v.rootDegree] = (voicingsByRoot[v.rootDegree] || 0) + 1;
    const ssk = v.stringSet.join(',');
    voicingsByStringSet[ssk] = (voicingsByStringSet[ssk] || 0) + 1;
    voicingsBySize[v.size] = (voicingsBySize[v.size] || 0) + 1;
    // bass = lowest sounding note = the note on the lowest SPEC index? lowest
    // sounding = largest SPEC string index in the set (lo string). notes are
    // ordered hi->lo so notes[2] is the lowest sounding.
    const bass = v.notes[2];
    inversionClasses.add(`${v.chordId}|${ssk}|${bass.chordIntPc}`);
  }

  const transClasses = new Set(); // fromRoot-toRoot
  const transByStringSet = {};
  for (const t of transitions) {
    transClasses.add(`${t.fromRoot}-${t.toRoot}`);
    const k = t.stringSet.join(',');
    transByStringSet[k] = (transByStringSet[k] || 0) + 1;
  }

  return {
    options,
    counts: {
      chords: chords.length,
      voicings: voicings.length,
      transitions: transitions.length,
    },
    voicingsByRoot,
    voicingsByStringSet,
    voicingsBySize,
    inversionClassCount: inversionClasses.size,
    transitionClassCount: transClasses.size,
    transitionClasses: [...transClasses].sort(),
    transitionsByStringSet: transByStringSet,
    stringSets: STRING_SETS.map((s) => s.join(',')),
    roots: chords.reduce((acc, c) => {
      if (!acc.includes(c.rootDegree)) acc.push(c.rootDegree);
      return acc;
    }, []),
  };
}

// ===========================================================================
// §6 — Progression generator: seeded weighted random walk.
// ===========================================================================

// chaos-shaped weight: p_i ∝ commonness_i^(1-chaos).
function chaosWeight(commonness, chaos) {
  const eps = 1e-9;
  const base = Math.max(commonness, eps);
  return Math.pow(base, 1 - chaos);
}

// Build adjacency: for each voicing, the list of outgoing transitions.
function buildAdjacency(db) {
  const adj = {};
  const voicingById = {};
  for (const v of db.voicings) voicingById[v.id] = v;
  for (const t of db.transitions) {
    (adj[t.fromVoicingId] || (adj[t.fromVoicingId] = [])).push(t);
  }
  return { adj, voicingById };
}

// One deterministic 4-chord progression.
function progression(db, params = {}) {
  const chaos = clamp01(params.chaos === undefined ? 0 : params.chaos);
  const seed = (params.seed === undefined ? 1 : params.seed) >>> 0;
  const rng = mulberry32(seed);

  const { adj, voicingById } = db._adj || (db._adj = buildAdjacency(db));

  // 1. pick the starting voicing weighted by chaos-shaped commonness.
  const starts = db.voicings.filter((v) => (adj[v.id] || []).length > 0);
  if (starts.length === 0) {
    throw new Error('no connectable voicings');
  }

  // We attempt walks; because of the ABAB forbidden rule and connectivity we
  // may need to retry. Retries consume the SAME rng stream so the whole thing
  // stays a pure function of (seed, chaos).
  const MAX_ATTEMPTS = 200;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const result = tryWalk(db, adj, starts, chaos, rng);
    if (result) return result;
  }
  // Fallback: relax ABAB? No — spec forbids it. As a last resort, do a
  // deterministic exhaustive search for any valid 4-walk.
  const fallback = deterministicWalk(db, adj, starts);
  if (fallback) return fallback;
  throw new Error('could not generate a valid progression');
}

function tryWalk(db, adj, starts, chaos, rng) {
  const startWeights = starts.map((v) => chaosWeight(v.commonness, chaos));
  const startV = starts[sampleIndex(startWeights, rng())];

  const voicings = [startV];
  const transitions = [];
  const stringSet = startV.stringSet;

  for (let step = 0; step < 3; step++) {
    const cur = voicings[voicings.length - 1];
    let outs = adj[cur.id] || [];

    // filter to candidates that keep us on the same string set (they already do
    // by construction) and don't immediately create a forbidden ABAB.
    const candidates = outs.filter((t) => {
      const nextV = db.voicings.find((x) => x.id === t.toVoicingId);
      // tentative chord sequence
      const seqRoots = voicings.map((v) => v.rootDegree).concat(nextV.rootDegree);
      return !violatesAbab(seqRoots);
    });

    if (candidates.length === 0) return null;

    const w = candidates.map((t) => chaosWeight(t.commonness, chaos));
    const chosen = candidates[sampleIndex(w, rng())];
    const nextV = db.voicings.find((x) => x.id === chosen.toVoicingId);
    voicings.push(nextV);
    transitions.push(chosen);
  }

  const roots = voicings.map((v) => v.rootDegree);
  if (violatesAbab(roots)) return null;

  return assembleProgression(voicings, transitions, stringSet);
}

// Deterministic exhaustive fallback (no rng) — finds the first valid 4-walk.
function deterministicWalk(db, adj) {
  for (const start of db.voicings) {
    const path = dfsWalk(db, adj, [start], []);
    if (path) return path;
  }
  return null;
}

function dfsWalk(db, adj, voicings, transitions) {
  if (voicings.length === 4) {
    const roots = voicings.map((v) => v.rootDegree);
    if (violatesAbab(roots)) return null;
    return assembleProgression(voicings, transitions, voicings[0].stringSet);
  }
  const cur = voicings[voicings.length - 1];
  const outs = adj[cur.id] || [];
  for (const t of outs) {
    const nextV = db.voicings.find((x) => x.id === t.toVoicingId);
    const roots = voicings.map((v) => v.rootDegree).concat(nextV.rootDegree);
    if (violatesAbabPrefix(roots)) continue;
    const res = dfsWalk(db, adj, voicings.concat(nextV), transitions.concat(t));
    if (res) return res;
  }
  return null;
}

// ABAB violation for a full 4-chord sequence: c1==c3 && c2==c4 && c1!=c2.
function violatesAbab(roots) {
  if (roots.length < 4) return false;
  return roots[0] === roots[2] && roots[1] === roots[3] && roots[0] !== roots[1];
}
// prefix check: only meaningful at length 4.
function violatesAbabPrefix(roots) {
  if (roots.length < 4) return false;
  return violatesAbab(roots);
}

function assembleProgression(voicings, transitions, stringSet) {
  const allFrets = [];
  for (const v of voicings) for (const n of v.notes) allFrets.push(n.fretRel);
  const fretWindow = { min: Math.min(...allFrets), max: Math.max(...allFrets) };

  // commonness = blend of chord priors + transition priors + bonuses.
  let prod = 1;
  for (const v of voicings) prod *= Math.max(v.commonness, 1e-6);
  for (const t of transitions) prod *= Math.max(t.commonness, 1e-6);
  // geometric mean over the 7 factors to keep in [0,1]
  const commonness = Math.round(Math.pow(prod, 1 / (voicings.length + transitions.length)) * 1e6) / 1e6;

  return {
    chords: voicings.map((v) => v.rootDegree),
    chordIds: voicings.map((v) => v.chordId),
    voicings,
    voicingIds: voicings.map((v) => v.id),
    transitions,
    transitionIds: transitions.map((t) => t.id),
    stringSet: [...stringSet],
    fretWindow,
    commonness,
  };
}

// n independent picks; seed advances per pick so each is distinct & reproducible.
function shuffle(db, params = {}) {
  const chaos = clamp01(params.chaos === undefined ? 0 : params.chaos);
  const seed = (params.seed === undefined ? 1 : params.seed) >>> 0;
  const n = params.n === undefined ? 1 : params.n;
  const out = [];
  for (let i = 0; i < n; i++) {
    // derive a sub-seed deterministically from (seed, i) via mulberry mix.
    const subSeed = deriveSeed(seed, i);
    out.push(progression(db, { chaos, seed: subSeed }));
  }
  return out;
}

// Derive a child seed deterministically from a base seed + index.
function deriveSeed(seed, i) {
  // mix using the same hashing core as mulberry32 advance.
  let a = (seed ^ (Math.imul(i + 1, 0x9e3779b1))) >>> 0;
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return (t ^ (t >>> 14)) >>> 0;
}

function clamp01(x) {
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

// ===========================================================================
// §2/§8 — label()
// ===========================================================================
// note may be { keyDegPc, chordIntPc } or { pc, chordIntPc } etc. We support the
// voicing-note shape and a raw {pc, rootPc}. `key` is an optional absolute key
// root pc for letter display (not required by engine math).
function label(note, key) {
  let keyDegPc;
  let chordIntPc;
  if (note.keyDegPc !== undefined) keyDegPc = note.keyDegPc;
  else if (note.pc !== undefined) keyDegPc = mod12(note.pc - (key || 0));
  else keyDegPc = 0;

  if (note.chordIntPc !== undefined) chordIntPc = note.chordIntPc;
  else chordIntPc = 0;

  return {
    pair: [degreeLabel(keyDegPc), chordIntLabel(chordIntPc)],
    outside: isOutside(keyDegPc),
  };
}

// ===========================================================================
// Public API object
// ===========================================================================
const Fretboard = {
  TUNING,
  WEIGHTS,
  STRING_SETS,
  degreeLabel,
  isOutside,
  chordIntLabel,
  build,
  progression,
  shuffle,
  label,
  // exposed internals for testing / advanced use:
  _internal: {
    mulberry32,
    chaosWeight,
    enumerateChords,
    chordMembers,
    voicingsForChord,
    enumerateAllAssignments,
    buildTransition,
    deriveSeed,
    sampleIndex,
  },
};

// Browser global
if (typeof globalThis !== 'undefined') {
  globalThis.Fretboard = Fretboard;
}

export { Fretboard };
export default Fretboard;
