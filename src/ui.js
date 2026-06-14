/* =============================================================================
 *  Fretboard UI — pure JS, zero deps. SVG renderer.
 *
 *  Renders a four-chord Progression (SPEC §6/§9):
 *    - 4 panels left->right (chords 1..4)
 *    - strings VERTICAL, frets HORIZONTAL, static 12-fret window, no fret #s
 *    - each panel shows the chord in THREE voicings/positions
 *    - geometric fidelity: y of every note derived from note.fretRel
 *    - within-voicing articulation arcs (b3<->3 / b7<->7)
 *    - cross-panel transition arrows, colored by articulation, arrowhead=dir
 *
 *  Rendering is a PURE function of the engine output (no Math.random here).
 *
 *  ---------------------------------------------------------------------------
 *  FIELDS THIS RENDERER READS  (engine must guarantee these):
 *    Progression: chords[].rootDegree, stringSet, fretWindow.{min,max},
 *                 commonness, voicings[] (chosen v1..v4), transitions[] (t12..),
 *                 + STUB: panelVoicings[[v x3] x4], panelTransitions[[t x2] x4]
 *                 (see ASSUMPTION note — real engine field name TBD)
 *    Voicing:     id, rootDegree, stringSet[hi,mid,lo], spread, barre,
 *                 notes[].{stringIdx, fretRel, keyDeg, chordInt, isRoot, outside}
 *    Transition:  fromVoicingId, toVoicingId, stringSet, articulation.{type,
 *                 direction}, pivots[], slideIntoHammer, moves[].{stringIdx,
 *                 fromFret, toFret, delta}
 * ========================================================================== */
