// Kiln: D's stylesheet rules that a reviewer measured in the browser, checked from the CSS text so
// they cannot drift back: touch targets, caps label sizes, the level card on the content layer.

import { readFileSync } from 'node:fs';
import { test, assert } from './lib.mjs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const screens = read('css/screens.css');
const hud = read('css/hud.css');
const app = read('css/app.css');
const tokens = read('css/tokens.css');

/** Top-level rules and @media blocks in source order: { media, sel, body, at }. */
function rules(css) {
  const out = [];
  const re = /(@media[^{]+)\{((?:[^{}]*\{[^}]*\})*)\s*\}|([^{}@]+)\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    if (m[1]) {
      const inner = /([^{}]+)\{([^}]*)\}/g;
      let n;
      while ((n = inner.exec(m[2]))) out.push({ media: m[1].trim(), sel: n[1].trim(), body: n[2], at: m.index });
    } else out.push({ media: '', sel: m[3].trim(), body: m[4], at: m.index });
  }
  return out;
}

const hasClass = (sel, cls) => sel.split(',').some((s) => new RegExp(`(^|\\s)\\.${cls}(\\.[\\w-]+)*$`).test(s.trim()));

test('touch screens: every .btn and .tab is 44 px tall, and no later rule shrinks them', () => {
  const R = rules(screens);
  const coarse = R.filter((r) => /pointer:\s*coarse/.test(r.media) && /height:\s*44px/.test(r.body));
  for (const cls of ['btn', 'tab']) {
    const grow = coarse.filter((r) => hasClass(r.sel, cls));
    assert.ok(grow.length, `a coarse-pointer rule makes .${cls} 44 px`);
    const last = Math.max(...grow.map((r) => r.at));
    for (const r of R) {
      if (r.at > last && hasClass(r.sel, cls) && /(^|;)\s*(min-)?height:/.test(r.body)) {
        assert.fail(`.${cls} height set after the coarse-pointer rule: ${r.sel} { ${r.body.trim()} }`);
      }
    }
  }
});

test('caps labels on glass and on the page are at least 12 px with 0.2em or more tracking (ART §3)', () => {
  for (const r of [...rules(screens), ...rules(app)]) {
    if (!/text-transform:\s*uppercase/.test(r.body)) continue;
    const size = /font:\s*\d+\s+(\d+(?:\.\d+)?)px/.exec(r.body) || /font-size:\s*(\d+(?:\.\d+)?)px/.exec(r.body);
    if (size) assert.ok(Number(size[1]) >= 12, `${r.sel}: ${size[1]} px caps`);
    const ls = /letter-spacing:\s*(\.\d+|\d+(?:\.\d+)?)em/.exec(r.body);
    if (ls) assert.ok(Number(ls[1]) >= 0.2, `${r.sel}: caps tracked ${ls[1]}em`);
  }
});

