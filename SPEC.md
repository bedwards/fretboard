# Fretboard — Nashville-Number 3-String Voicing Explorer

Single-file `index.html` (inline JS/CSS, **zero dependencies**). Deterministic engine + Claude-run
smoke/regression tests. Dark, vibey UI. Deploy to GitHub Pages + Cloudflare Pages.

Genre frame: **folk / rock / blues / country** (not jazz). Goal: find clusters of fingerable
three-string chord/inversion voicings, surface musical articulation opportunities, and chain them
into common four-chord progressions whose transitions also invite articulations.

---

## 1. Note & degree system

All math is **key-relative** and done in pitch classes (mod 12). Key is just a relabeling — the neck
is relative, so changing key never changes geometry, only the letter shown (optional).

Chromatic semitone → Nashville label (the display alphabet, "major scale + two notes"):

| semitone | 0 | 1 | 2 | 3  | 4 | 5 | 6   | 7 | 8   | 9 | 10 | 11 |
|----------|---|---|---|----|---|---|-----|---|-----|---|----|----|
| label    | 1 | – | 2 | b3 | 3 | 4 | (b5)| 5 | –   | 6 | b7 | 7  |

- **Base in-key set** `S = {0,2,3,4,5,7,9,10,11}` → labels `1 2 b3 3 4 5 6 b7 7` (9 notes).
- Semitone **6** = `b5` is the single **expanded / "outside"** note, used only by the VII-as-major
  chord (§3). Flagged `outside:true` wherever shown. Toggleable.
- Semitones 1 and 8 are never used.

`degreeLabel(semitone)` returns the label string; `isOutside(semitone)` true only for 6.

---

## 2. The number pair on every note

Each rendered note shows **two numbers side by side: `keyDeg · chordInt`**

- **keyDeg** — the note's degree in the *key* (from set above, e.g. `1 b3 5 b7`).
- **chordInt** — the note's interval above the *chord root* (`1`, `b3`/`3`, `5`, `b7`/`7`).

The chord root note reads `<keyDeg>·1`. Major vs minor is read off **chordInt** = `3` vs `b3`.
Example, chord rooted on degree 5 (a "5 chord") as a minor-7 stack: notes
`5·1`, `b7·b3`, `2·5`, `4·b7` (keyDeg · chordInt).

---

## 3. Chord model (first principles — *not* "major/minor")

A chord is a **root degree + a stack of in-key scale tones**. Roots are the scale degrees
`R = {1,2,3,4,5,6}` (semitone offsets `{0,2,4,5,7,9}`). The 7 is **not** a stack root (the diminished
is dropped) *except* the special VII-as-major below.

For each root `r`, the candidate intervals above the root, kept only if the resulting **key** pitch
class lands in set `S`:

| slot   | intervals (semis above root) | notes |
|--------|------------------------------|-------|
| root   | 0                            | **never dropped** |
| third  | +3 (b3) and/or +4 (3)        | the **b3↔3 pair is one articulation slot** |
| fifth  | +7                           | strongly retained (only ever dropped as last resort) |
| seventh| +10 (b7) and/or +11 (7)      | 4-note only; the **b7↔7 pair is an articulation slot** |

Both members of a slot are kept when both land in `S`. Having both b3 **and** 3 (or b7 **and** 7)
available adjacent on a string is precisely the hammer-on / pull-off / slide / bend opportunity that
defines blues/country/rock phrasing — see §5.

**Three-note chord (default):** `root + third + fifth` → on three strings, one note per string.
The chosen third may be b3 or 3; the *other* third (if in `S`) is recorded as an articulation target.

**Four-note idea (toggle), still only 3 strings → drop exactly one:** stack
`root + third + fifth + seventh` (4 pitch classes) and drop one by these rules, in order:
1. **never** drop the root,
2. prefer **not** to drop the fifth,
3. **drop the third** → resulting 3-string voicing = `root + fifth + seventh`.
The dropped third becomes an articulation target (hammer the 3rd back in).

**VII-as-major (special, toggle):** a major triad rooted on degree **7** = `{7, b3, b5}` where `b5`
(semitone 6) is the one **outside** note. This is the "major of the diminished" move. Low default
weight; flagged outside.

Inversions are **fully allowed** — any of a chord's pitch classes may be the lowest-sounding note.

---

## 4. Voicings on the neck

Standard tuning, six strings. Open-string pitch classes (low→high E A D G B E):
`[4, 9, 2, 7, 11, 4]` (these are absolute PCs; engine works in key-relative PCs by subtracting the key
root, but geometry is key-independent). Three-note chords use **three adjacent strings** → string sets
(high-to-low index naming `1=high E … 6=low E`): `{1,2,3} {2,3,4} {3,4,5} {4,5,6}`.

