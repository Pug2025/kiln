// Kiln: the ?debug=1 overlay (OWNER: C). FPS, frame interval and render CPU ms, p50/p95, draw
// calls, triangles, pixel ratio, bloom state and a lite toggle. Glass panel per ART 5; updates the
// DOM twice a second only.

/**
 * @param {import('../core/types.js').Renderer & {quality:object}} renderer
 * @param {HTMLElement} host
 */
export function createOverlay(renderer, host) {
  const el = document.createElement('div');
  el.className = 'kiln-debug';
  el.innerHTML = `
    <div class="kd-row"><span class="kd-fps" data-k="fps">--</span><span class="kd-unit">FPS</span></div>
    <div class="kd-k">Frame</div>
    <div class="kd-stat" data-k="frame">--</div>
    <div class="kd-stat" data-k="draw">--</div>
    <div class="kd-stat" data-k="mode">--</div>
    <label class="kd-toggle">Lite <input type="checkbox" data-k="lite"></label>`;
  Object.assign(el.style, {
    position: 'fixed', left: '12px', bottom: '12px', zIndex: '50', width: '200px',
    padding: '12px 14px', borderRadius: '12px', background: 'rgba(255,255,255,.08)',
    border: '1px solid rgba(255,255,255,.1)', borderTopColor: 'rgba(255,255,255,.2)',
    borderLeftColor: 'rgba(255,255,255,.2)', backdropFilter: 'blur(24px) saturate(130%)',
    webkitBackdropFilter: 'blur(24px) saturate(130%)', boxShadow: '0 8px 24px rgba(0,0,0,.4)',
    font: '400 11px/1.5 Inter, system-ui, sans-serif', color: 'rgba(242,244,247,.7)',
    pointerEvents: 'auto', userSelect: 'none',
  });
  const style = document.createElement('style');
  style.textContent = `
    .kiln-debug .kd-row{display:flex;align-items:baseline;gap:6px}
    .kiln-debug .kd-fps{font:600 22px/1 "Inter Tight",sans-serif;color:#F2F4F7;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
    .kiln-debug .kd-unit{font:500 10px Inter,sans-serif;letter-spacing:.2em;color:rgba(242,244,247,.55)}
    .kiln-debug .kd-k{margin:8px 0 2px;font:500 10px Inter,sans-serif;letter-spacing:.28em;text-transform:uppercase;color:rgba(242,244,247,.55)}
    .kiln-debug .kd-stat{font-variant-numeric:tabular-nums}
    .kiln-debug .kd-toggle{display:flex;justify-content:space-between;align-items:center;margin-top:8px;height:28px;border-top:1px solid rgba(255,255,255,.12);color:#F2F4F7;font:500 12px Inter,sans-serif;cursor:pointer}`;
  document.head.appendChild(style);
  document.body.appendChild(el);
  const k = {};
  el.querySelectorAll('[data-k]').forEach((n) => { k[n.dataset.k] = n; });
  k.lite.checked = !!renderer.quality.lite;
  k.lite.addEventListener('change', () => renderer.setQuality({ lite: k.lite.checked }));
  // keep the overlay's clicks away from the game input
  el.addEventListener('pointerdown', (e) => e.stopPropagation());

  const s = renderer.stats;
  const timer = setInterval(() => {
    k.fps.textContent = String(s.fps || '--');
    const gpu = s.gpuTimer ? `  gpu ${s.gpuMs >= 0 ? s.gpuMs.toFixed(1) : '--'} (p50 ${s.gpuP50 >= 0 ? s.gpuP50.toFixed(1) : '--'})` : '';
    k.frame.textContent = `${s.intervalMs.toFixed(1)} ms  p50 ${s.p50}  p95 ${s.p95}  cpu ${s.frameMs.toFixed(1)} (p50 ${(s.workP50 || 0).toFixed(1)})${gpu}`;
    k.draw.textContent = `${s.calls} calls  ${(s.triangles / 1000).toFixed(1)}k tris`;
    const step = s.step ? `  step ${s.step} ${s.stepName} (${s.autoLiteWhy})` : '';
    k.mode.textContent = `${s.lite ? 'lite' : 'full'}  bloom ${s.bloom ? 'on' : 'off'}  dpr ${(s.pixelRatio || 1).toFixed(1)}${step}`;
    if (k.lite.checked !== s.lite) k.lite.checked = s.lite;
  }, 500);

  return {
    el,
    dispose() {
      clearInterval(timer);
      el.remove();
      style.remove();
    },
  };
}
