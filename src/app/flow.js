// Kiln: the run flow as pure rules (OWNER: D). No DOM, no clock: tests/d-flow.test.mjs runs it.
// main.js asks these functions what comes next and shows the screens.
//
//   title → map → (picks) → level card + play → results → (gate) → (picks) → next level …
//   The Core: stage worlds chain through def.continues with no results in between.
//   Run over → results → map. Clearing 30 → results → title (Overburn opens).
//   Overburn: wave after wave until the run is over.
// Picks: a Mod (1 of 3) before levels 13, 16, 19, 23, 26, 29; the Overload before 22. A run that
// starts past a pick level is not left short: it opens with the Overload pick (past 22) and one
// Mod pick (past 13) if it has none. Gates: from level 13, two doors after each level, never in
// front of a bonus or boss level.

import { PICKS } from '../core/constants.js';

export const CAMPAIGN = 30;

/** World name for a level number. */
export function worldOf(n) {
  if (n > CAMPAIGN) return 'overburn';
  if (n > 20) return 'whiteheat';
  if (n > 10) return 'blaze';
  return 'ember';
}

/** Kind for a level number when the def does not say (5/15/25 bonus, 10/20/30 boss). */
export function kindOf(n) {
  if (n === 5 || n === 15 || n === 25) return 'bonus';
  if (n === 10 || n === 20 || n === 30) return 'boss';
  return 'normal';
}

/** The pick shown before a level starts: def.pick wins, else the PICKS table. */
export function pickFor(def, picks = PICKS) {
  if (def.pick !== undefined) return def.pick || null;
  if (def.n > CAMPAIGN || def.stage > 1) return null;
  if (picks.MOD_LEVELS.includes(def.n)) return 'mod';
  if (def.n === picks.OVERLOAD_LEVEL) return 'overload';
  return null;
}

/**
 * Picks to show before this level, in order.
 * @param {{n:number, pick?:string|null, stage?:number}} def
 * @param {{overload:number, mods:any[]}} run
 * @param {{first?:boolean}} [opts]  first = the run starts at this level
 * @returns {('overload'|'mod')[]}
 */
export function preLevelPicks(def, run, opts = {}, picks = PICKS) {
  const out = [];
  const p = pickFor(def, picks);
  const hasOverload = !!run.overload;
  const hasMod = run.mods && run.mods.length > 0;
  if ((p === 'overload' || (opts.first && def.n > picks.OVERLOAD_LEVEL)) && !hasOverload) out.push('overload');
  if (p === 'mod') out.push('mod');
  else if (opts.first && def.n > picks.GATES_FROM && !hasMod) out.push('mod');
  return out;
}

/**
 * Two doors after this level? Never in front of a bonus or boss level, never inside The Core,
 * never in Overburn. def.gate (B's data) may switch a gate off; it cannot put one before a bonus
 * or boss level.
 * @param {{n:number, gate?:boolean, continues?:string, kind?:string}} def
 * @param {{n:number, kind?:string}|null} nextDef
 */
export function gateAfter(def, nextDef, picks = PICKS) {
  if (!nextDef || def.continues || def.n >= CAMPAIGN || def.n < picks.GATES_FROM) return false;
  const nextKind = nextDef.kind || kindOf(nextDef.n);
  if (nextKind !== 'normal') return false;
  if (def.gate === false) return false;
  return true;
}

/**
 * What happens when a world ends.
 * @param {{n:number, continues?:string, world?:string}} def
 * @param {'cleared'|'over'} phase
 * @param {{hasStage?:(id:string)=>boolean, wave?:number}} [ctx]
 * @returns {{type:'over'}|{type:'stage', id:string}|{type:'campaign'}|{type:'wave', wave:number}|{type:'next', n:number}}
 */
export function afterWorld(def, phase, ctx = {}) {
  if (phase === 'over') return { type: 'over' };
  if (def.continues && (!ctx.hasStage || ctx.hasStage(def.continues))) return { type: 'stage', id: def.continues };
  if (def.world === 'overburn' || def.n > CAMPAIGN) return { type: 'wave', wave: (ctx.wave || 1) + 1 };
  if (def.n >= CAMPAIGN) return { type: 'campaign' };
  return { type: 'next', n: def.n + 1 };
}

/** Level PLAY continues from: the first level not yet cleared in order (at most 30). */
export function continueLevel(campaign) {
  return Math.max(1, Math.min(CAMPAIGN, campaign.unlocked | 0 || 1));
}

/** Overburn opens once level 30 is cleared. */
export function overburnOpen(campaign) {
  return !!(campaign.cleared && (campaign.cleared[CAMPAIGN] || campaign.cleared[String(CAMPAIGN)]));
}

/**
 * Fallback progress record (E's recordClear replaces it when it exists): unlock the next level,
 * mark this one cleared, keep the best level score.
 * @param {{campaign:{unlocked:number, best:Object, cleared:Object}}} save
 */