test('level card is content-layer text: no blur, no fill (only the R20 fallback gets the void fill)', () => {
  for (const r of rules(screens)) {
    if (!r.sel.split(',').some((s) => /\.card\b/.test(s) && !/mapcard|fillcard/.test(s))) continue;
    const fallback = /html\.rt/.test(r.sel);
    assert.ok(!/backdrop-filter:\s*blur/.test(r.body), `${r.sel}: no backdrop blur over live play`);
    if (!fallback) assert.ok(!/background(-color)?:\s*(rgba|#|var)/.test(r.body), `${r.sel}: no fill over live play`);
  }
  const card = readFileSync(new URL('../src/ui/screens/card.js', import.meta.url), 'utf8');
  assert.ok(!/div\.card\.panel/.test(card), 'the card is not a glass panel');
});

test('HUD: no panel or blur, the score keeps its gradient (shadow by filter, not text-shadow)', () => {
  assert.ok(!/backdrop-filter:\s*blur/.test(hud), 'no blur on the HUD during play');
  const score = rules(hud).find((r) => r.sel === '.hud .score');
  assert.ok(score && /text-shadow:\s*none/.test(score.body), 'the clipped gradient score has no text-shadow');
});

test('HUD: an empty fact under HEAT keeps one line of height, and no later rule changes its size', () => {
  // the HUD keeps the row on every level so the power labels below never move (a Pull press, the
  // level-end count); an empty block would collapse to 0 px, so an empty fact holds a no-break space
  // in the row's own font: exactly the height of a fact (a min-height of 1em measured 0.01 px short
  // at 1280)
  const all = rules(hud).filter((r) => /\.boss-fact\b/.test(r.sel));
  const base = all.find((r) => r.sel === '.boss-fact' && !r.media);
  assert.ok(base, 'the .boss-fact rule');
  const blank = all.find((r) => r.sel === '.boss-fact:empty::before' && !r.media);
  assert.ok(blank, 'an empty fact keeps a line');
  assert.match(blank.body, /^\s*content:\s*'\\a0';\s*$/, 'only a no-break space, in the row\'s own font');
  for (const r of all) {
    if (r === base) continue;
    assert.ok(!/(^|;)\s*(min-height|height|max-height|font|font-size|line-height|white-space|display):/.test(r.body) || r.sel === '.boss-fact[hidden]',
      `${r.media} ${r.sel}: no other size for the row`);
  }
});

const pxSize = (body) => {
  const m = /font:\s*(\d+)\s+(\d+(?:\.\d+)?)px/.exec(body);
  if (m) return { weight: Number(m[1]), px: Number(m[2]) };
  const s = /font-size:\s*(\d+(?:\.\d+)?)px/.exec(body);
  return s ? { weight: 400, px: Number(s[1]) } : null;
};

test('touch Overload button label is a 12 px button label (no 11 px caps)', () => {
  const r = rules(app).find((x) => x.sel === '.overload-btn');
  assert.ok(r, '.overload-btn rule');
  const f = pxSize(r.body);
  assert.ok(f && f.px >= 12, `.overload-btn label ${f && f.px} px`);
});

test('body copy (Inter 400 at white 70%) is 16 px or more; smaller text is secondary at 50% (ART §3)', () => {
  for (const r of [...rules(screens), ...rules(app)]) {
    if (!/color:\s*var\(--w70\)/.test(r.body)) continue;
    const f = pxSize(r.body);
    if (!f || f.weight >= 500) continue; // labels, rows and numbers have their own sizes
    assert.ok(f.px >= 16, `${r.sel}: ${f.px} px body text at white 70%`);
  }
});

test('the KILN wordmark never drops under 88 px outside short landscape screens (ART §3)', () => {
  const marks = rules(screens).filter((r) => r.sel === '.mark' && /font(-size)?:/.test(r.body) && !/orientation:\s*landscape/.test(r.media));
  assert.ok(marks.length >= 2, 'base and phone rules');
  for (const r of marks) {
    const c = /clamp\(\s*(\d+)px/.exec(r.body);
    const fixed = /font-size:\s*(\d+)px/.exec(r.body);
    const floor = c ? Number(c[1]) : fixed ? Number(fixed[1]) : NaN;
    assert.ok(floor >= 88, `${r.media || 'base'} .mark floor ${floor} px`);
  }
});

test('last life (R19) eases in over 400 ms: score low end and the life mark transition, no instant swap', () => {
  assert.match(tokens, /--t-last:\s*400ms/);
  assert.match(hud, /@property\s+--score-lo\s*\{[^}]*syntax:\s*'<color>'/, 'the gradient end is a registered colour');
  const R = rules(hud);
  const score = R.find((r) => r.sel === '.hud .score');
  assert.match(score.body, /background:\s*linear-gradient\([^;]*var\(--score-lo\)/);
  assert.match(score.body, /transition:[^;]*--score-lo\s+var\(--t-last\)/);
  const last = R.find((r) => r.sel === '.hud.last .score');
  assert.ok(last && /--score-lo:\s*var\(--heat-last\)/.test(last.body), 'last life moves the low end');
  assert.ok(!/background/.test(last.body), 'no background swap (a gradient cannot transition)');
  const mark = R.find((r) => r.sel === '.hud .marks i');
  assert.match(mark.body, /transition:[^;]*background-color\s+var\(--t-last\)/);
});

test('ART 15.6 D2, D4, D8: the I on the cap line, the menu scale eases, the 144 px card strip', () => {
  const R = rules(screens);
  const slot = R.find((r) => r.sel === '.mark .slot');
  assert.match(slot.body, /height:\s*1cap/, 'the slot is one cap height tall');
  assert.match(slot.body, /height:\s*\.727em/, 'with Inter Tight\'s cap height as the fallback');
  assert.doesNotMatch(slot.body, /translateY/, 'no nudge below the cap line');
  assert.match(slot.body, /border-radius:\s*0/, 'square corners, the stem of an I');
  const canvas = rules(app).find((r) => r.sel === '.kiln-canvas');
  assert.match(canvas.body, /transition:[^;]*transform\s+var\(--t-panel\)/, 'the 6% menu scale eases in 180 ms');
  assert.ok(rules(app).some((r) => r.sel === '.kiln-canvas:not(.menu)' && /transition-duration:\s*120ms/.test(r.body)), 'and out in 120 ms');
  const art = R.find((r) => r.sel === '.world-art');
  assert.match(art.body, /height:\s*clamp\(72px,[^;]*144px\)/, 'the card strip reaches 144 px');
  const wide = R.find((r) => /min-width:\s*1100px/.test(r.media) && r.sel === '.title-side');
  assert.ok(wide && /min\(640px/.test(wide.body), 'the desktop wall panel is at most 640 px wide');
});

test('only the loaded weights: Inter 400 and 500, Inter Tight 600 and 700 (no faux bold)', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /family=Inter:wght@400;500&family=Inter\+Tight:wght@600;700/, 'the ART 3 font URL');
  const ok = { body: [400, 500], display: [600, 700] };
  for (const r of [...rules(screens), ...rules(hud), ...rules(app)]) {
    const sh = /font:\s*(\d{3})\s[^;]*var\(--font-(body|display)\)/.exec(r.body);
    if (sh) assert.ok(ok[sh[2]].includes(Number(sh[1])), `${r.sel}: ${sh[2]} at ${sh[1]}`);
    const fw = /font-weight:\s*(\d{3})/.exec(r.body);
    if (!fw) continue;
    // a weight on its own: the family is the rule's own, or the button's (Inter) for .btn variants
    const fam = /font-family:\s*var\(--font-(body|display)\)/.exec(r.body);
    const family = fam ? fam[1] : hasClass(r.sel, 'btn') || /\.btn\./.test(r.sel) ? 'body' : '';
    if (family) assert.ok(ok[family].includes(Number(fw[1])), `${r.sel}: ${family} at ${fw[1]}`);
  }
});