For a chord's three pitch classes, search every adjacent string set and every assignment of the PCs to
the three strings (inversions included) for fret positions where:
- one note per string,
- **all notes within a 4-fret window** (`spread = maxFret − minFret ≤ 3`, i.e. spans ≤ 4 frets),
- frets reachable (fingerability score, §5).

Because the neck is infinite/periodic, fret numbers are **relative** (mod-12 family); the UI tiles a
voicing every 12 frets. A `Voicing`:

```
{
  id, chordId, rootDegree, stringSet:[hi,mid,lo],
  notes:[ { stringIdx, fretRel, pc, keyDeg, chordInt, isRoot, outside } x3 ],
  spread,            // 0..3
  barre,             // false | fretRel  (≥2 notes share lowest fret => index barre)
  fingerScore,       // 0..1, higher = easier
  commonness         // 0..1 prior (function + shape), see §7
}
```

---

## 5. Articulations

**Within a voicing** (one string, chord stays put): if a note has its slot-partner a half/whole step
away on the **same string** within reach — `b3↔3` (1 fret) or `b7↔7` (1 fret), also `4→3`/bend cases —
emit an articulation:
- `hammer` (ascending, e.g. b3→3 up), `pull` (descending 3→b3), `slide` (either), `bend`.
- carries `{ type, fromNote, toNote, direction:'up'|'down', within:true }`.

**Between two chords on the SAME three strings** (a transition): compare the two voicings note-by-note
on each string. Strings that **don't move** = pivots (often the index **barre** is held). Strings that
move by **1–2 frets** are the articulation:
- 1 fret = hammer-on / pull-off; 1–2 frets = slide; bend where idiomatic.
- **Direction**: `up` (hammer/slide toward higher fret) vs `down` (pull-off/slide down).
- **`oneDirectional`**: some moves are idiomatically one-way (leading-tone `7→1` resolves up;
  blues `b3→3` typically up; `4→3` suspension resolves down). Tagged from a rules table (§7).

**Slide-into-hammer-on** opportunity: a transition whose moving string slides into a fret from which a
*within-voicing* hammer (b3→3 / b7→7) is then available — flagged `slideIntoHammer:true`. These are the
prize moments and get a weight bonus.

A `Transition` (between consecutive chords of a progression, **same string set**):

```
{
  fromVoicingId, toVoicingId, stringSet,
  moves:[ { stringIdx, fromFret, toFret, delta } ],   // only changed strings
  pivots:[ stringIdx... ],                            // held strings (barre)
  articulation:{ type, direction },
  oneDirectional, direction, slideIntoHammer,
  spread,        // combined fret span across both voicings (cluster tightness)
  commonness
}
```

---

## 6. Progression = the unit of display (four chords)

The on-screen object is a **four-chord progression** rendered as **four fretboards left→right
(chord 1..4) with transition arrows between them**. By construction the four voicings live on the
**same three-string set** and in a tight fret neighborhood ("close together by definition").

**Each panel always renders a fixed 12-fret window** (one full octave of the relative neck, so every
pitch class appears once per string). Within that window each chord is shown in **three voicings /
inversions at different positions up the neck**, each with its **articulation opportunities labeled**
(within-voicing b3↔3 / b7↔7 marks). Voicings are **always exactly three strings** (three adjacent
strings, one note per string). **Only *connected* positions are displayed**: a voicing is shown only
if it participates in a valid same-three-string-set transition to a displayed voicing of the adjacent
chord. Transition **arrows link the connected positions across panels**; no orphan dots. (If fewer
than three fully-connected voicings exist for a chord, show the connected ones and fill remaining
slots with the next-best positions, dimmed.)

Constraints on the chord-identity sequence `[c1,c2,c3,c4]`:
- a chord **may repeat**,
- **forbidden: A→B→A→B** (i.e. not (`c1==c3` AND `c2==c4` AND `c1!=c2`)),
- consecutive pair must have a valid same-string-set transition (§5).

```
Progression {
  chords:[c1..c4], voicings:[v1..v4], transitions:[t12,t23,t34],
  stringSet, fretWindow:{min,max},
  commonness   // product/!blend of chord priors + transition priors + bonuses
}
```

Progressions are **generated at shuffle time** by a seeded weighted random walk over voicings whose
transitions exist on a shared string set — *not* pre-enumerated — keeping the engine small and the
output reproducible.

---

## 7. Commonness weights (drives the chaos slider)

Folk/rock/blues/country priors (data tables in engine, refined by research worker):
- **Chord function**: degrees `1,4,5,6` high; `2,3` lower; VII-as-major low/characteristic.
- **Common moves** (transition prior, with typical direction): `1→4 4→1 1→5 5→1 4→5 5→4 6→4 4→6 1→6
  6→1 5→6(deceptive, one-way) 6→5`. Cadential `5→1` strong; `4→1` plagal; blues `1→4→1→5` family.
