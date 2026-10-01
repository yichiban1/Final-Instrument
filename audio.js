/**
 * Rolling — Sound Engine, "The Looper".
 * The box samples the player: every musical event you cause — the roll's
 * chord call, each locked-die strum, the payout run — is recorded onto a
 * loop of tape and played back under the live action. Your moves become
 * the backing track; every hand records the accompaniment for the next.
 */
const Sound = (() => {
  let on = false, box, master, rev, mem, hatGain, bp;

  // ========================================
  // Scale & Chord Mapping
  // ========================================
  /*
   * Die faces 1..6 are notes of G major pentatonic, so any roll is
   * already consonant. Chords are built as scale degrees from a root —
   * a pair is a bare fifth, a triple a triad, a full house a thick
   * stack, straights run the scale — and the root follows the most
   * repeated die, so a pair of 4s literally re-keys the bed onto D.
   * Rarer hand, bigger chord: the payoff table has a harmonic shadow.
   */
  const PENT = [67, 69, 71, 74, 76, 79];           /* G4 A4 B4 D5 E5 G5 */
  const N = m => Tone.Frequency(m, 'midi').toNote();
  /* the pentatonic laid out over two octaves — chords are built as scale degrees
     from a root, so every voicing stays inside the key no matter what it roots on */
  const LAD = [55, 57, 59, 62, 64, 67, 69, 71, 74, 76, 79, 81, 83, 86, 88, 91];
  const deg = (root, k) => LAD[Math.max(0, Math.min(LAD.length - 1, LAD.indexOf(root) + k))];
  /* chord shape per hand type, in degrees above the root: loose dice are a
     searching fourth, a pair an open fifth, triples a triad, straights run the
     scale, and the rare hands stack up thick */
  const SHAPES = {
    loose:    [0, 3],
    pair:     [0, 4],
    twoPair:  [0, 3, 4],
    three:    [0, 2, 4],
    str:      [0, 1, 2, 3, 4],
    threeStr: [0, 1, 2, 3, 4, 6],
    full:     [0, 2, 4, 5],
    four:     [0, 2, 4, 6],
    five:     [0, 2, 4, 5, 6],
  };
  let chord = { root: 67, tones: [67, 74] };       /* the harmony the table is lying in */
  let motif = [67, 74, 71];                        /* the figure of the current table */
  let land = 79;                                   /* root of the last hand played — where multHit lands */
  /* the tape: events the player caused, replayed as the accompaniment */
  const LOOP_LEN = 4.5;                            /* seconds of tape — short enough to feel alive */
  let take = [], loopStart = 0;
  function record(midi, vel) {                     /* commit a sound to the tape, at its own timing */
    take.push({ at: (Tone.now() - loopStart) % LOOP_LEN, midi, vel: vel * 0.7 });
    if (take.length > 24) take.shift();
  }

  /* the table's harmony: straights root on their low end, everything else roots
     on the most repeated die — a pair of 4s literally re-keys the bed onto D */
  function harmony(vals, key) {
    const shape = SHAPES[key] || SHAPES.loose;
    let rv = vals[0];
    if (key === 'str' || key === 'threeStr') rv = Math.min(...vals);
    else {
      const cnt = {}; vals.forEach(v => cnt[v] = (cnt[v] || 0) + 1);
      let best = 0;
      Object.keys(cnt).forEach(v => {
        if (cnt[v] > best || (cnt[v] === best && +v > +rv)) { best = cnt[v]; rv = +v; }
      });
    }
    const root = PENT[rv - 1];
    return { root, tones: shape.map(k => deg(root, k)) };
  }
  /* the fallback figure, drawn from the chord — order flips with every roll */
  function boardMotif() {
    const t = chord.tones;
    if (t.length < 3) return (t[0] + t[1]) % 2 ? [t[0], t[1], t[0] + 12] : [t[1], t[0], t[1] + 12];
    const flip = (t[0] + t[t.length - 1]) % 2;
    return flip ? [t[0], t[t.length - 1], t[Math.floor(t.length / 2)]]
                : [t[0], t[Math.floor(t.length / 2)], t[t.length - 1]];
  }

  // ========================================
  // One Instrument
  // ========================================
  /*
   * Everything is played on a single music box: soft sine plucks through
   * a short reverb. Bass, chords, melody and punctuation are just
   * registers of that one voice. One timbre keeps the whole game sounding
   * like a single object speaking, rather than an orchestra of unrelated
   * sound effects competing for attention.
   */
  async function init() {
    if (on) return;
    await Tone.start();
    master = new Tone.Volume(-4).toDestination();
    rev = new Tone.Reverb({ decay: 1.3, wet: 0.1 }).connect(master);
    try { rev.generate(); } catch (e) { /* reverb fills in when ready */ }
    /* the one instrument: kalimba-ish sine plucks */
    box = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'sine' },
      envelope: { attack: 0.002, decay: 0.45, sustain: 0, release: 0.35 },
    }).connect(rev);
    box.volume.value = -8;
    mem = new Tone.MembraneSynth({ envelope: { attack: 0.001, decay: 0.15, sustain: 0 } }).connect(master);
    mem.volume.value = -10;
    /* shared noise channel for rattle / tick effects */
    const noise = new Tone.Noise('pink').start();
    hatGain = new Tone.Gain(0); bp = new Tone.Filter(1600, 'bandpass');
    noise.connect(hatGain); hatGain.connect(bp); bp.connect(master);

    // ========================================
    // The Tape
    // ========================================
    /*
     * One loop of the player's own making, spinning under the live
     * action. A new roll wipes the take — every hand records the
     * accompaniment for the next one. Even when the player goes quiet,
     * the last take keeps spinning: sparse input still gets a
     * soundtrack, and it is always their own.
     */
    new Tone.Loop(t => {
      loopStart = t;
      take.forEach(e => box.triggerAttackRelease(N(e.midi), 0.3, t + e.at, e.vel));
    }, LOOP_LEN).start(0);
    Tone.Transport.start();
    on = true;
  }

  // ========================================
  // Feeding the Box
  // ========================================
  /*
   * The game calls in after every event, and everything the box says is
   * recorded to the tape: a roll announces its new chord and starts a
   * fresh take, two or more locked dice rewrite the figure. The player
   * stays the composer — the tape is nothing but their own performance,
   * played back.
   */
  function setBed(vals, key) {     /* after every roll: announce the chord, wipe the tape, start a new take */
    chord = harmony(vals, key);
    motif = boardMotif();
    take = [];
    if (!on) return;
    const t = Tone.now() + 0.02;
    box.triggerAttackRelease(N(chord.root - 12), 0.4, t, 0.2);   /* say the new chord out loud */
    record(chord.root - 12, 0.2);
    chord.tones.forEach((m, i) => {
      box.triggerAttackRelease(N(m), 0.3, t + 0.09 + i * 0.07, 0.15);
      record(m, 0.15);
    });
  }
  function setLocks(vals) {        /* two or more selected dice rewrite the figure */
    const lk = vals.map(v => PENT[v - 1]).sort((a, b) => a - b);
    if (lk.length >= 2) motif = lk.slice(0, 3);
  }

  // ========================================
  // Picking Is Playing
  // ========================================
  /*
   * Selecting a die strums the whole hand as a quick ascending riff —
   * the player hears what they just did, like strumming a chord.
   * Releasing a die drops its note an octave down, and the moment a
   * selection becomes a valid hand, a small fifth flicks upward.
   */
  function pick(v, vals) {     /* selected: the whole selection rolls out as a quick ascending riff —
                                  the player hears what they just played, like strumming a chord */
    if (!on) return;
    const t = Tone.now();
    const ns = (vals && vals.length ? vals : [v]).map(x => PENT[x - 1]).sort((a, b) => a - b);
    ns.forEach((m, i) => {
      box.triggerAttackRelease(N(m), 0.18, t + i * 0.06, 0.24);
      record(m, 0.24);
    });
  }
  function unpick(v) {         /* released: softer, an octave down */
    if (!on) return;
    box.triggerAttackRelease(N(PENT[v - 1] - 12), 0.1, Tone.now(), 0.12);
  }
  function confirm() {
    if (!on) return; const t = Tone.now();
    box.triggerAttackRelease(N(74), 0.2, t, 0.16);
    box.triggerAttackRelease(N(81), 0.25, t + 0.06, 0.14);
    record(74, 0.16); record(81, 0.14);
  }
  function invalid() { if (on) tick(500, 0.12, undefined, 0.08); }

  // ========================================
  // The Payout
  // ========================================
  /*
   * The played dice run low to high and end on the hand's own root — a
   * resolution to wherever the dice pointed. The score's climb ticks
   * upward through the scale, the multiplier lands on root and fifth
   * with a thump, and afterwards the bed answers with the figure an
   * octave up: a small call-and-response between gambler and instrument.
   */
  function handNotes(vals, key) {  /* played dice, low to high, ending on the hand's own root */
    if (!on) return;
    const h = harmony(vals, key);
    land = h.root;
    const t0 = Tone.now() + 0.03;
    [...vals].sort((a, b) => a - b).forEach((v, i) => {
      box.triggerAttackRelease(N(PENT[v - 1]), 0.2, t0 + i * 0.07, 0.34);
      record(PENT[v - 1], 0.34);
    });
    box.triggerAttackRelease(N(h.root + 12), 0.25, t0 + vals.length * 0.07, 0.3);
    record(h.root + 12, 0.3);
  }
  function countTick(i) {      /* score climbing: the run rises with the number */
    if (!on) return;
    const m = PENT[i % 6] + 12 * Math.min(2, Math.floor(i / 6));
    box.triggerAttackRelease(N(m), 0.1, Tone.now(), 0.2);
    record(m, 0.2);
  }
  function multHit() {         /* the multiplier lands on the hand's root and its fifth */
    if (!on) return; const t = Tone.now();
    box.triggerAttackRelease(N(land + 12), 0.2, t, 0.32);
    box.triggerAttackRelease(N(Math.min(deg(land, 4) + 12, 96)), 0.35, t + 0.06, 0.3);
    record(land + 12, 0.32);
    record(Math.min(deg(land, 4) + 12, 96), 0.3);
    mem.triggerAttackRelease('G2', 0.06, t, 0.7);
  }
  function respond() {         /* after a hand banks, the bed answers with the figure, up an octave */
    if (!on) return;
    const t0 = Tone.now() + 0.3;
    motif.forEach((m, i) => box.triggerAttackRelease(N(m + 12), 0.2, t0 + i * 0.09, 0.16));
  }

  // ========================================
  // Endings
  // ========================================
  /* A win is a rising run, like a payout; a loss is a short fall —
     collapse, but never sludge. Both stay in the box's one voice. */
  function winChord() {        /* rising run, like a payout */
    if (!on) return; const t = Tone.now() + 0.04;
    [67, 71, 74, 79, 83, 86].forEach((m, i) => box.triggerAttackRelease(N(m), 0.25, t + i * 0.07, 0.26));
    box.triggerAttackRelease(N(91), 0.6, t + 0.45, 0.22);
  }
  function loseFall() {        /* falling plucks — collapse, not sludge */
    if (!on) return; const t = Tone.now();
    [79, 76, 71, 67].forEach((m, i) => box.triggerAttackRelease(N(m), 0.25, t + i * 0.12, 0.28));
  }

  // ========================================
  // The Bones
  // ========================================
  /*
   * Underneath the music, the dice must feel like objects: filtered
   * noise ticks follow the shake's three accelerating tiers and land on
   * a thump when the dice settle. Physicality first — these sounds are
   * what make the gamble feel held in the hand rather than read off a
   * screen.
   */
  function tick(freq = 2200, vel = 0.4, t, dur = 0.05) {
    if (!on) return;
    t = t ?? Tone.now();
    bp.frequency.setValueAtTime(freq, t);
    hatGain.gain.cancelScheduledValues(t);
    hatGain.gain.setValueAtTime(0, t);
    hatGain.gain.linearRampToValueAtTime(vel * 0.5, t + 0.004);
    hatGain.gain.exponentialRampToValueAtTime(0.001, t + dur);
  }
  const thump = (t, v = 0.7) => { if (on) mem.triggerAttackRelease('G1', 0.04, t ?? Tone.now(), v); };
  function rollRattle(d = 0.8) {
    if (!on) return;
    const t0 = Tone.now(); let t = 0, s = 0.05;
    while (t < d) { tick(1400 + Math.random() * 1600, 0.25 + Math.random() * 0.2, t0 + t, 0.04); t += s; s *= 1.14; }
    tick(2600, 0.5, t0 + d); thump(t0 + d, 0.5);
  }

  const mute = m => { if (on) master.mute = m; };
  return { init, setBed, setLocks, pick, unpick, confirm, invalid,
           handNotes, countTick, multHit, respond, winChord, loseFall,
           rollRattle, tick, mute };
})();