(function () {
  'use strict';

  const SVGNS = 'http://www.w3.org/2000/svg';
  const FRETS = 12;                 // static 12-fret window (rows)

  // ---- layout geometry (all in svg user units) ----------------------------
  const PANEL_W = 232;              // width of one fretboard panel
  const GUTTER  = 44;               // gap between panels (boards sit close together)
  const PAD_X   = 26;
  const TOP     = 58;               // headroom for panel labels
  const BOARD_H = 540;              // height of the 12-fret board
  const BOTTOM  = 46;               // nut headroom below board
  const STAGE_W = PAD_X * 2 + PANEL_W * 4 + GUTTER * 3;
  const STAGE_H = TOP + BOARD_H + BOTTOM;

  const ART_COLOR = {
    hammer: '#5eead4', pull: '#c08cff', slide: '#7c9cff', bend: '#ff7eb6'
  };
  // symbol-only glyphs per articulation type (no words anywhere in the UI)
  const ART_GLYPH = {
    hammer: '⌒', pull: '⌣', slide: '∕', bend: '↝'
  };

  // articulation pair sets for within-voicing detection
  const THIRD_PAIR  = new Set(['b3', '3']);
  const SEVENTH_PAIR = new Set(['b7', '7']);

  // ----- helpers ------------------------------------------------------------
  function el(name, attrs, children) {
    const n = document.createElementNS(SVGNS, name);
    if (attrs) for (const k in attrs) {
      if (attrs[k] == null) continue;
      n.setAttribute(k, attrs[k]);
    }
    if (children) (Array.isArray(children) ? children : [children]).forEach(c => {
      if (c) n.appendChild(c);
    });
    return n;
  }

  // x within a panel for a given string index (1=high E rightmost? we map
  // hi->left ... lo->right reading like a chord chart held up). We render the
  // three active strings of the voicing's string set evenly across the panel,
  // and draw the full 6-string context faintly behind.
  function panelX(panelIdx) { return PAD_X + panelIdx * (PANEL_W + GUTTER); }

  // y for a fret index inside the 12-fret window (fret 0 = nut at top).
  // Evenly spaced rows shared by all panels => distances comparable. GEOMETRIC
  // FIDELITY: y is a pure linear function of fretRel.
  function fretY(fret) {
    const rowH = BOARD_H / FRETS;
    return TOP + fret * rowH + rowH * 0.5;
  }

  // Map the six string indices (1..6) to x within a panel. The active three
  // (the voicing's string set) are spread wide & bright; context strings sit
  // between/around faintly. We lay strings 6(low,left) .. 1(high,right).
  function stringX(px, stringIdx) {
    // stringIdx 1..6 ; place 6 at left, 1 at right
    const inset = 30;
    const usable = PANEL_W - inset * 2;
    const t = (6 - stringIdx) / 5; // stringIdx6 -> 0, stringIdx1 -> 1
    return px + inset + t * usable;
  }

  // ----- public render ------------------------------------------------------
  let _shuffleN = 0;

  function buildBoard(prog) {
    const root = el('g');
    // three stacked layers so articulation arrows always sit ABOVE the boards
    // but BEHIND the note bubbles — they never paint over a note (§ user req).
    const boards = el('g', { class: 'layer-boards' });
    const arrows = el('g', { class: 'layer-arrows' });
    const notes  = el('g', { class: 'layer-notes' });
    const active = new Set(prog.stringSet);

    for (let p = 0; p < 4; p++) {
      const px = panelX(p);
      const g = el('g', { class: 'panel', 'data-panel': p });

      // panel plate
      g.appendChild(el('rect', {
        x: px, y: TOP - 8, width: PANEL_W, height: BOARD_H + 16,
        rx: 12, fill: 'url(#plate)', stroke: '#1c2130', 'stroke-width': 1
      }));

      // fret rows (horizontal) — shared identical grid
      for (let f = 0; f <= FRETS; f++) {
        const y = TOP + (BOARD_H / FRETS) * f;
        const isNut = f === 0;
        g.appendChild(el('line', {
          x1: px + 14, y1: y, x2: px + PANEL_W - 14, y2: y,
          stroke: isNut ? '#39415a' : '#161a26',
          'stroke-width': isNut ? 2.4 : 1
        }));
      }

      // strings (vertical) — context faint, active bright
      for (let s = 6; s >= 1; s--) {
        const x = stringX(px, s);
        const on = active.has(s);
        g.appendChild(el('line', {
          x1: x, y1: TOP, x2: x, y2: TOP + BOARD_H,
          stroke: on ? '#2b3550' : '#13161f',
          'stroke-width': on ? 1.6 : 1,
          'stroke-linecap': 'round',
          opacity: on ? 0.95 : 0.45
        }));
        if (on) {
          // subtle glow rail under active string
          g.appendChild(el('line', {
            x1: x, y1: TOP, x2: x, y2: TOP + BOARD_H,
            stroke: '#5eead4', 'stroke-width': 5, opacity: 0.05,
            filter: 'url(#soft)'
          }));
        }
      }

      const voicings = panelVoicingsFor(prog, p);

      // background anchor markers (key-root + chord-root, muted) + position guides
      drawBackgroundMarkers(g, px, prog, voicings);
      drawWithinConnectors(g, px, voicings);
      boards.appendChild(g);

      // the chord degree of THIS panel, above its board
      drawPanelDegree(notes, px, prog.chords[p]);

      // note bubbles -> NOTES layer (top); within-voicing slurs -> ARROWS layer
      voicings.forEach((v, vi) => drawVoicing(notes, px, v, vi, voicings.length));
      voicings.forEach((v, vi) => drawWithinArticulations(arrows, px, v, vi === 0 ? 1 : 0.66));
    }

    // cross-panel transition arrows (between chosen voicings) -> ARROWS layer
    for (let t = 0; t < 3; t++) {
      drawTransition(arrows, t, prog.transitions[t], chosenVoicing(prog, t), chosenVoicing(prog, t + 1));
    }

    root.appendChild(boards);
    root.appendChild(arrows);
    root.appendChild(notes);
    return root;
  }

  // big chord-degree label centered above each panel (e.g. 5 · 1 · 5 · VII)
  function drawPanelDegree(parent, px, degree) {
    const t = el('text', {
      x: px + PANEL_W / 2, y: TOP - 22, 'text-anchor': 'middle',
      'dominant-baseline': 'middle', class: 'panel-degree'
    });
    t.appendChild(document.createTextNode(degSym(degree)));
    parent.appendChild(t);
  }

  // chosen voicing per slot = first of panelVoicings, falling back to prog.voicings
  function chosenVoicing(prog, slot) {
    if (prog.panelVoicings && prog.panelVoicings[slot]) return prog.panelVoicings[slot][0];
    return prog.voicings[slot];
  }
  function panelVoicingsFor(prog, slot) {
    if (prog.panelVoicings && prog.panelVoicings[slot]) return prog.panelVoicings[slot];
    return [prog.voicings[slot]]; // degrade gracefully to single voicing
  }

  // ---- background anchor markers -------------------------------------------
  function m12(n) { return ((n % 12) + 12) % 12; }
  function openAbsOf(stringIdx) {
    const T = (window.Fretboard && window.Fretboard.TUNING) || [4, 9, 2, 7, 11, 4];
    return T[6 - stringIdx]; // stringIdx 1=high E -> T[5]; 6=low E -> T[0]
  }
  function diamond(x, y, r) {
    return `M ${x} ${y - r} L ${x + r} ${y} L ${x} ${y + r} L ${x - r} ${y} Z`;
  }
  // Mark EVERY occurrence of the scale-key root (key degree 1) and the current
  // chord's root across all six strings of the 12-fret window — muted/hollow,
  // skipped where a displayed voicing note already sits there (§9). Key-root and
  // chord-root are rendered with distinct shape + hue.
  function drawBackgroundMarkers(g, px, prog, voicings) {
    const lead = voicings[0];
    if (!lead) return;
    const occupied = new Set();
    voicings.forEach(v => v.notes.forEach(n => occupied.add(n.stringIdx + ':' + n.fretRel)));
    let keyRootAbs = null;
    for (const n of lead.notes) {
      if (n.keyDegPc != null) { keyRootAbs = m12(openAbsOf(n.stringIdx) + n.fretRel - n.keyDegPc); break; }
    }
    if (keyRootAbs == null) return;
    const rootNote = lead.notes.find(n => n.isRoot);
    const chordRootPc = rootNote ? rootNote.keyDegPc : null;
    for (let s = 6; s >= 1; s--) {
      const oAbs = openAbsOf(s);
      const x = stringX(px, s);
      for (let f = 0; f < FRETS; f++) {
        if (occupied.has(s + ':' + f)) continue;
        const deg = m12(oAbs + f - keyRootAbs);
        const isKey = deg === 0;
        const isChord = !isKey && chordRootPc != null && deg === chordRootPc;
        if (!isKey && !isChord) continue;
        const y = fretY(f);
        if (isKey) {
          // scale-key root (tonal home) — neutral gray hollow diamond
          g.appendChild(el('path', {
            d: diamond(x, y, 5.5), fill: 'none', stroke: '#737d92',
            'stroke-width': 1.2, opacity: 0.5
          }));
        } else {
          // chord root — neutral gray filled dot (no ring)
          g.appendChild(el('circle', {
            cx: x, cy: y, r: 3, fill: '#5b6478', opacity: 0.55
          }));
        }
      }
    }
  }

  // ---- within-panel: dim connector showing the 3 positions up the neck -----
  function drawWithinConnectors(g, px, voicings) {
    if (voicings.length < 2) return;
    // for each active string, connect successive voicings' notes vertically
    const byString = {};
    voicings.forEach((v, vi) => v.notes.forEach(n => {
      (byString[n.stringIdx] = byString[n.stringIdx] || []).push({ vi, fret: n.fretRel });
    }));
    Object.keys(byString).forEach(sk => {
      const pts = byString[sk].sort((a, b) => a.vi - b.vi);
      const x = stringX(px, +sk);
      for (let i = 0; i < pts.length - 1; i++) {
        g.appendChild(el('line', {
          x1: x, y1: fretY(pts[i].fret), x2: x, y2: fretY(pts[i + 1].fret),
          stroke: '#2a3350', 'stroke-width': 1, 'stroke-dasharray': '2 5',
          opacity: 0.5
        }));
      }
    });
  }

  // ---- a single voicing: dots + labels + within articulation arcs ----------
  function drawVoicing(parent, px, v, vIndex, total) {
    if (!v) return;
    const g = el('g', { class: 'note-grp' });
    // stagger the pop-in for a lively shuffle
    g.style.animationDelay = (vIndex * 60) + 'ms';

    // barre underlay if present
    if (v.barre !== false && v.barre != null) {
      const ys = fretY(v.barre);
      const xs = v.notes.filter(n => n.fretRel === v.barre).map(n => stringX(px, n.stringIdx));
      if (xs.length >= 2) {
        const x1 = Math.min(...xs), x2 = Math.max(...xs);
        g.appendChild(el('rect', {
          x: x1 - 12, y: ys - 9, width: (x2 - x1) + 24, height: 18, rx: 9,
          fill: 'none', stroke: '#39415a', 'stroke-width': 1.4,
          'stroke-dasharray': '1 4', opacity: 0.6
        }));
      }
    }

    // dim the non-primary voicings slightly so the chosen (index 0) leads
    const lead = vIndex === 0;
    const baseOpacity = lead ? 1 : 0.66;

    v.notes.forEach(n => {
      const cx = stringX(px, n.stringIdx);
      const cy = fretY(n.fretRel);
      const r = lead ? 15 : 13;

      // ring the three notes of the chord ACTUALLY being played (lead voicing)
      if (lead) {
        g.appendChild(el('circle', {
          cx, cy, r: r + 6, fill: 'none',
          stroke: n.isRoot ? '#ffd479' : (n.outside ? '#ff9d5c' : '#5eead4'),
          'stroke-width': 1.6, opacity: 0.8, filter: 'url(#glow)'
        }));
      }

      const fill = n.isRoot ? 'url(#gRoot)'
        : n.outside ? 'url(#gAmber)'
        : 'url(#gNote)';

      // outside note => dashed amber ring
      const circle = el('circle', {
        cx, cy, r,
        fill, opacity: baseOpacity,
        stroke: n.outside ? '#ff9d5c' : (n.isRoot ? '#ffd479' : '#5eead4'),
        'stroke-width': n.outside ? 1.6 : 1,
        'stroke-dasharray': n.outside ? '3 3' : null,
        filter: lead ? 'url(#glow)' : null
      });
      g.appendChild(circle);

      // keyDeg · chordInt label
      const txt = el('text', {
        x: cx, y: cy + 0.5, 'text-anchor': 'middle', 'dominant-baseline': 'central',
        class: 'note-pair',
        fill: n.isRoot ? '#1b160a' : (n.outside ? '#241407' : '#04201c'),
        opacity: baseOpacity
      });
      txt.appendChild(document.createTextNode(n.keyDeg + '·' + n.chordInt));
      g.appendChild(txt);
    });

    // (within-voicing articulation slurs are drawn into the ARROWS layer so they
    // sit behind the note bubbles — see buildBoard)

    parent.appendChild(g);
  }

  // within-voicing articulation opportunities (b3<->3 / b7<->7), straight from
  // the engine's per-voicing articulation list. Drawn as a small same-string
  // slur arc with a directional tip — SYMBOL ONLY, never a word.
  function drawWithinArticulations(g, px, v, op) {
    const arts = v.articulations || [];
    arts.forEach(a => {
      if (!a.fromNote || !a.toNote) return;
      const s = a.fromNote.stringIdx;
      const x = stringX(px, s);
      const y0 = fretY(a.fromNote.fretRel);
      const y1 = fretY(a.toNote.fretRel);
      const up = a.direction === 'up' || a.toNote.fretRel > a.fromNote.fretRel;
      const color = up ? ART_COLOR.hammer : ART_COLOR.pull;
      const bow = 15;
      const my = (y0 + y1) / 2;
      g.appendChild(el('path', {
        d: `M ${x} ${y0} Q ${x + bow} ${my} ${x} ${y1}`,
        fill: 'none', stroke: color, 'stroke-width': 1.7,
        opacity: 0.78 * op, 'marker-end': up ? 'url(#tipUp)' : 'url(#tipDown)',
        'stroke-linecap': 'round'
      }));
    });
  }

  // ---- cross-panel transition arrow ----------------------------------------
  function drawTransition(parent, tIndex, tr, fromV, toV) {
    if (!tr || !fromV || !toV) return;
    const fromPx = panelX(tIndex);
    const toPx   = panelX(tIndex + 1);
    const g = el('g', { class: 'arrow-grp' });
    g.style.animationDelay = (260 + tIndex * 90) + 'ms';

    const color = ART_COLOR[tr.articulation && tr.articulation.type] || '#7c9cff';
    const pivots = new Set(tr.pivots || []);

    // build a quick lookup of note frets by string for from/to
    const fFret = {}, tFret = {};
    fromV.notes.forEach(n => fFret[n.stringIdx] = n.fretRel);
    toV.notes.forEach(n => tFret[n.stringIdx] = n.fretRel);

    // one connecting strand per active string between the two panels.
    // GEOMETRIC FIDELITY: y endpoints are the real fret positions, so the
    // vertical component of each arrow == the real fret delta.
    const EDGE = 16; // attach at the bubble edge, never the centre — stays clear of notes
    const strings = fromV.stringSet;
    strings.forEach(s => {
      const yF = fretY(fFret[s]);
      const yT = fretY(tFret[s]);
      const x1 = stringX(fromPx, s) + EDGE;
      const x2 = stringX(toPx, s) - EDGE;
      const held = pivots.has(s) || (fFret[s] === tFret[s]);

      if (held) {
        // pivot / barre held string — dimmed flat tie
        g.appendChild(el('path', {
          d: bridge(x1, yF, x2, yT, 0.18),
          fill: 'none', stroke: '#39415a', 'stroke-width': 1.2,
          'stroke-dasharray': '1 5', opacity: 0.5
        }));
        return;
      }

      const up = yT < yF; // higher fret = lower y? note: fret increases downward
      // fret number increases downward, so "up the neck" (higher fret) = larger y.
      const dirUp = tFret[s] < fFret[s]; // moving toward nut = up-pitch toward open? treat delta sign
      const marker = (toV && tFret[s] > fFret[s]) ? 'url(#headDown)' : 'url(#headUp)';

      g.appendChild(el('path', {
        d: bridge(x1, yF, x2, yT, 0.32),
        fill: 'none', stroke: color, 'stroke-width': 2.2,
        opacity: 0.92, 'marker-end': marker, 'stroke-linecap': 'round',
        filter: 'url(#soft)'
      }));
      // crisp top stroke
      g.appendChild(el('path', {
        d: bridge(x1, yF, x2, yT, 0.32),
        fill: 'none', stroke: color, 'stroke-width': 1.4, opacity: 0.95,
        'marker-end': marker, 'stroke-linecap': 'round'
      }));
    });

    parent.appendChild(g);
  }

  // a smooth horizontal-leaning bezier from (x1,y1) to (x2,y2); k = curvature
  function bridge(x1, y1, x2, y2, k) {
    const dx = (x2 - x1);
    const c1x = x1 + dx * (0.45 + k * 0.0);
    const c2x = x2 - dx * (0.45 + k * 0.0);
    return `M ${x1} ${y1} C ${c1x} ${y1}, ${c2x} ${y2}, ${x2} ${y2}`;
  }

  // ---- svg defs: gradients, glows, arrowheads ------------------------------
  function buildDefs() {
    const defs = el('defs');

    const plate = el('linearGradient', { id: 'plate', x1: 0, y1: 0, x2: 0, y2: 1 });
    plate.appendChild(el('stop', { offset: '0%', 'stop-color': '#10131c' }));
    plate.appendChild(el('stop', { offset: '100%', 'stop-color': '#0a0c13' }));
    defs.appendChild(plate);

    function radial(id, c0, c1) {
      const rg = el('radialGradient', { id, cx: '38%', cy: '32%', r: '75%' });
      rg.appendChild(el('stop', { offset: '0%', 'stop-color': c0 }));
      rg.appendChild(el('stop', { offset: '100%', 'stop-color': c1 }));
      defs.appendChild(rg);
    }
    radial('gNote', '#8af6e4', '#2bbfa8');   // teal note
    radial('gRoot', '#ffe6a8', '#f5b94a');   // gold root
    radial('gAmber', '#ffc28f', '#ff8a45');  // amber outside

    // soft blur
    const soft = el('filter', { id: 'soft', x: '-50%', y: '-50%', width: '200%', height: '200%' });
    soft.appendChild(el('feGaussianBlur', { stdDeviation: 2.4 }));
    defs.appendChild(soft);

    // glow
    const glow = el('filter', { id: 'glow', x: '-80%', y: '-80%', width: '260%', height: '260%' });
    glow.appendChild(el('feGaussianBlur', { stdDeviation: 3.2, result: 'b' }));
    const merge = el('feMerge');
    merge.appendChild(el('feMergeNode', { in: 'b' }));
    merge.appendChild(el('feMergeNode', { in: 'SourceGraphic' }));
    glow.appendChild(merge);
    defs.appendChild(glow);

    // arrowheads
    function head(id, color, flip) {
      const m = el('marker', {
        id, viewBox: '0 0 10 10', refX: 8, refY: 5,
        markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse'
      });
      m.appendChild(el('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: color }));
      defs.appendChild(m);
    }
    head('headUp', '#7c9cff');
    head('headDown', '#7c9cff');
    // small within-voicing tips
    function tip(id, color) {
      const m = el('marker', {
        id, viewBox: '0 0 10 10', refX: 6, refY: 5,
        markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse'
      });
      m.appendChild(el('path', { d: 'M 0 1 L 8 5 L 0 9', fill: 'none', stroke: color, 'stroke-width': 1.6 }));
      defs.appendChild(m);
    }
    tip('tipUp', ART_COLOR.hammer);
    tip('tipDown', ART_COLOR.pull);

    return defs;
  }

  // ---- top-level boot ------------------------------------------------------
  const App = {
    db: null,
    seed: 1,
    chaos: 0,
    prog: null,

    init(mountId) {
      this.mount = document.getElementById(mountId);
      // SPEC §9: database always built full
      this.db = window.Fretboard.build({ fourNote: true, viiMajor: true });
      // A progression is fully determined by (seed, chaos) — the engine is pure.
      // So a URL like ?seed=1244134585&chaos=0 reproduces an exact favorite and
      // is bookmarkable. If no seed in the URL, first load is a RANDOM progression
      // at the lowest chaos (most common).
      const u = new URLSearchParams(location.search);
      const us = parseInt(u.get('seed'), 10);
      const uc = parseFloat(u.get('chaos'));
      this.seed = Number.isFinite(us) ? (us >>> 0) : ((Math.random() * 0x7fffffff) >>> 0);
      this.chaos = Number.isFinite(uc) ? Math.min(1, Math.max(0, uc)) : 0;
      this.wireControls();
      // reflect the active chaos on the existing slider (no new UI)
      const cs = document.getElementById('chaos');
      const cv = document.getElementById('chaosVal');
      if (cs) cs.value = Math.round(this.chaos * 100);
      if (cv) cv.textContent = this.chaos.toFixed(2);
      this.draw();
    },

    wireControls() {
      const shuffleBtn = document.getElementById('shuffle');
      const chaos = document.getElementById('chaos');
      const chaosVal = document.getElementById('chaosVal');
      shuffleBtn.addEventListener('click', () => {
        this.seed += 1;        // increment seed (SPEC §9)
        this.draw();
      });
      chaos.addEventListener('input', () => {
        this.chaos = (+chaos.value) / 100;
        chaosVal.textContent = this.chaos.toFixed(2);
        this.draw();
      });
    },

    // mirror current (seed, chaos) into the URL so any state is bookmarkable.
    syncURL() {
      const qs = '?seed=' + this.seed + '&chaos=' + this.chaos;
      history.replaceState(null, '', qs);
    },

    draw() {
      this.prog = window.Fretboard.progression(this.db, { chaos: this.chaos, seed: this.seed });
      this.render(this.prog);
      this.renderMeta(this.prog);
      this.syncURL();
    },

    render(prog) {
      const svg = el('svg', {
        id: 'stage', viewBox: `0 0 ${STAGE_W} ${STAGE_H}`,
        preserveAspectRatio: 'xMidYMid meet', class: 'fade-in'
      });
      svg.appendChild(buildDefs());
      svg.appendChild(buildBoard(prog));
      this.mount.innerHTML = '';
      this.mount.appendChild(svg);
    },

    renderMeta(prog) {
      const seq = document.getElementById('seqChips');
      const ssEl = document.getElementById('ssChip');
      const seedEl = document.getElementById('seedChip');
      const cb = document.getElementById('commonBar');
      if (seq) {
        seq.textContent = prog.chords.map(c => degSym(c)).join('  →  ');
      }
      if (ssEl) ssEl.textContent = prog.stringSet.slice().reverse().join('-');
      if (seedEl) seedEl.textContent = this.seed;
      if (cb) cb.style.transform = 'scaleX(' + (prog.commonness || 0) + ')';
    }
  };

  function degSym(d) {
    return d === 7 || d === 'VII' ? 'VII' : String(d);
  }

  window.FretboardUI = App;
})();
