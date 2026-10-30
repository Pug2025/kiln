// Source-side bed protection. Keep light on the kiln, without washing out the paddle.
import { FIELD, PADDLE, RING } from '../core/constants.js';
import { LOOK } from './look.js';

export const PADDLE_SOURCE = Object.freeze({ MARGIN: 40, FILTER_PAD: 10 });

/** Project a neighbourhood of the field footprint, including the paddle's front depth. */
export function paddleSourceRadius(p, mode, clip, width, height, ax, ay, bx, by) {
  const ring = mode === 'ring', margin = PADDLE_SOURCE.MARGIN;
  const h = Math.max(PADDLE.H, p.h) / 2;
  const a = Math.min(Math.PI, (p.span > 0 ? p.span : RING.SPAN_DEG * Math.PI / 180) / 2);
  const outer = RING.R_PADDLE + h, inner = RING.R_PADDLE - h;
  const halfW = (ring ? outer * Math.sin(Math.min(Math.PI / 2, a)) : p.w / 2) + margin;
  const y0 = -h - margin;
  const y1 = (ring ? RING.R_PADDLE - (a <= Math.PI / 2 ? inner : outer) * Math.cos(a) : h) + margin;
  const rotation = ring ? Math.PI / 2 - p.angle : mode === 'left' ? -Math.PI / 2 : 0;
  const c = Math.cos(rotation), s = Math.sin(rotation), dx = bx - ax, dy = by - ay;
  const length2 = Math.max(1e-4, dx * dx + dy * dy);
  const depth = LOOK.PADDLE_DEPTH / 2 + 2;
  let radius = 0;
  for (let i = 0; i < 8; i++) {
    const lx = i & 1 ? halfW : -halfW, ly = i & 2 ? y1 : y0, z = i & 4 ? depth : -depth;
    const x = p.x - FIELD.W / 2 + lx * c - ly * s;
    const y = FIELD.H / 2 - p.y + lx * s + ly * c;
    const cw = clip[3] * x + clip[7] * y + clip[11] * z + clip[15];
    // A neighbourhood crossing the camera plane must not leave a stale partial guard.
    if (!(cw > 0)) return Math.sqrt(width * width + height * height);
    const sx = ((clip[0] * x + clip[4] * y + clip[8] * z + clip[12]) / cw + 1) * width / 2;
    const sy = ((clip[1] * x + clip[5] * y + clip[9] * z + clip[13]) / cw + 1) * height / 2;
    const k = Math.max(0, Math.min(1, ((sx - ax) * dx + (sy - ay) * dy) / length2));
    const ox = sx - ax - dx * k, oy = sy - ay - dy * k;
    radius = Math.max(radius, Math.sqrt(ox * ox + oy * oy));
  }
  // The half-resolution bloom's two short kernels and bilinear footprint stay outside it.
  return radius + PADDLE_SOURCE.FILTER_PAD;
}

const BED_GUARD = `
  uniform vec4 uBedA, uBedB;
  float bedTransmission() {
    vec2 pa = gl_FragCoord.xy - uBedA.xy, ba = uBedB.xy - uBedA.xy;
    float k = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-4), 0.0, 1.0);
    float fade = smoothstep(uBedA.z, uBedA.z + uBedA.w, length(pa - ba * k));
    return mix(1.0, fade, uBedB.z);
  }
`;

function replaceOnce(source, anchor, replacement) {
  if (source.split(anchor).length !== 2) throw new Error('Kiln bed requires the pinned basic shader');
  return source.replace(anchor, replacement);
}

/** Own fixed upload buffers across recompiles; normal blending applies this alpha once. */
export function protectBed(material) {
  const uniforms = {
    uBedA: { value: new Float32Array([0, 0, 1, 1]) },
    uBedB: { value: new Float32Array(4) },
  };
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = replaceOnce(shader.fragmentShader, 'void main() {', BED_GUARD + '\nvoid main() {');
    shader.fragmentShader = replaceOnce(shader.fragmentShader, '#include <opaque_fragment>',
      'diffuseColor.a *= bedTransmission();\n#include <opaque_fragment>');
  };
  material.customProgramCacheKey = () => 'kiln-bed-source-guard';
  return {
    uniforms,
    set(ax, ay, bx, by, radius, feather, enabled) {
      const a = uniforms.uBedA.value, b = uniforms.uBedB.value;
      a[0] = ax; a[1] = ay; a[2] = radius; a[3] = Math.max(1, feather);
      b[0] = bx; b[1] = by; b[2] = enabled ? 1 : 0;
    },
    clear() { uniforms.uBedB.value[2] = 0; },
  };
}
