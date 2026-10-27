// Kiln: the HUD (OWNER: D). Content layer (ART §4, R18): text and 1 px lines on the world, no
// panels, nothing near the paddle. Glued to the projected field by layout.js; per frame it reads
// world state and touches the DOM only when a shown value changes (no layout reads, no allocation
// beyond the text of a changed number).

import { BRICK, DROP, DROP_COUNT, DROP_FAMILY, HAZARD, LIVES } from '../core/constants.js';
import { formatScore, formatClock } from './layout.js';
import { ICONS } from './icons.js';
import { resourceFact } from './resources.js';

const FX_LABEL = ['Wide', 'Slow', 'Multi', 'Fire', 'Laser', 'Catch', 'Thru', 'Life', 'Shrink', 'Fast', 'Fog', 'Mega'];
const DISC_PX = 32; // the drawn pause / sound disc inside its 44 px target (layout.js HUD.BTN_DRAWN)
const DELTA_MS = 700;
const NOTE_MS = 1600;
const DROP_FACT_MS = 2600;

/**
 * @param {HTMLElement} root  the #ui layer
 * @param {{onPause?:() => void, onMute?:() => void}} [opts]  the two HUD buttons
 */
export function createHud(root, opts = {}) {
  const el = document.createElement('div');
  el.className = 'hud';
  el.setAttribute('aria-live', 'off');
  el.innerHTML = `
    <div class="hud-btns">
      <button type="button" class="icon-btn" data-k="pauseBtn" aria-label="Pause">${ICONS.pause}</button>
      <button type="button" class="icon-btn" data-k="muteBtn" aria-label="Sound on" aria-pressed="false">${ICONS.sound}</button>
    </div>`;
  el.insertAdjacentHTML('beforeend', `
    <div class="hb hud-score"><div class="hi">
      <div class="kicker"><span>Score</span></div>
      <div class="srow"><div class="num score" data-k="score">0</div><div class="sfx"><span class="mult" data-k="mult"></span><span class="delta" data-k="delta"></span></div></div>
    </div></div>
    <div class="hb hud-heat"><div class="hi">
      <div class="heat-row" data-k="heatRow"><span class="k" data-k="heatLabel">Heat</span><span class="track"><span class="vent" data-k="vent"></span><span class="fill" data-k="heat"></span></span><span class="ready">Ready</span></div>
      <div class="boss-fact" data-k="bossFact" hidden></div>
      <div class="fx-row" data-k="fxRow">${FX_LABEL.map((n, i) => `<span class="fx ${DROP_FAMILY[i]}" hidden>${i === DROP.LASER ? '<span data-k="laserLabel">Laser</span>' : n}<b></b><i><u></u></i></span>`).join('')}<span class="fx cold" data-k="shield" hidden>Shield<b></b><i><u></u></i></span></div>
      <div class="drop-fact" data-k="dropFact" role="status" aria-live="polite" aria-atomic="true" hidden><span data-k="dropName"></span><span data-k="dropEffect"></span></div>
    </div></div>
    <div class="hb hud-right"><div class="hi">
      <div class="kicker r" data-k="levelLabel">Level</div>
      <div class="num level" data-k="level">01</div>
      <div class="name" data-k="name"></div>
      <div class="boss" data-k="boss" role="meter" aria-valuemin="0" hidden><span class="track"><span class="fill" data-k="bossFill"></span></span></div>
      <div class="lives" data-k="livesBox">
        <div class="kicker r">Lives</div>
        <div class="marks" data-k="marks">${'<i></i>'.repeat(LIVES.MAX)}</div>
      </div>
      <div class="time" data-k="timeBox" hidden>
        <div class="kicker r">Time</div>
        <div class="num clock" data-k="clock">0:30</div>
      </div>
    </div></div>`);
  root.appendChild(el);

  const k = {};
  el.querySelectorAll('[data-k]').forEach((n) => { k[n.dataset.k] = n; });
  const blocks = {
    score: el.querySelector('.hud-score'),
    heat: el.querySelector('.hud-heat'),
    right: el.querySelector('.hud-right'),
  };
  const fxEls = Array.from(k.fxRow.querySelectorAll('.fx')).slice(0, DROP_COUNT);
  const fxLine = fxEls.map((n) => n.querySelector('u'));
  const fxCount = fxEls.map((n) => n.querySelector('b'));
  const shieldCount = k.shield.querySelector('b');
  const marks = Array.from(k.marks.children);
  const readyEl = k.heatRow.querySelector('.ready');
  const scoreKicker = blocks.score.querySelector('.kicker');
  const sfx = blocks.score.querySelector('.sfx');
  const btns = el.querySelector('.hud-btns');
  const coarse = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(pointer: coarse)') : { matches: false };
  // a tap on a HUD button must never reach the stage (steering, actions)
  for (const b of [k.pauseBtn, k.muteBtn]) b.addEventListener('pointerdown', (e) => e.stopPropagation());
  k.pauseBtn.addEventListener('click', () => { if (opts.onPause) opts.onPause(); });
  k.muteBtn.addEventListener('click', () => { if (opts.onMute) opts.onMute(); });

  // last shown values (-1 / null = never shown)
  const last = {
    score: -1, mult: -1, level: -1, name: null, lives: -1, last: null, heat: -1, heatOn: null,
    ready: null, clock: -1, timed: null, boss: -1, bossOn: null, shield: -1, vent: -1, ventPeak: 0, pulling: null,
    fxOn: new Int8Array(DROP_COUNT).fill(-1), fxQ: new Int16Array(DROP_COUNT).fill(-1),
    fxN: new Int16Array(DROP_COUNT).fill(-1), deltaUntil: 0, deltaOn: false, noteUntil: 0,
    dropUntil: 0, dropSeen: 0, bossLabel: '', bossFact: '', bossAria: '', laserLabel: '', contextOn: null,
    bossSegs: -1, bossHp: -1, bossId: '', bossStage: -1, bossFlash: false, bossCooled: null,
  };
  const peak = new Float32Array(DROP_COUNT); // longest ms seen per effect, for its line
  let scale = 1;
  let narrow = false;

  function reset() {
    last.score = -1; last.mult = -1; last.level = -1; last.name = null; last.lives = -1; last.last = null;
    last.heat = -1; last.heatOn = null; last.ready = null; last.clock = -1; last.timed = null;
    last.pulling = null;
    last.boss = -1; last.bossOn = null; last.shield = -1; last.vent = -1; last.ventPeak = 0;
    last.fxOn.fill(-1); last.fxQ.fill(-1); last.fxN.fill(-1);
    peak.fill(0);
    last.ready = false;
    k.heatRow.classList.remove('full');
    last.deltaOn = false;
    last.deltaUntil = 0; last.noteUntil = 0;
    k.delta.classList.remove('show');
    last.dropUntil = 0; last.dropSeen = 0;
    k.dropFact.hidden = true;
    blocks.heat.classList.remove('drop-fact-on');
    last.bossLabel = ''; last.bossFact = ''; last.bossAria = ''; last.laserLabel = '';
    last.contextOn = null;
    last.bossSegs = -1; last.bossHp = -1; last.bossId = ''; last.bossStage = -1; last.bossCooled = null;
    k.boss.classList.remove('hit-a', 'hit-b', 'cooled');
  }

  return {
    el,

    /** Position the blocks from hudLayout(). */
    layout(L) {
      el.classList.toggle('band', L.mode === 'band');
      el.classList.toggle('gutter', L.mode === 'gutter');
      el.classList.toggle('inset', L.mode === 'inset');
      // the delta: in the band it rides the score's suffix column (ART 15.6 D3); in the narrow
      // gutter it stays in the SCORE kicker row, so the line never runs into the field
      const deltaHome = L.delta === 'kicker' ? scoreKicker : sfx;
      if (k.delta.parentNode !== deltaHome) deltaHome.appendChild(k.delta);
      const s = L.s;
      scale = s;
      narrow = L.heat.w * s < 180;
      // text sizes in field units with their on-screen floors (layout.js hudText)
      el.style.setProperty('--k', `${L.text.k.toFixed(2)}px`);
      el.style.setProperty('--small', `${L.text.small.toFixed(2)}px`);
      el.style.setProperty('--tiny', `${L.text.tiny.toFixed(2)}px`);
      el.style.setProperty('--num', `${L.text.num.toFixed(2)}px`);
      el.style.setProperty('--lvl', `${L.text.lvl.toFixed(2)}px`);
      el.style.setProperty('--score', `${L.text.score.toFixed(2)}px`);
      blocks.score.style.width = `${L.score.w}px`;
      blocks.score.style.transform = `translate(${L.score.x}px, ${L.score.y}px) scale(${s})`;
      blocks.heat.style.transform = `translate(${L.heat.x}px, ${L.heat.y}px) scale(${s})`;
      blocks.heat.style.width = `${L.heat.w}px`;
      blocks.right.style.transform = `translate(${L.right.x}px, ${L.right.y}px) scale(${s})`;
      btns.style.transform = `translate(${L.btns.x}px, ${L.btns.y}px)`;
    },

    /** The sound button's state (muted shows the struck speaker). */
    setMuted(on) {
      k.muteBtn.innerHTML = on ? ICONS.muted : ICONS.sound;
      k.muteBtn.setAttribute('aria-label', on ? 'Sound off' : 'Sound on');
      k.muteBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    },

    setVisible(on) {
      el.classList.toggle('on', !!on);
    },

    /** The overload input can fire now (main.js decides: Overload or shield, HEAT enough). */
    setReady(on) {
      if (on !== last.ready) { last.ready = on; k.heatRow.classList.toggle('full', !!on); }
    },
    /** What the overload input does: the Overload's name, or Shield before one is equipped. */
    setReadyLabel(text) {
      readyEl.textContent = text;
    },

    /** A short fact in the score's delta line for a moment (a free miss: lives did not change). */
    note(text, now) {
      k.delta.textContent = text;
      if (!last.deltaOn) { k.delta.classList.add('show'); last.deltaOn = true; }
      last.deltaUntil = now + NOTE_MS;
      last.noteUntil = last.deltaUntil;
    },

    /** The content layer supplies the actual loss after clamping to the available HEAT. */
    hazardHit(kind, lost, now) {
      const name = kind === HAZARD.SLAG ? 'Slag' : kind === HAZARD.BOLT ? 'Bolt' : 'Bomb';
      this.note(lost > 0 ? `${name} −${Math.round(lost)} HEAT` : `${name} · HEAT empty`, now);
    },

    /** First opening powers: a named cell and its effect, in the space already reserved for HEAT. */
    openingDrop(kind, caught, count, now) {
      if (kind !== DROP.WIDE && kind !== DROP.MULTI) return;
      const bit = 1 << kind;
      if (!caught && (last.dropSeen & bit)) return;
      last.dropSeen |= bit;
      k.dropName.textContent = `${FX_LABEL[kind]} ${caught ? 'caught' : 'drop'}`;
      k.dropEffect.textContent = kind === DROP.WIDE ? 'Longer paddle'
        : caught ? (count > 0 ? `${count} extra ${count === 1 ? 'ball' : 'balls'}` : 'No extra balls') : 'Extra balls';
      k.dropFact.hidden = false;
      blocks.heat.classList.add('drop-fact-on');
      last.dropUntil = now + DROP_FACT_MS;
    },

    /** New world: forget shown values so everything is written once. */
    reset,

    /**
     * QA (window.__kiln.hudCheck): the smallest HUD text on screen and any HUD button that covers
     * HUD text. Reads layout, so it is for checks only, never per frame.
     * @returns {{mode:string, minPx:number, smallest:string, overlaps:string[]}}
     */
    check() {
      const mode = ['band', 'gutter', 'inset'].find((m) => el.classList.contains(m)) || '';
      const res = { mode, minPx: Infinity, smallest: '', overlaps: [] };
      const texts = [];
      for (const n of el.querySelectorAll('.hb span, .hb div, .marks')) {
        const r = n.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        const own = Array.from(n.childNodes).some((c) => c.nodeType === 3 && c.textContent.trim());
        if (own) {
          const txt = n.textContent.trim();
          const px = parseFloat(getComputedStyle(n).fontSize) * scale;
          if (px < res.minPx) { res.minPx = px; res.smallest = txt; }
          texts.push({ n: txt, r });
        } else if (n.classList.contains('marks')) texts.push({ n: 'lives', r });
      }
      for (const b of [k.pauseBtn, k.muteBtn]) {
        // the drawn disc (32 px inside the 44 px target): what can cover text
        const hit = b.getBoundingClientRect();
        const d = (hit.width - DISC_PX) / 2;
        const br = { left: hit.left + d, right: hit.right - d, top: hit.top + d, bottom: hit.bottom - d };
        for (const t of texts) {
          const r = t.r;
          if (br.left < r.right && br.right > r.left && br.top < r.bottom && br.bottom > r.top) res.overlaps.push(`${b.getAttribute('aria-label')} / ${t.n}`);
        }
      }
      return res;
    },

    /**
     * @param {import('../core/types.js').World} world
     * @param {number} now  ms (performance.now) for the score-delta fade
     */
    update(world, now) {
      const run = world.run;
      const econ = world.econ;
      const lvl = world.level;

      const score = run.score;
      if (score !== last.score) {
        if (last.score >= 0 && score > last.score && now >= last.noteUntil) {
          k.delta.textContent = `+${formatScore(score - last.score)}`;
          if (!last.deltaOn) { k.delta.classList.add('show'); last.deltaOn = true; }
          last.deltaUntil = now + DELTA_MS;
        }
        last.score = score;
        k.score.textContent = formatScore(score);
      }
      if (last.deltaOn && now > last.deltaUntil) { k.delta.classList.remove('show'); last.deltaOn = false; }
      if (last.dropUntil && now > last.dropUntil) {
        last.dropUntil = 0;
        k.dropFact.hidden = true;
        blocks.heat.classList.remove('drop-fact-on');
      }

      const mult = econ.mult;
      if (mult !== last.mult) { last.mult = mult; k.mult.textContent = mult > 1 ? `×${mult}` : ''; }

      if (lvl.n !== last.level) {
        last.level = lvl.n;
        k.level.textContent = String(lvl.n).padStart(2, '0');
      }
      const boss = world.boss;
      const bossOn = !!boss.active && boss.hpMax > 0;
      const coreStage = boss.id === 'core' ? Math.max(1, Math.min(3, lvl.stage || lvl.def.stage || boss.phase || 1)) : 0;
      const name = bossOn ? `${boss.hp} core ${boss.hp === 1 ? 'hit' : 'hits'} left` : lvl.def.name || '';
      if (name !== last.name) { last.name = name; k.name.textContent = name; }
      const bossLabel = bossOn ? boss.id === 'stoker' ? 'Stoker' : boss.id === 'crucible' ? 'Crucible' : `Core ${coreStage}/3` : 'Level';
      if (bossLabel !== last.bossLabel) { last.bossLabel = bossLabel; k.levelLabel.textContent = bossLabel; }

      const lives = run.lives;
      const lastLife = !!world.fx.lastLife;
      if (lives !== last.lives || lastLife !== last.last) {
        last.lives = lives;
        last.last = lastLife;
        const slots = Math.min(LIVES.MAX, Math.max(LIVES.START, lives));
        for (let i = 0; i < marks.length; i++) {
          const m = marks[i];
          m.hidden = i >= slots;
          m.className = i < lives ? (lastLife ? 'warn' : '') : 'lost';
        }
        el.classList.toggle('last', lastLife);
      }

      const timed = lvl.timeLeftMs >= 0 && lvl.rules.timerMs > 0;
      if (timed !== last.timed) { last.timed = timed; k.timeBox.hidden = !timed; k.livesBox.hidden = timed; }
      if (timed) {
        const sec = Math.ceil(lvl.timeLeftMs / 1000);
        if (sec !== last.clock) { last.clock = sec; k.clock.textContent = formatClock(lvl.timeLeftMs); }
      }

      const heatOn = !!lvl.rules.heat;
      if (heatOn !== last.heatOn) { last.heatOn = heatOn; k.heatRow.hidden = !heatOn; }
      if (heatOn) {
        const pulling = !!world.paddle?.pulling;
        if (pulling !== last.pulling) {
          last.pulling = pulling;
          k.heatLabel.textContent = pulling ? 'Pull' : 'Heat';
          k.heatRow.classList.toggle('pulling', pulling);
          k.heatRow.setAttribute('aria-label', pulling ? 'Pull active; using HEAT' : 'HEAT');
        }
        const h = Math.round((econ.heat / (econ.heatMax || 100)) * 100);
        if (h !== last.heat) { last.heat = h; k.heat.style.transform = `scaleX(${h / 100})`; }
        // after an Overload the kiln vents (E): a white line on the track empties over the vent
        // time, so the player sees why caught embers do not fill the meter
        const vms = econ.ventMs || 0;
        if (vms > last.ventPeak) last.ventPeak = vms;
        if (vms <= 0) last.ventPeak = 0;
        const v = last.ventPeak > 0 ? Math.ceil((vms / last.ventPeak) * 50) : 0;
        if (v !== last.vent) { last.vent = v; k.vent.style.transform = `scaleX(${v / 50})`; }
      }

      if (bossOn !== last.bossOn) {
        last.bossOn = bossOn;
        k.boss.hidden = !bossOn;
        blocks.heat.classList.toggle('boss-on', bossOn);
        fxEls[DROP.LASER].classList.toggle('laser-action', bossOn);
      }
      if (bossOn) {
        const q = Math.round((boss.hp / boss.hpMax) * 100);
        const aria = `${lvl.def.name || bossLabel}${coreStage ? `, stage ${coreStage} of 3` : ''}, ${name}`;
        // One segment per counted hit, so every hit visibly takes one away; the bar flashes warm
        // on each one (item 20). Two alternating classes restart the CSS flash without a reflow.
        if (boss.hpMax !== last.bossSegs) { last.bossSegs = boss.hpMax; k.boss.style.setProperty('--segs', String(boss.hpMax)); }
        if (last.bossHp >= 0 && boss.hp < last.bossHp && last.bossId === boss.id && last.bossStage === coreStage) {
          last.bossFlash = !last.bossFlash;
          k.boss.classList.toggle('hit-a', last.bossFlash);
          k.boss.classList.toggle('hit-b', !last.bossFlash);
        }
        last.bossHp = boss.hp;
        last.bossId = boss.id;
        last.bossStage = coreStage;
        const cooled = !!boss.data?.guard && boss.hp > 0;
        if (cooled !== last.bossCooled) { last.bossCooled = cooled; k.boss.classList.toggle('cooled', cooled); }
        if (q !== last.boss || aria !== last.bossAria) {
          last.boss = q;
          last.bossAria = aria;
          k.bossFill.style.transform = `scaleX(${Math.max(0, q) / 100})`;
          k.boss.setAttribute('aria-label', `${lvl.def.name || bossLabel}${coreStage ? `, stage ${coreStage} of 3` : ''}, core hits remaining`);
          k.boss.setAttribute('aria-valuemax', boss.hpMax);
          k.boss.setAttribute('aria-valuenow', boss.hp);
          k.boss.setAttribute('aria-valuetext', name);
        }
      }
      const won = lvl.total > 0 && lvl.remaining <= 0;
      const fact = bossOn && !won ? bossFact(world) : resourceFact(world, coarse.matches);
      if (fact !== last.bossFact) { last.bossFact = fact; k.bossFact.textContent = fact; }
      const contextOn = !last.dropUntil;
      if (contextOn !== last.contextOn) {
        last.contextOn = contextOn; k.bossFact.hidden = !contextOn;
        blocks.heat.classList.toggle('context-on', contextOn);
      }
      let held = false;
      if (bossOn && world.balls) {
        for (const ball of world.balls) if (ball.alive && ball.held) { held = true; break; }
      }
      const laserLabel = bossOn && held ? 'Laser · launch first'
        : bossOn && world.phase === 'play' ? coarse.matches ? narrow ? 'Tap: Laser' : 'Quick tap: Laser' : 'Space / click: Laser' : 'Laser';
      if (laserLabel !== last.laserLabel) { last.laserLabel = laserLabel; k.laserLabel.textContent = laserLabel; }

      // active drops: a label and a 1-unit line for the time left
      const ms = econ.effectMs;
      const fx = world.effects;
      for (let i = 0; i < DROP_COUNT; i++) {
        const v = ms[i];
        const on = v > 0 && (i !== DROP.LASER || fx.laserShots > 0) ? 1 : 0;
        if (on !== last.fxOn[i]) {
          last.fxOn[i] = on;
          fxEls[i].hidden = !on;
          if (!on) peak[i] = 0;
        }
        if (!on) continue;
        if (v > peak[i] && v !== Infinity) peak[i] = v;
        const q = v === Infinity || peak[i] <= 0 ? 20 : Math.max(1, Math.round((v / peak[i]) * 20));
        if (q !== last.fxQ[i]) { last.fxQ[i] = q; fxLine[i].style.transform = `scaleX(${q / 20})`; }
        const n = i === 4 ? fx.laserShots | 0 : 0; // Laser shows its shots left
        if (n !== last.fxN[i]) { last.fxN[i] = n; fxCount[i].textContent = n > 0 ? String(n) : ''; }
      }
      const sh = fx.shield | 0;
      if (sh !== last.shield) {
        last.shield = sh;
        k.shield.hidden = sh <= 0;
        shieldCount.textContent = sh > 1 ? String(sh) : '';
      }
    },
  };
}