- **Shape bonuses**: low spread, index-barre available, slide-into-hammer present, within-voicing
  b3↔3 / b7↔7 present.
- **One-directional flags**: `5→6` deceptive, `7→1` resolve-up, susp `4→3` resolve-down, blues `b3→3`
  up — encoded in a small directionality table.

`commonness ∈ [0,1]` per voicing / transition / progression (normalized blend).

**Chaos slider** `chaos ∈ [0,1]` shapes the seeded draw distribution:
`p_i ∝ commonness_i^(1 − chaos)` then normalize → `chaos=0` heavily favors the most common
(true-to-life distribution), `chaos=1` is flat/uniform over the whole database. Draw uses a **seeded
PRNG (mulberry32)** so every shuffle is reproducible and testable; the seed is visible/derived from a
shuffle counter.

---

## 8. Engine API (the integration contract — UI builds against this)

Global `Fretboard` (pure, no DOM):

```
Fretboard.TUNING            // [4,9,2,7,11,4]
Fretboard.degreeLabel(semi) -> string
Fretboard.isOutside(semi)   -> bool
Fretboard.build(opts) -> Database
   opts = { fourNote:false, viiMajor:false, expanded:false }
   Database = { chords[], voicings[], transitions[], meta }
Fretboard.progression(db, { chaos, seed }) -> Progression        // one 4-chord pick, deterministic
Fretboard.shuffle(db, { chaos, seed, n }) -> Progression[]       // n independent picks (n usually 1)
Fretboard.label(note, key) -> { pair:[keyDeg, chordInt], outside }
```

Determinism guarantee: `build(opts)` and any `(seed,chaos)` draw are pure functions — identical inputs
→ byte-identical output (basis of regression snapshots).

---

## 9. UI / UX

- **Layout**: four fretboard panels in a frame, left→right = chords 1..4, with transition **arrows**
  between panels (moving notes drawn as arrows colored by articulation type, arrowhead = direction;
  pivot/barre strings dimmed/held).
- **Fretboard**: strings run **vertically**; frets are horizontal; **no fret numbers** (relative).
  Each panel shows the shared fret neighborhood. Vertical scroll moves along the neck **one fret at a
  time, smooth, infinite** (12-fret periodic) — panels scroll in sync; voicings re-tile so the active
  cluster stays in frame.
- **Notes**: filled dot per note with the `keyDeg·chordInt` pair; root emphasized (ring); outside note
  marked (dashed/amber). Within-voicing articulation shown as a small same-string arc/arrow.
- **Controls (minimal, "less is more", no tutorial)**:
  - **Shuffle** button → new progression (increments seed).
  - **Chaos** slider 0–1.
  - **3-note / 4-note** toggle.
  - **VII-major / expanded** toggle.
  - **Key** selector (relabels only; default off/relative).
- **Aesthetic**: dark, slick, vibey — deep background, subtle gradients, soft glow on active notes,
  smooth 60fps scroll & transitions. Canvas or SVG; deterministic layout.

---

## 10. Testing (deterministic; Claude runs smoke + regression)

- **Unit (Node, no deps, `node --test` or a tiny inline runner)**: degreeLabel map; chord stacks per
  root (correct slots, in-key filter, VII-major outside note); 4-note drop = drops third, keeps
  root+5+7; voicing search invariants (3 adjacent strings, spread ≤ 3, one note/string, key-only +
  allowed outside); articulation detection (b3↔3, b7↔7, directions, slideIntoHammer); progression
  constraints (4 chords, no ABAB, valid same-set transitions); weighting + **seeded shuffle
  reproducibility** (same seed→same pick; chaos=0 favors high commonness, chaos=1 ≈ uniform via
  chi-square tolerance).
- **Regression**: snapshot `build()` full DB + a fixed `(seed,chaos)` progression sample to JSON in
  `test/__snapshots__/`; test fails on any drift.
- **Claude smoke (Chrome)**: load `index.html`, assert render, no console errors, scroll one fret,
  Shuffle changes the progression, 4-note toggle adds sevenths, screenshot for visual sanity.

---

## 11. Build & deploy

- Source in `src/` (engine.js, ui.js, styles.css, app bootstrap) + a build step that **inlines**
  everything into a single dependency-free `index.html`.
- Tests in `test/`. CI-style local: `node test/run.mjs` (deterministic, exit non-zero on fail).
- **GitHub Pages**: push, enable Pages on branch/docs, live URL.
- **Cloudflare Pages**: deploy same `index.html` (needs CF credentials from user — `wrangler` or API
  token / account id).
