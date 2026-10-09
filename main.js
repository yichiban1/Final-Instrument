/**
 * Rolling — a dice poker in the spirit of Balatro.
 * Roll six dice, lock some into a poker hand, and gamble the rest:
 * every hand banks chips × mult toward a target that rises each round.
 */
(() => {
const $ = id => document.getElementById(id);
const els = {
  table: $('table'), dice: $('diceMount'), stamp: $('stampLayer'),
  msg: $('msg'), score: $('scoreEl'), target: $('targetEl'),
  hands: $('handsEl'), rerolls: $('rerollsEl'), round: $('roundEl'),
  pName: $('pName'), pMath: $('pMath'), playBtn: $('playBtn'), prog: $('progFill'),
  tape: $('tape'),
  comboList: $('comboList'), end: $('end'), endName: $('endName'),
  endStats: $('endStats'), help: $('help'), endBest: $('endBest'),
};
const stageEl = document.querySelector('.stage');

// ========================================
// The Economy
// ========================================
/*
 * The whole game runs on a small budget: four hands and three shakes per
 * round. Every hand is therefore a question — bank the safe pair now, or
 * spend a shake fishing for the triples and straights that actually pay?
 * The targets are tuned so that settling for pairs loses by a breath: the
 * gamble is not optional, it is the price of admission. Pairs are grind
 * money; the big multipliers on rare hands are what the shaking is for.
 */
const ROUNDS = [400, 1100, 2200];   /* target score per round — each round must out-gamble the last */
const HANDS = 4;                    /* plays per round */
const SHAKES = 3;                   /* rerolls per round */
const PIP_CHIPS = 5;                /* chips per pip */
const TYPES = {
  five:      { name: 'five of a kind', base: 100, mult: 10, desc: 'five dice, one face — the jackpot rattle' },
  threeStr:  { name: 'big straight',   base: 60,  mult: 6,  desc: 'five steps in a row: 1-2-3-4-5 or 2-3-4-5-6' },
  four:      { name: 'four',           base: 50,  mult: 7,  desc: 'four of a face, one stray' },
  full:      { name: 'full house',     base: 40,  mult: 5,  desc: 'three of one face, two of another' },
  str:       { name: 'small straight', base: 30,  mult: 4,  desc: 'four steps in a row' },
  three:     { name: 'three',          base: 30,  mult: 3,  desc: 'three of a face' },
  twoPair:   { name: 'two pair',       base: 20,  mult: 2,  desc: 'two pairs — one step from a full house' },
  pair:      { name: 'pair',           base: 10,  mult: 2,  desc: 'two of a face — the everyday hand' },
  high:      { name: 'high die',       base: 5,   mult: 1,  desc: 'nothing pairs; the top pip speaks alone' },
};
const TYPE_ORDER = ['five', 'four', 'threeStr', 'full', 'str', 'three', 'twoPair', 'pair', 'high'];

// ========================================
// The Table
// ========================================
/*
 * Six dice, built by hand:
 * each die is a 3×3 pip grid over a rounded face with a soft shadow.
 * A face is set with data-v, and the CSS lights the right pips for that
 * value. Nothing here knows about scoring — the dice are honest physical
 * objects, and the game simply reads them when it needs to.
 */
const rnd = () => 1 + Math.random() * 6 | 0;   /* 1..6 — |0 truncates, so the +1 has to come first */
let S = null, hold = null, timers = [], counting = false;
const later = (fn, ms) => {   /* pending timeouts, cleared on restart */
  const id = setTimeout(() => { timers = timers.filter(t => t !== id); fn(); }, ms);
  timers.push(id);
};
const dice = [];
for (let i = 0; i < 6; i++) {
  const w = document.createElement('div'); w.className = 'die-wrap';
  const d = document.createElement('div'); d.className = 'die'; d.dataset.v = 1;
  for (let p = 0; p < 9; p++) d.appendChild(document.createElement('span')).className = 'pip';
  const sh = document.createElement('div'); sh.className = 'shadow';
  w.appendChild(d); w.appendChild(sh); els.dice.appendChild(w);
  d.addEventListener('click', () => toggleSelect(i));
  dice.push({ w, d });
}
/*
 * The glossary:
 * one row per hand, always visible but quiet — a reminder of what exists,
 * not a hint about what you have. Descriptions only surface when a row is
 * hovered or played; reading the dice remains the player's job.
 */
TYPE_ORDER.forEach(k => {
  const t = TYPES[k], row = document.createElement('div');
  row.className = 'crow'; row.dataset.t = k;
  row.innerHTML = '<div class="crow-top"><span class="cname">' + t.name + '</span><span class="cmath">' + t.base + ' × ' + t.mult + '</span></div>' +
                  '<span class="cdesc">' + t.desc + '</span>';
  els.comboList.appendChild(row);
});

// ========================================
// Rendering
// ========================================
function renderMeta() {
  els.score.textContent = S.score;
  els.target.textContent = '/ ' + S.target;
  els.hands.textContent = S.hands;
  els.rerolls.textContent = S.shakes;
  els.round.textContent = (S.round + 1) + '/' + ROUNDS.length;
  els.playBtn.disabled = !currentCombo();
  updateProgress();
}
function updateProgress() {
  els.prog.style.width = Math.min(100, S.score / S.target * 100) + '%';
}
function renderPreview() {
  const c = currentCombo();
  document.querySelectorAll('.crow').forEach(r => {
    r.classList.toggle('on', !!c && c.key === r.dataset.t);
  });
  if (!c) {
    els.pName.textContent = '—';
    els.pMath.textContent = '';
    return;
  }
  const { chips, mult } = scoreBreakdown(c);
  els.pName.textContent = TYPES[c.key].name;
  els.pMath.textContent = chips + ' × ' + mult;
}
const msg = t => els.msg.textContent = t;

/* one-shot fx helpers: JS only toggles classes, the animations live in CSS */
function fxValidHand() {   /* first lock that completes a hand: name pops, row pulses, PLAY arms */
  els.pName.classList.remove('pop'); void els.pName.offsetWidth; els.pName.classList.add('pop');
  later(() => els.pName.classList.remove('pop'), 350);
  const row = document.querySelector('.crow.on');
  if (row) { row.classList.add('pulse'); later(() => row.classList.remove('pulse'), 480); }
  els.playBtn.classList.add('armed');
  later(() => els.playBtn.classList.remove('armed'), 460);
}
function fxClear() {   /* strip every one-shot feedback class */
  stageEl.classList.remove('fx-low', 'fx-med', 'fx-high', 'impact');
  document.querySelectorAll('.pop, .pulse, .armed, .bump, .flash, .punch, .chip-hit').forEach(el =>
    el.classList.remove('pop', 'pulse', 'armed', 'bump', 'flash', 'punch', 'chip-hit'));
  dice.forEach(({ d }) => d.classList.remove('fired', 'non-scoring'));
}
const tapeSlots = document.querySelectorAll('#tapeSlots .tslot');
function renderTape() {   /* Read committed memory only; position 01 is newest. */
  let n;
  try { n = Sound.getMemoryCount(); } catch (e) { return; }
  tapeSlots.forEach((s, i) => s.className = 'tslot' + (i < n ? ' on t' + (i + 1) : ''));
  els.tape.classList.toggle('live', n > 0);
  els.tape.setAttribute('aria-label', 'Tape memory: ' + n + ' of 3 positions filled');
}
function stamp(text, cls = '') {
  const s = document.createElement('div');
  s.className = 'stamp ' + cls; s.textContent = text;
  els.stamp.appendChild(s);
  later(() => s.remove(), 1100);
}

// ========================================
// Hand Detection
// ========================================
/* Strongest hand first; equal patterns prefer more pips, then earlier dice. */
function detect(vals, indices = vals.map((_, i) => i)) {
  if (!vals.length) return null;
  const groups = new Map();
  vals.forEach((value, i) => {
    if (!groups.has(value)) groups.set(value, []);
    groups.get(value).push({ value, index: indices[i] });
  });
  const faces = [...groups.keys()].sort((a, b) => b - a);
  const result = (key, members) => {
    const ordered = [...members].sort((a, b) => a.index - b.index);
    return { key, scoringIndices: ordered.map(d => d.index),
             scoringValues: ordered.map(d => d.value), sum: ordered.reduce((sum, d) => sum + d.value, 0) };
  };
  const matching = len => faces.find(v => groups.get(v).length >= len);
  const straight = len => {
    for (const high of faces) {
      const run = Array.from({ length: len }, (_, i) => high - len + 1 + i);
      if (run.every(v => groups.has(v))) return run.map(v => groups.get(v)[0]);
    }
    return null;
  };
  const five = matching(5), four = matching(4), three = matching(3);
  if (five !== undefined) return result('five', groups.get(five).slice(0, 5));
  if (four !== undefined) return result('four', groups.get(four).slice(0, 4));
  let full = null, fullSum = -1;
  faces.filter(v => groups.get(v).length >= 3).forEach(triple => {
    faces.filter(v => v !== triple && groups.get(v).length >= 2).forEach(pair => {
      const sum = triple * 3 + pair * 2;
      if (sum > fullSum) {
        fullSum = sum;
        full = [...groups.get(triple).slice(0, 3), ...groups.get(pair).slice(0, 2)];
      }
    });
  });
  if (full) return result('full', full);
  const bigRun = straight(5), smallRun = straight(4);
  if (bigRun) return result('threeStr', bigRun);
  if (smallRun) return result('str', smallRun);
  if (three !== undefined) return result('three', groups.get(three).slice(0, 3));
  const pairs = faces.filter(v => groups.get(v).length >= 2);
  if (pairs.length >= 2) return result('twoPair', pairs.slice(0, 2).flatMap(v => groups.get(v).slice(0, 2)));
  if (pairs.length) return result('pair', groups.get(pairs[0]).slice(0, 2));
  return result('high', groups.get(faces[0]).slice(0, 1));
}
const selected = () => dice.map((_, i) => S.d[i]).filter(v => v !== null);
function currentCombo() {
  const indices = S.d.map((v, i) => v !== null ? i : -1).filter(i => i >= 0);
  return detect(indices.map(i => S.d[i]), indices);
}
function scoreBreakdown(c) {
  const { base, mult } = TYPES[c.key];
  const contributions = c.scoringIndices.map((index, i) => ({ index, chips: c.scoringValues[i] * PIP_CHIPS }));
  const chips = base + contributions.reduce((sum, d) => sum + d.chips, 0);
  return { base, mult, contributions, chips, gain: chips * mult };
}

// ========================================
// Selection Is Performance
// ========================================
/*
 * Locking a die strums every die you hold; two or more locks rewrite the
 * music box's tune. The gamble has a sound — what you keep becomes the
 * melody, what you shake becomes the next bar. Audio calls are wrapped
 * and swallowed: a broken speaker must never be able to break the game.
 */
function toggleSelect(i) {
  if (!S || S.rolling || counting || S.phase !== 'PLAY') return;
  const before = currentCombo();
  try {
    if (S.d[i] === null) { S.d[i] = S.vals[i]; Sound.pick(S.vals[i], selected()); }
    else { S.d[i] = null; Sound.unpick(S.vals[i]); }
    if (!before && !!currentCombo()) Sound.confirm();
    Sound.setLocks(selected());   /* locked dice take the spotlight in the bed */
  } catch (e) { /* audio must never block the game */ }
  renderDice(); renderPreview(); renderMeta();
  const after = currentCombo();
  if (after && (!before || before.key !== after.key)) fxValidHand();   /* new or upgraded hand */
}
/* die values: null = unselected, number = selected */
function renderDice() {
  dice.forEach(({ d }, i) => {
    d.dataset.v = S.vals[i];
    d.classList.toggle('sel', S.d[i] !== null);
  });
}

// ========================================
// Rolling & The Shake
// ========================================
/*
 * Holding space (or the table) rattles the loose dice in three
 * accelerating tiers, then releases them into a tumbling roll. Only
 * unselected dice reroll — that asymmetry is the whole gamble: lock what
 * you like, risk the rest. Every roll re-keys the music box to whatever
 * the new table looks like.
 */
function rollDice(which, done) {
  S.rolling = true;
  try { Sound.rollRattle(0.8); } catch (e) {}
  const idx = which;
  idx.forEach((i, k) => {
    dice[i].d.classList.remove('sel');
    dice[i].w.classList.add('rolling');
    dice[i].w.style.animationDelay = (k * 0.06) + 's';
  });
  idx.forEach(i => { later(() => S.vals[i] = rnd(), 280); later(() => S.vals[i] = rnd(), 540); });
  later(() => idx.forEach(i => {
    S.vals[i] = rnd();
    dice[i].d.classList.add('settle');
    later(() => dice[i].d.classList.remove('settle'), 260);
  }), 800);
  later(() => {
    idx.forEach(i => { dice[i].w.classList.remove('rolling'); dice[i].w.style.animationDelay = ''; });
    S.rolling = false;
    try {
      const bk = detect(S.vals);   /* the hand on the table picks the bed's chord */
      Sound.setBed(S.vals, bk ? bk.key : 'loose');
    } catch (e) {}
    if (done) done();
  }, 880);
}
function startShake() {
  if (!S || S.rolling || counting || S.phase !== 'PLAY' || hold) return;
  if (S.shakes <= 0) { msg('no shakes left — play what you hold'); return; }
  const loose = [];
  S.d.forEach((v, i) => { if (v === null) loose.push(i); });
  if (!loose.length) { msg('everything is selected — play it'); return; }
  hold = { t0: performance.now(), iv: setInterval(() => {
    const el = performance.now() - hold.t0;
    const tier = el < 260 ? 1 : el < 650 ? 2 : 3;
    loose.forEach(i => dice[i].w.className = 'die-wrap w' + tier);
    Sound.tick(1500 + Math.random() * 1400, 0.15 + tier * 0.07, undefined, 0.035);
  }, 105) };
}
function releaseShake() {
  if (!hold) return;
  clearInterval(hold.iv); hold = null;
  dice.forEach(({ w }) => w.className = 'die-wrap');
  const loose = [];
  S.d.forEach((v, i) => { if (v === null) loose.push(i); });
  if (!loose.length) return;
  S.shakes--; renderMeta();
  msg('shaking the loose dice…');
  rollDice(loose, () => { renderDice(); renderPreview(); renderMeta(); msg('select dice — or shake again'); });
}

// ========================================
// The Payout, Staged
// ========================================
/* Base chips → scoring dice → multiplier → score. All stages cancel on restart. */
els.playBtn.addEventListener('click', () => {
  if (!S || S.rolling || counting || S.phase !== 'PLAY') return;
  const c = currentCombo();
  if (!c) { Sound.invalid(); msg('select a die to play'); return; }
  playHand(c);
});

function playHand(c) {
  counting = true;
  els.playBtn.disabled = true;   /* no re-triggers while the score counts up */
  const t = TYPES[c.key];
  const { base, mult, contributions, gain } = scoreBreakdown(c);
  if (!S.best || gain > S.best.gain) S.best = { name: t.name, gain };
  dice.forEach(({ d }, i) => d.classList.toggle('non-scoring', S.d[i] !== null && !c.scoringIndices.includes(i)));
  els.pName.textContent = t.name;
  els.pMath.textContent = base + ' × ' + mult;

  const tier = t.mult >= 6 ? 'high' : t.mult >= 3 ? 'med' : 'low';   /* visual intensity tier from the multiplier */
  stageEl.classList.add('fx-' + tier, 'impact');
  later(() => stageEl.classList.remove('impact'), 420);

  try { Sound.handNotes(c.scoringValues, c.key, tier); } catch (e) { /* audio must never block the game */ }
  stamp(t.name.toUpperCase(), t.mult >= 4 ? 'gold' : '');

  let shown = base;
  contributions.forEach(({ index, chips }, k) => later(() => {
    dice[index].d.classList.add('fired');
    shown += chips;
    els.pMath.textContent = shown + ' × ' + mult;
    els.pMath.classList.remove('chip-hit'); void els.pMath.offsetWidth; els.pMath.classList.add('chip-hit');
    later(() => els.pMath.classList.remove('chip-hit'), 160);
    try { Sound.countTick(k); } catch (e) {}
  }, 180 + k * 180));
  later(() => {
    try { Sound.multHit(); } catch (e) {}
    els.pMath.classList.add('punch');
    later(() => els.pMath.classList.remove('punch'), 300);
    countScore(S.score, S.score + gain);
  }, 180 + contributions.length * 180 + 120);
}
function countScore(from, to) {
  let v = from;
  const step = () => {
    v = Math.min(to, v + Math.max(1, Math.ceil((to - from) / 22)));
    S.score = v; els.score.textContent = v; updateProgress();
    if (v >= to) {
      els.score.classList.add('bump');
      els.prog.classList.add('flash');
      later(() => { els.score.classList.remove('bump'); els.prog.classList.remove('flash'); }, 400);
      counting = false;
      afterPlay();
    } else later(step, 40);
  };
  later(step, 40);
}
function afterPlay() {
  try { Sound.commitTake(); } catch (e) {}   /* settlement done — bank the take */
  renderTape();
  try { Sound.respond(); } catch (e) {}   /* the bed answers the hand that just banked */
  S.hands--; renderMeta();
  dice.forEach(({ d }) => d.classList.remove('fired', 'non-scoring'));
  els.pMath.classList.remove('chip-hit', 'punch');
  els.pName.textContent = '—'; els.pMath.textContent = '';
  document.querySelectorAll('.crow').forEach(r => r.classList.remove('on'));
  stageEl.classList.remove('fx-low', 'fx-med', 'fx-high');
  if (S.score >= S.target) { roundClear(); return; }
  if (S.hands <= 0) { gameOver(false); return; }
  nextHand();
}
function nextHand() {
  S.d = [null, null, null, null, null, null];
  S.phase = 'ROLL';
  try { Sound.setLocks([]); } catch (e) {}   /* fresh hand, empty spotlight */
  msg('fresh dice —');
  rollDice([0, 1, 2, 3, 4, 5], () => {
    S.phase = 'PLAY';
    renderDice(); renderPreview(); renderMeta();
    msg('select dice to form a hand — hold to shake the rest');
  });
}

// ========================================
// Rounds & Endings
// ========================================
/*
 * Three targets, each steeper than the last. Clear one and the table
 * "warms up" for the next; run out of hands and the run ends on the end
 * card — score, round, and the best hand of the run. Winning all three
 * is a "clean sweep"; falling short is a "short stack".
 */
function newGame() {
  timers.forEach(clearTimeout); timers = [];
  counting = false;
  if (hold) { clearInterval(hold.iv); hold = null; }
  S = { phase: 'ROLL', round: 0, target: ROUNDS[0], score: 0, hands: HANDS,
        shakes: SHAKES, d: [null, null, null, null, null, null],
        vals: [1, 2, 3, 4, 5, 6], rolling: false, best: null };
  els.end.classList.remove('show');
  els.endBest.textContent = '';
  els.stamp.innerHTML = '';
  fxClear();
  dice.forEach(({ d, w }) => {
    d.classList.remove('sel', 'fired', 'non-scoring', 'settle');
    w.className = 'die-wrap'; w.style.animationDelay = '';
  });
  try { Sound.resetMemory(); } catch (e) {}   /* new run, blank tape */
  renderTape();
  renderMeta(); renderPreview();
  nextHand();
}
function roundClear() {
  S.phase = 'BETWEEN';
  try { Sound.winChord(); } catch (e) {}
  if (S.round >= ROUNDS.length - 1) { gameOver(true); return; }
  stamp('ROUND CLEAR', 'gold');
  msg('the table warms up — next target coming');
  later(() => {
    S.round++;
    S.target = ROUNDS[S.round];
    S.hands = HANDS; S.shakes = SHAKES;
    renderMeta();
    nextHand();
  }, 1600);
}
function gameOver(won) {
  S.phase = 'OVER';
  try { if (won) Sound.winChord(); else Sound.loseFall(); } catch (e) {}
  els.endName.textContent = won ? '\u201Cclean sweep\u201D' : '\u201Cshort stack\u201D';
  els.endStats.textContent = 'score ' + S.score + ' / ' + S.target + ' · round ' + (S.round + 1) + ' of ' + ROUNDS.length;
  els.endBest.innerHTML = 'best hand — <span>' + S.best.name + ' · ' + S.best.gain + '</span>';
  later(() => els.end.classList.add('show'), won ? 900 : 1200);
}

// ========================================
// Input
// ========================================
/*
 * Mouse, touch and keyboard all speak the same language: 1-6 are the
 * piano keys for locking dice, space is the shake, enter plays, ? opens
 * the music box's own notes. The sound toggle remembers itself in
 * localStorage, and the audio engine wakes on the first gesture, as
 * browsers require — the remembered mute lands as soon as it exists.
 */
els.table.addEventListener('pointerdown', e => {
  if (e.target.closest('.hud, .die, button, .combos, .end, a')) return;
  startShake();
});
window.addEventListener('pointerup', releaseShake);
window.addEventListener('pointercancel', releaseShake);
const KEY_DIE = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3, Digit5: 4, Digit6: 5,
                  Numpad1: 0, Numpad2: 1, Numpad3: 2, Numpad4: 3, Numpad5: 4, Numpad6: 5 };
window.addEventListener('keydown', e => {
  if (e.code === 'Space' && !e.repeat) { e.preventDefault(); startShake(); }
  if ((e.code === 'Enter' || e.code === 'NumpadEnter') && !els.playBtn.disabled) els.playBtn.click();
  if (KEY_DIE[e.code] !== undefined && !e.repeat) toggleSelect(KEY_DIE[e.code]);
  if (e.key === '?' && !e.repeat) els.help.classList.toggle('show');
  if (e.code === 'Escape') els.help.classList.remove('show');
});
window.addEventListener('keyup', e => { if (e.code === 'Space') releaseShake(); });

$('helpBtn').addEventListener('click', () => els.help.classList.toggle('show'));
$('helpClose').addEventListener('click', () => els.help.classList.remove('show'));

const muteBtn = $('muteBtn');
muteBtn.textContent = localStorage.getItem('rolling-sound') === 'off' ? 'sound off' : 'sound on';
muteBtn.addEventListener('click', () => {
  const m = muteBtn.textContent === 'sound on';
  Sound.mute(m);
  localStorage.setItem('rolling-sound', m ? 'off' : 'on');
  muteBtn.textContent = m ? 'sound off' : 'sound on';
});
const wake = () => { Sound.init().then(() => Sound.mute(muteBtn.textContent === 'sound off')).catch(() => {}); };
window.addEventListener('pointerdown', wake, { once: true });
window.addEventListener('keydown', wake, { once: true });
$('againBtn').addEventListener('click', newGame);

newGame();
})();
