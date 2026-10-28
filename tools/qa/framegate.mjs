#!/usr/bin/env node
// Kiln QA (G): the standard frame gate. One command for the release frame check: tools/qa/frametime.mjs
// on every level in STANDARD_LEVELS, one after another, each at its defaults (Pixel 7, CPU 4x, 60 s
// per pass, lite off then lite on, every frame within 16 ms, zero dropped, renderer.frame under
// 32 KB a frame). Item 21 (Oct 27) added level 30: The Core is the heaviest boss render (rotating
// ring bricks, crack overlay, model shells) and went over the allocation budget unseen while only
// 20 and 24 were gated. Run it with nothing else heavy on the machine (no test suite, no other
// Chrome): the timings are real.
//
//   node tools/qa/framegate.mjs                       levels 20, 24 and 30
//   node tools/qa/framegate.mjs --json out/gate.json  also each level's report as out/gate-L<n>.json
//   node tools/qa/framegate.mjs --levels 30           only some of them (still the standard settings)
//
// Any other option is passed to frametime.mjs unchanged (for example --root <checkout>). Exit code 1
// when any level fails.

import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const STANDARD_LEVELS = Object.freeze([20, 24, 30]);

const HERE = dirname(fileURLToPath(import.meta.url));

function parse(argv) {
  const o = { levels: [...STANDARD_LEVELS], json: '', pass: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--levels') o.levels = String(argv[++i] || '').split(',').map(Number).filter((n) => n > 0);
    else if (a === '--json') o.json = argv[++i] || '';
    else if (a === '--level' || a === '--fixture' || a === '--lite' || a === '--throttle' || a === '--seconds' ||
      a === '--budget' || a === '--alloc-kb' || a === '--idle-drops') {
      throw new Error(`${a} would change the standard gate; run tools/qa/frametime.mjs directly for that`);
    } else o.pass.push(a);
  }
  if (!o.levels.length) throw new Error('--levels needs level numbers, for example --levels 20,30');
  return o;
}

function runLevel(level, o) {
  const args = [join(HERE, 'frametime.mjs'), '--level', String(level), '--throttle', '4', ...o.pass];
  if (o.json) args.push('--json', o.json.replace(/(\.json)?$/, `-L${level}.json`));
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'inherit'] });
    let text = '';
    child.stdout.on('data', (d) => {
      process.stdout.write(d);
      text += d;
    });
    child.on('close', (code) => resolve({ level, code, result: (text.match(/^RESULT: .*$/m) || ['RESULT: no result line'])[0] }));
  });
}

async function main() {
  let o;
  try {
    o = parse(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    return 2;
  }
  console.log(`Kiln standard frame gate: levels ${o.levels.join(', ')}\n`);
  const out = [];
  for (const level of o.levels) {
    out.push(await runLevel(level, o));
    console.log('');
  }
  console.log('Standard frame gate summary:');
  for (const r of out) console.log(`  level ${r.level}: ${r.code === 0 ? 'PASS' : 'FAIL'}  ${r.result.replace(/^RESULT: (PASS|FAIL) /, '')}`);
  const failed = out.some((r) => r.code !== 0);
  console.log(`\nGATE: ${failed ? 'FAIL' : 'PASS'}`);
  return failed ? 1 : 0;
}

process.exit(await main());