export function recordClear(save, n, levelScore) {
  const c = save.campaign;
  if (n > CAMPAIGN) return save;
  c.cleared[n] = true;
  c.best[n] = Math.max(c.best[n] | 0, levelScore | 0);
  c.unlocked = Math.max(c.unlocked | 0, Math.min(CAMPAIGN + 1, n + 1));
  return save;
}

/**
 * The level map's model: three worlds of ten and Overburn.
 * @param {{campaign:{unlocked:number, best:Object, cleared:Object}, overburn:{best:number, bestWave:number}}} save
 * @param {(n:number) => ({name?:string, adds?:string, kind?:string}|null)} getDef
 * @param {string[]} names  LEVEL_NAMES (index = level number)
 */
export function mapModel(save, getDef, names) {
  const c = save.campaign;
  const worlds = [
    { id: 'ember', name: 'Ember', from: 1 },
    { id: 'blaze', name: 'Blaze', from: 11 },
    { id: 'whiteheat', name: 'Inferno', from: 21 },
  ].map((w) => {
    const levels = [];
    for (let n = w.from; n < w.from + 10; n++) {
      const def = getDef(n);
      const open = n <= (c.unlocked | 0 || 1);
      levels.push({
        n,
        name: (def && def.name) || names[n] || `Level ${n}`,
        adds: (def && def.adds) || '',
        kind: (def && def.kind) || kindOf(n),
        state: c.cleared[n] ? 'cleared' : open ? 'open' : 'locked',
        best: c.best[n] | 0,
      });
    }
    return { ...w, levels, open: levels[0].state !== 'locked' };
  });
  return {
    worlds,
    overburn: { open: overburnOpen(c), best: save.overburn.best | 0, bestWave: save.overburn.bestWave | 0 },
    current: continueLevel(c),
  };
}

/**
 * Can the player open the pause menu now? Only during live play: once the world is cleared or
 * over, the results (or the next stage) come in a moment, and Restart or Levels must not cancel
 * them (a lost run would come back with its lives).
 * @param {{mode:string, paused:boolean}} app
 * @param {string} phase  the world's phase
 */
export function canPause(app, phase) {
  return app.mode === 'play' && !app.paused && phase !== 'cleared' && phase !== 'over';
}

/**
 * The run a "Restart level" starts from: the run as it was when this world began (score, Mods,
 * embers), except that a restart never gives back a lost life or a used free miss, and a Life
 * drop caught in the abandoned attempt is not kept either (the level is played again).
 * Returns null when no life is left (the run is over: there is nothing to restart).
 * @param {{lives:number, freeMiss?:number}} atStart  a copy of the run at the start of the world (it is reused)
 * @param {{lives:number, freeMiss?:number}} now      the run as it is now
 */
export function restartRun(atStart, now) {
  const lives = Math.min(atStart.lives | 0, now.lives | 0);
  if (lives <= 0) return null;
  atStart.lives = lives;
  if (atStart.freeMiss !== undefined || now.freeMiss !== undefined) {
    atStart.freeMiss = Math.min(atStart.freeMiss | 0, now.freeMiss | 0);
  }
  return atStart;
}

// ------------------------------------------------------------------ lite (ART 15.6 D1)
// Lite is the player's own choice, saved only from the Settings switch (settings.liteSet). The
// renderer's auto-lite lasts for the session (session.autoLite) and never reaches the save, so
// one slow stretch cannot keep the full look off for good.

/**
 * One-time repair of saves written by the old auto-lite: lite on without liteSet was never the
 * player's choice. Returns true when it changed the settings (the caller saves).
 * @param {{lite?:boolean, liteSet?:boolean}} settings
 */
export function migrateLite(settings) {
  if (settings.lite && settings.liteSet !== true) {
    settings.lite = false;
    return true;
  }
  return false;
}

/**
 * Lite as the game runs it now: the player's switch, or this session's auto-lite.
 * @param {{lite?:boolean}} settings
 * @param {{autoLite?:boolean}} session
 */
export function liteNow(settings, session) {
  return !!settings.lite || !!session.autoLite;
}

/**
 * The renderer switched itself to lite: for this session only. Nothing in `settings` changes.
 * @param {{autoLite?:boolean, liteNote?:boolean}} session
 */
export function autoLiteTripped(session) {
  session.autoLite = true;
  session.liteNote = true; // "Lite mode on" at the next pause, menu or lost ball
}

/**
 * The player flipped the Settings switch: that choice is saved and wins over auto-lite.
 * @param {{lite?:boolean, liteSet?:boolean}} settings
 * @param {{autoLite?:boolean}} session
 * @param {boolean} on
 */
export function playerSetsLite(settings, session, on) {
  settings.lite = !!on;
  settings.liteSet = true;
  session.autoLite = false;
}