/** Persistent facts follow live collision state, not the short serving card or elapsed time. */
function bossFact(world) {
  const boss = world.boss;
  if (boss.hp <= 0) return boss.id === 'core' && boss.phase < 3 ? 'Stage complete' : 'Core broken';
  if (boss.data?.guard) return 'Core cooled: no damage';
  if (boss.id !== 'stoker') return boss.id === 'core' && boss.phase === 3
    ? 'Hit core through both gaps' : 'Hit core through the gap';
  if (boss.data?.jawRepairPending) return 'Jaw repairing; damage kept';
  const B = world.bricks;
  if (B) {
    // An outer jaw opening is not a route to the core. Only a missing plate directly below the
    // fused weak point counts; this remains true as the whole head sways side to side.
    let core = -1;
    for (let i = 0; i < B.count; i++) if (B.alive[i] && B.type[i] === BRICK.WEAK) { core = i; break; }
    if (core >= 0) {
      for (let i = 0; i < B.count; i++) {
        if (B.alive[i] || B.type[i] !== BRICK.ARMOURED || B.y[i] <= B.y[core]) continue;
        if (Math.abs(B.x[i] - B.x[core]) < (B.w[i] + B.w[core]) / 2) return 'Jaw open: hit the core';
      }
    }
  }
  return 'Break a plate below the core';
}
