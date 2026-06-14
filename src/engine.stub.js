/* =============================================================================
 *  STUB ENGINE  —  DELETE THIS FILE AT INTEGRATION TIME.
 * -----------------------------------------------------------------------------
 *  This is NOT the real engine. It is a small, self-contained fake that emits
 *  objects matching the SPEC §8 / §4 / §5 / §6 shapes so the dev page renders
 *  standalone. The real engine will expose the identical global `Fretboard`
 *  API. To swap: drop the real engine in and remove this file + its <script>
 *  tag from index.dev.html. ui.js reads ONLY the documented fields (see the
 *  report / the comments in ui.js).
 *
 *  Determinism: every value below is derived from a seeded mulberry32 PRNG.
 *  Same (seed, chaos) => same Progression. No Math.random anywhere.
 * ========================================================================== */
(function () {
  'use strict';

  // ---- seeded PRNG (mulberry32), per SPEC §7 -------------------------------
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---- Nashville label system (SPEC §1) ------------------------------------
  // semitone -> label ; 6 = b5 (outside); 1 & 8 unused.
  const LABELS = {
    0: '1', 2: '2', 3: 'b3', 4: '3', 5: '4', 6: 'b5',
    7: '5', 9: '6', 10: 'b7', 11: '7'
  };
  const ROOT_SEMI = { 1: 0, 2: 2, 3: 4, 4: 5, 5: 7, 6: 9, 7: 11 };

  function degreeLabel(semi) {
    return LABELS[((semi % 12) + 12) % 12] || '?';
  }
  function isOutside(semi) {
    return (((semi % 12) + 12) % 12) === 6;
  }

  const TUNING = [4, 9, 2, 7, 11, 4]; // low->high E A D G B E (absolute PCs)
  // string index naming per SPEC §4: 1=high E ... 6=low E
  const STRING_SETS = [[1, 2, 3], [2, 3, 4], [3, 4, 5], [4, 5, 6]];

  // chord vocabulary: rootDegree + chord interval recipe (chordInt semitone)
  // chordInt 0=1, 3=b3, 4=3, 7=5, 10=b7, 11=7
  const CHORD_LIB = [
    { rootDegree: 1, third: 4, hasSeventh: false, name: '1' },
    { rootDegree: 4, third: 4, hasSeventh: false, name: '4' },
    { rootDegree: 5, third: 4, hasSeventh: true, name: '5' },
    { rootDegree: 6, third: 3, hasSeventh: false, name: '6' },
    { rootDegree: 2, third: 3, hasSeventh: false, name: '2' },
    { rootDegree: 3, third: 3, hasSeventh: false, name: '3' }
  ];

  let _vid = 0;

  // Build the three chord tones (as {chordInt, semitoneAboveRoot}) for a chord.
  function chordTones(chord, fourNote) {
    // root, third, fifth  (+ seventh dropped-third form if fourNote)
    const tones = [];
    tones.push({ chordInt: '1', above: 0, slot: 'root' });
    if (fourNote && chord.hasSeventh) {
      // 4-note 3-string drop-third: root + fifth + seventh (SPEC §3)
      tones.push({ chordInt: '5', above: 7, slot: 'fifth' });
      tones.push({ chordInt: '7', above: 11, slot: 'seventh' });
    } else {
      tones.push({ chordInt: chord.third === 3 ? 'b3' : '3', above: chord.third, slot: 'third' });
      tones.push({ chordInt: '5', above: 7, slot: 'fifth' });
    }
    return tones;
  }

  // Make ONE voicing for a chord at a given base fret + inversion ordering.
  function makeVoicing(chord, stringSet, baseFret, rnd, fourNote) {
    const tones = chordTones(chord, fourNote && chord.hasSeventh);
    const rootKeySemi = ROOT_SEMI[chord.rootDegree];

    // assign tones to the three strings (hi, mid, lo). Inversion = rotation.
    const rot = Math.floor(rnd() * 3);
    const ordered = tones.slice(rot).concat(tones.slice(0, rot));

    // pick a tight set of frets (spread <= 3) around baseFret, geometric fidelity
    const offsets = [0, Math.floor(rnd() * 3), Math.floor(rnd() * 3)];
    const notes = ordered.map((tone, i) => {
      const stringIdx = stringSet[i]; // [hi, mid, lo]
      let fretRel = baseFret + offsets[i];
      if (fretRel > 11) fretRel = fretRel % 12;
      const keySemi = ((rootKeySemi + tone.above) % 12 + 12) % 12;
      return {
        stringIdx,
        fretRel,
        pc: keySemi,
        keyDeg: degreeLabel(keySemi),
        chordInt: tone.chordInt,
        isRoot: tone.chordInt === '1',
        outside: isOutside(keySemi)
      };
    });

    const frets = notes.map(n => n.fretRel);
    const minF = Math.min(...frets), maxF = Math.max(...frets);
    const spread = maxF - minF;
    const lowest = minF;
    const barreCount = frets.filter(f => f === lowest).length;

    return {
      id: 'v' + (_vid++),
      chordId: 'c' + chord.rootDegree,
      rootDegree: chord.rootDegree,
      stringSet: stringSet.slice(),
      notes,
      spread,
      barre: barreCount >= 2 ? lowest : false,
      fingerScore: +(0.5 + rnd() * 0.5).toFixed(3),
      commonness: +(0.3 + rnd() * 0.7).toFixed(3)
    };
  }

  // Build a transition between two voicings on the SAME string set.
  function makeTransition(fromV, toV, rnd) {
    const moves = [];
    const pivots = [];
    // pair notes by string index
    for (const fn of fromV.notes) {
      const tn = toV.notes.find(n => n.stringIdx === fn.stringIdx);
      if (!tn) continue;
      const delta = tn.fretRel - fn.fretRel;
      if (delta === 0) {
        pivots.push(fn.stringIdx);
      } else {
        moves.push({ stringIdx: fn.stringIdx, fromFret: fn.fretRel, toFret: tn.fretRel, delta });
      }
    }
    const ARTS = ['hammer', 'pull', 'slide', 'bend'];
    const maxMove = moves.reduce((m, x) => Math.max(m, Math.abs(x.delta)), 0);
    const artType = maxMove === 0 ? 'pull'
      : maxMove === 1 ? (rnd() < 0.5 ? 'hammer' : 'pull')
      : ARTS[Math.floor(rnd() * ARTS.length)];
    const avgDelta = moves.reduce((s, x) => s + x.delta, 0);
    const direction = avgDelta >= 0 ? 'up' : 'down';

    const allFrets = fromV.notes.concat(toV.notes).map(n => n.fretRel);
    const spread = Math.max(...allFrets) - Math.min(...allFrets);

    return {
      fromVoicingId: fromV.id,
      toVoicingId: toV.id,
      stringSet: fromV.stringSet.slice(),
      moves,
      pivots,
      articulation: { type: artType, direction },
      oneDirectional: rnd() < 0.35,
      direction,
      slideIntoHammer: artType === 'slide' && rnd() < 0.5,
      spread,
      commonness: +(0.3 + rnd() * 0.7).toFixed(3)
    };
  }

  // -------------------------------------------------------------------------
  function build(opts) {
    opts = opts || {};
    return {
      chords: CHORD_LIB.map(c => ({ id: 'c' + c.rootDegree, rootDegree: c.rootDegree })),
      voicings: [],   // stub: generated lazily per-progression
      transitions: [],
      meta: { stub: true, fourNote: !!opts.fourNote, viiMajor: !!opts.viiMajor }
    };
  }

  // Pick a chord-identity sequence honoring SPEC §6 (no ABAB).
  function pickSequence(rnd, chaos) {
    const common = [1, 4, 5, 6, 1, 4, 5, 1]; // weighted-ish pool
    function draw() {
      if (chaos > 0.6 && rnd() < chaos) {
        return CHORD_LIB[Math.floor(rnd() * CHORD_LIB.length)];
      }
      const deg = common[Math.floor(rnd() * common.length)];
      return CHORD_LIB.find(c => c.rootDegree === deg) || CHORD_LIB[0];
    }
    for (let tries = 0; tries < 20; tries++) {
      const seq = [draw(), draw(), draw(), draw()];
      const d = seq.map(c => c.rootDegree);
      const abab = d[0] === d[2] && d[1] === d[3] && d[0] !== d[1];
      if (!abab) return seq;
    }
    return [CHORD_LIB[0], CHORD_LIB[1], CHORD_LIB[2], CHORD_LIB[0]];
  }

  function progression(db, params) {
    params = params || {};
    const seed = params.seed >>> 0 || 1;
    const chaos = typeof params.chaos === 'number' ? params.chaos : 0;
    const rnd = mulberry32(seed * 2654435761 >>> 0);
    _vid = 0;

    const fourNote = db && db.meta && db.meta.fourNote;
    const seq = pickSequence(rnd, chaos);
    const stringSet = STRING_SETS[Math.floor(rnd() * STRING_SETS.length)];

    // Per SPEC §6/§9: each chord shown in THREE connected voicings/positions.
    // STUB ASSUMPTION: each progression "slot" carries an array of up-to-3
    // voicings (panelVoicings[slot] = [v,v,v]). The "chosen" voicing used for
    // cross-panel transitions is index 0 of each slot.
    const baseFrets = [1, 4, 8]; // three positions up the relative neck
    const panelVoicings = seq.map(chord => {
      return baseFrets.map(bf => makeVoicing(chord, stringSet, bf, rnd, fourNote));
    });

    // chosen voicing per slot = the first (index 0)
    const chosen = panelVoicings.map(vs => vs[0]);

    // within-panel transitions: connect the 3 voicings of each chord up the neck
    const withinTransitions = panelVoicings.map(vs => [
      makeTransition(vs[0], vs[1], rnd),
      makeTransition(vs[1], vs[2], rnd)
    ]);

    // cross-panel transitions between chosen voicings (t12, t23, t34)
    const transitions = [
      makeTransition(chosen[0], chosen[1], rnd),
      makeTransition(chosen[1], chosen[2], rnd),
      makeTransition(chosen[2], chosen[3], rnd)
    ];

    const commonness = +(chosen.reduce((s, v) => s + v.commonness, 0) / 4).toFixed(3);
    const allFrets = [];
    panelVoicings.forEach(vs => vs.forEach(v => v.notes.forEach(n => allFrets.push(n.fretRel))));

    return {
      chords: seq.map(c => ({ id: 'c' + c.rootDegree, rootDegree: c.rootDegree })),
      voicings: chosen,                 // SPEC §6: v1..v4 (the chosen voicing per slot)
      transitions,                      // SPEC §6: t12,t23,t34
      stringSet: stringSet.slice(),
      fretWindow: { min: 0, max: 11 },  // static 12-fret window
      commonness,

      /* ---- STUB EXTENSION (see ASSUMPTION in report) ----------------------
       * The SPEC says "three voicings per panel" but the documented
       * Progression shape only lists one voicing per slot. ui.js renders an
       * array per panel, so the stub exposes that array here. The real engine
       * must provide an equivalent (field name to be reconciled).            */
      panelVoicings,                    // [[v,v,v] x4]  <- 3 voicings per panel
      panelTransitions: withinTransitions // [[t,t] x4]  <- within-panel connectors
    };
  }

  function shuffle(db, params) {
    params = params || {};
    const n = params.n || 1;
    const out = [];
    for (let i = 0; i < n; i++) {
      out.push(progression(db, { chaos: params.chaos, seed: (params.seed || 1) + i }));
    }
    return out;
  }

  window.Fretboard = {
    TUNING,
    degreeLabel,
    isOutside,
    build,
    progression,
    shuffle,
    label: function (note) {
      return { pair: [note.keyDeg, note.chordInt], outside: !!note.outside };
    },
    __STUB__: true
  };
})();
