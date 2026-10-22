#!/usr/bin/env python3
"""Ember headroom plate, round 2 (ART 15.4 R9, the style anchor). Written by R (art refinement);
versioned in tools/art by F at R's request (2026-10-22), unchanged but for this header.

  python3 tools/art/refine_plate.py <high.png> <glass.png> <worktree> <review_dir>

<high.png>  gpt-image-2 high final (ribs and seam come from it).
<glass.png> one medium edit_image pass of the high final (smoked glass panels come from it; its
            ribs and seam sit on the same pixels, measured shift 0).
Writes <worktree>/img/headroom/ember.webp and ember_glow.png, the lossless graded plate to
<worktree>/assets/generated/ember-graded.png, and checks to <review_dir>/ember-checks.txt.

Grade (round 2, from the critic's notes):
  - ribs: hue neutralised to titanium #C0C4CA, the painted luminance structure kept and mapped
    onto a face of about .10 to .16 sRGB with 1 to 2 px edge highlights up to .28; the seam's warm
    light stays on the metal within about 15 px of it;
  - glass: the medium pass's smoked panels (curvature, sheen toward the top, the seam's light on
    the glass); saturation capped by brightness (dim glass is warm grey, never brown); darks lean to
    base #0F0D0C, the sheen to titanium's cool neutral;
  - seam: one continuous tone curve (no edge between seam and glass); heat-low orange body at
    saturation <= .70, heat-high only on the 1 to 2 px core over the central 30%; core peak about
    .45 linear at the crown, dimmer toward the ends; outside the outer rib junctions a dim line;
  - fade: one long ramp from row .30 to .46 on everything (no rib termination line); G multiplied
    by the same ramp;
  - off-emitter soft cap .26 sRGB before encoding (<= .30 decoded).
Mask: R = threshold (lum > .5 and (sat > .35 or lum > .8)) on the decoded plate, regions under
40 px dropped, rib mask subtracted, closed r6, ribs subtracted again, weighted crown 1.0 to ends
.6, times R_GAIN (the in-game brightness calibration, see the status file). G = Sobel of luminance,
85th percentile, dilate 2, blur, times the fade ramp. B = 0.
Needs numpy, Pillow, cwebp/dwebp. No network, no API calls.
"""
import os
import subprocess
import sys
from collections import deque

import numpy as np
from PIL import Image, ImageFilter

SRC_H, SRC_G, WT, REV = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
W, H = 1024, 1536
GW, GH = 512, 768
LUM = np.array([0.2126, 0.7152, 0.0722], np.float32)
HEAT_HI_HUE = 33.8           # hue of #FFD9A8
HEAT_HI_SAT = 0.34           # saturation of #FFD9A8
BODY_HUE = 25.5              # heat-low #FF7A1A is 25.2
SAT_BODY = float(os.environ.get('SAT_BODY', '0.64'))   # hot saturation before encoding (WebP adds ~.06)
SAT_HALO = 0.56              # the halo and the glass (brief: <= .60 decoded)
CORE_SRGB = float(os.environ.get('CORE_SRGB', '0.68'))  # crown core luminance, sRGB (.70 = .45 linear)
R_GAIN = float(os.environ.get('R_GAIN', '0.30'))
OFF_CAP = 0.26               # off-emitter soft cap before encoding (brief: .30 decoded)
BASE = np.array([15, 13, 12], np.float32) / 255       # #0F0D0C
TITANIUM = np.array([192, 196, 202], np.float32) / 255  # #C0C4CA
TEMP = os.path.join(WT, 'assets', 'generated')


def lin(c):
    return np.where(c <= 0.04045, c / 12.92, ((np.maximum(c, 0) + 0.055) / 1.055) ** 2.4)


def enc(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def hsv(a):
    v = a.max(-1)
    mn = a.min(-1)
    s = (v - mn) / np.maximum(v, 1e-5)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    dd = np.maximum(v - mn, 1e-5)
    h = np.where(v == r, (g - b) / dd % 6, np.where(v == g, (b - r) / dd + 2, (r - g) / dd + 4)) * 60
    return h, s, v


def rgb_from_hsv(h, s, v):
    c = v * s
    hp = (h % 360) / 60
    x = c * (1 - np.abs(hp % 2 - 1))
    z = np.zeros_like(c)
    conds = [hp < 1, hp < 2, hp < 3, hp < 4, hp < 5, hp >= 5]
    rgbs = [(c, x, z), (x, c, z), (z, c, x), (z, x, c), (x, z, c), (c, z, x)]
    out = np.zeros(h.shape + (3,), np.float32)
    done = np.zeros(h.shape, bool)
    for cond, (r, g, b) in zip(conds, rgbs):
        m = cond & ~done
        out[m] = np.stack([r[m], g[m], b[m]], -1)
        done |= m
    return out + (v - c)[..., None]


def img(a):
    return Image.fromarray((np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8))


def arr(im):
    return np.asarray(im).astype(np.float32) / 255


def maxf(m, size):
    return arr(img(m).filter(ImageFilter.MaxFilter(size)))


def blur(a, s):
    """Separable Gaussian blur of a float map (sigma s px, edges clamped)."""
    r = max(1, int(np.ceil(3 * s)))
    k = np.exp(-0.5 * (np.arange(-r, r + 1) / s) ** 2)
    k /= k.sum()
    a = np.asarray(a, np.float32)
    p = np.pad(a, ((0, 0), (r, r)), mode='edge')
    a = sum(k[i] * p[:, i:i + a.shape[1]] for i in range(2 * r + 1))
    p = np.pad(a, ((r, r), (0, 0)), mode='edge')
    return sum(k[i] * p[i:i + a.shape[0]] for i in range(2 * r + 1))


def disk_morph(m, r, op):
    out = np.zeros_like(m) if op == 'dilate' else np.ones_like(m)
    pad = np.pad(m, r, constant_values=(op == 'erode'))
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            if dx * dx + dy * dy > r * r:
                continue
            s = pad[r + dy:r + dy + m.shape[0], r + dx:r + dx + m.shape[1]]
            out = (out | s) if op == 'dilate' else (out & s)
    return out


def label(m):
    lab = np.zeros(m.shape, np.int32)
    n = 0
    hh, ww = m.shape
    for y0, x0 in zip(*np.nonzero(m)):
        if lab[y0, x0]:
            continue
        n += 1
        q = deque([(y0, x0)])
        lab[y0, x0] = n
        while q:
            y, x = q.popleft()
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    yy, xx = y + dy, x + dx
                    if 0 <= yy < hh and 0 <= xx < ww and m[yy, xx] and not lab[yy, xx]:
                        lab[yy, xx] = n
                        q.append((yy, xx))
    return lab, n


def load(p):
    return arr(Image.open(p).convert('RGB').resize((W, H), Image.LANCZOS))


# ---------------------------------------------------------------- sources, seam curve, rib mask
hi = load(SRC_H)
gl = load(SRC_G)
Hh, S0, V0 = hsv(hi)
Y0 = hi @ LUM
xs = np.arange(W)
score = np.where(S0 > 0.4, Y0, 0)
rows = score[150:520].argmax(0) + 150
ok = score[150:520].max(0) > 0.5
co = np.polyfit(xs[ok], rows[ok], 4)
for _ in range(3):
    keep = ok & (np.abs(rows - np.polyval(co, xs)) < 6)
    co = np.polyfit(xs[keep], rows[keep], 4)
seam_r = np.polyval(co, xs)
seam_dr = np.polyval(np.polyder(co), xs)
YY, XX = np.mgrid[0:H, 0:W]
D = (YY - seam_r[None, :]) / np.sqrt(1 + seam_dr[None, :] ** 2)   # signed px from the seam
AD = np.abs(D)

neutral = arr(img((S0 < 0.32) & (V0 > 0.12)).filter(ImageFilter.MedianFilter(3))) > 0.5
stubs = neutral & (AD > 26) & (AD < 95)
lab, n = label(stubs)
ext = np.zeros((H, W), bool)
for i in range(1, n + 1):
    ys, xq = np.nonzero(lab == i)
    if len(ys) < 250 or AD[ys, xq].min() > 34:
        continue
    P = np.stack([xq, ys], 1).astype(np.float64)
    c = P.mean(0)
    _, _, vt = np.linalg.svd(P - c, full_matrices=False)
    hw = np.percentile(np.abs((P - c) @ vt[1]), 97) + 1.5
    x0, x1 = max(0, xq.min() - 80), min(W, xq.max() + 80)
    y0, y1 = max(0, ys.min() - 140), min(H, ys.max() + 140)
    sub = np.stack([XX[y0:y1, x0:x1] - c[0], YY[y0:y1, x0:x1] - c[1]], -1)
    side = np.sign(np.median(D[ys, xq]))
    dd = D[y0:y1, x0:x1] * side
    ext[y0:y1, x0:x1] |= (np.abs(sub @ vt[1]) <= hw) & (dd <= 34) & (dd >= -4)
rib_core = (neutral & (AD > 6)) | ext
rib = maxf(rib_core, 5) > 0.5                          # glow mask: never on metal (2 px margin)
rib_cut = maxf(rib_core, 3) > 0.5                      # the rib's own pixels (1 px margin)
rib_soft = np.clip(blur(rib_cut.astype(np.float32), 0.8), 0, 1)

# composite: ribs and the seam band from the high final, the glass from the medium pass
take_hi = np.maximum(np.clip(blur((maxf(rib_core, 5) > 0.5).astype(np.float32), 1.0), 0, 1),
                     1 - smooth(7, 14, AD))[..., None]
src = hi * take_hi + gl * (1 - take_hi)
Hs, Ss, Vs = hsv(src)
Ls = src @ LUM                                         # sRGB-weighted luminance (painted)

# ---------------------------------------------------------------- tone: one curve off the metal
ax = np.abs(XX / (W - 1) - 0.5)
yn = YY / (H - 1)
# seam brightness along x: brightest at the crown, dimmer toward the outer rib junctions, a dim
# line beyond them (emitters stay inside the centre 70%)
on_seam = rib & (AD < 3)
cols = np.nonzero(on_seam.any(0))[0]
left_rib = cols[(cols < 0.25 * W) & (cols > 0.05 * W)]
right_rib = cols[(cols > 0.75 * W) & (cols < 0.95 * W)]
xl_in = max(left_rib.max() + 6 if len(left_rib) else 0, 0.15 * W + 6)
xr_in = min(right_rib.min() - 6 if len(right_rib) else W, 0.85 * W - 6)
inside = smooth(xl_in - 8, xl_in, XX) * (1 - smooth(xr_in, xr_in + 8, XX))
crown = 1 - smooth(0.05, 0.33, ax)
env = 0.16 + 0.84 * inside                             # full between the outer junctions, .16 beyond
seam_w = 1 - smooth(26, 60, AD)                         # the seam's light reaches ~60 px


def tone(x):
    """sRGB luminance -> sRGB luminance: .8x + .006 up to .30, then a shoulder that lifts the
    seam's body (painted .6 -> .52, .75 -> .61) and tops out at CORE_SRGB."""
    t = np.clip((x - 0.30) / 0.70, 0, 1)
    sh = 0.246 + (CORE_SRGB - 0.246) * (1 - (1 - t) ** 1.6)
    return np.where(x <= 0.30, 0.8 * x + 0.006, sh)


Lt = tone(Ls)
# the seam's light (above the local glass level) follows the x envelope; the glass does not
glass_lvl = tone(np.minimum(Ls, 0.16))
Lt = glass_lvl + (Lt - glass_lvl) * (1 - (1 - env) * seam_w)
# the white-hot core peaks only over the central 30%; elsewhere it sits just above the body
crown30 = 1 - smooth(0.10, 0.20, ax)
Lt = np.minimum(Lt, 0.60 + (CORE_SRGB - 0.60) * crown30)
# the smoked glass away from the seam's light: the painted sheen kept at PANEL_K of its contrast
# over a dark glass level, so the panels vary by about .03 to .08 (never a grey wash)
PANEL_D0, PANEL_K = 0.045, float(os.environ.get('PANEL_K', '0.55'))
wp = smooth(25, 60, AD)
Lt = np.where(Lt > PANEL_D0, Lt * (1 - wp) + (PANEL_D0 + (Lt - PANEL_D0) * PANEL_K) * wp, Lt)

# ---------------------------------------------------------------- colour off the metal
core = smooth(0.80, 0.95, Y0) * (1 - smooth(1.5, 3.0, AD)) * take_hi[..., 0]   # the 1-2 px core
k_hi = core * (1 - smooth(0.10, 0.155, ax))            # heat-high only over the central 30%
warm_src = ((Hs < 70) | (Hs > 300)) & (Ss > 0.12)
hue = np.where(Hs > 300, Hs - 360, Hs)
hue = np.where(warm_src, np.clip(hue, 22.0, 36.0), Hs)
# near the seam the hot pixels sit on the heat axis; beyond 12 px only the bright light does
near = 1 - smooth(9, 12, AD)
on_axis = np.maximum(near, smooth(0.12, 0.18, Vs) * warm_src)
hue = hue * (1 - on_axis) + (BODY_HUE + (HEAT_HI_HUE - BODY_HUE) * k_hi) * on_axis
# saturation is capped by brightness: dim glass is warm grey, the halo <= .60, the body <= SAT_BODY
cap = 0.22 + (SAT_HALO - 0.22) * smooth(0.05, 0.30, Lt)
cap = cap + (SAT_BODY - SAT_HALO) * smooth(0.40, 0.50, Lt) * (1 - smooth(9, 12, AD))
sat = np.minimum(Ss, cap) * (1 - near) + cap * near   # the seam band sits on the heat axis
sat = sat + (HEAT_HI_SAT - sat) * k_hi
# neutral glass: darks toward base (warm), the sheen toward titanium's cool neutral
lin_base = lin(BASE)
lin_ti = lin(TITANIUM)
r_base = lin_base / (lin_base @ LUM)
r_ti = lin_ti / (lin_ti @ LUM)
r_neu = r_base + (r_ti - r_base) * smooth(0.05, 0.14, Lt)[..., None]
col_src = rgb_from_hsv(hue, sat, np.ones_like(hue))
cl = lin(col_src)
r_src = cl / np.maximum(cl @ LUM, 1e-5)[..., None]
w_src = np.maximum(smooth(0.12, 0.30, Ss) * warm_src, on_axis)[..., None]
ratio = r_src * w_src + r_neu * (1 - w_src)
glass_lin = ratio * lin(Lt)[..., None]

# ---------------------------------------------------------------- ribs: titanium, painted structure
Lr = 0.345 * (1 - np.exp(-Ls / 0.7))                    # face .10-.15, edge highlights <= .27
warm_keep = (1 - smooth(5, 16, AD))[..., None]
rs = lin(src)
r_rib_src = rs / np.maximum(rs @ LUM, 1e-6)[..., None]
r_rib = r_ti * (1 - warm_keep) + r_rib_src * warm_keep
rib_lin = r_rib * lin(Lr)[..., None]
rs_ = rib_soft[..., None]
out_lin = rib_lin * rs_ + glass_lin * (1 - rs_)

# ---------------------------------------------------------------- falloff and floor
gain_top = 0.82 + 0.18 * smooth(0.0, 0.14, yn)
gain_low = 1 - smooth(0.30, 0.46, yn)                   # one long ramp: no rib termination line
gain = (gain_top * gain_low)[..., None]
out_lin = out_lin * gain + lin_base * 0.7 * (1 - gain * 0.5)

# off-emitter soft cap beyond the seam core
Yo = np.maximum(out_lin @ LUM, 1e-7)
lo = enc(Yo)
c0 = OFF_CAP - 0.05
capped = np.where(lo < c0, lo, c0 + 0.05 * (1 - np.exp(-(lo - c0) / 0.05)))
cap_w = smooth(5, 8, AD) + (1 - smooth(5, 8, AD)) * (1 - inside)
lo2 = lo * (1 - cap_w) + capped * cap_w
out_lin = out_lin * (lin(lo2) / Yo)[..., None]
out = enc(out_lin)

# final guards: nothing whiter than heat-high; hot pixels within the saturation budget
oh, os_, ov = hsv(out)
luma_o = out @ LUM
hot = luma_o > 0.40
os_ = np.where(hot & (os_ > SAT_BODY), SAT_BODY, os_)
ov = np.minimum(ov, 1.0)
out = np.clip(rgb_from_hsv(oh, os_, ov), 0, 1)

# ---------------------------------------------------------------- export plate
os.makedirs(os.path.join(WT, 'img', 'headroom'), exist_ok=True)
png_tmp = os.path.join(TEMP, 'ember-graded.png')
img(out).save(png_tmp)
dst = os.path.join(WT, 'img', 'headroom', 'ember.webp')
subprocess.run(['cwebp', '-quiet', '-q', '85', '-m', '6', '-sharp_yuv', '-metadata', 'none',
                png_tmp, '-o', dst], check=True)
dec_tmp = os.path.join(TEMP, 'ember-decoded.png')
subprocess.run(['dwebp', '-quiet', dst, '-o', dec_tmp], check=True)
dec = arr(Image.open(dec_tmp).convert('RGB'))


# ---------------------------------------------------------------- glow mask
def emitters(a):
    _, s, _ = hsv(a)
    lum = a @ LUM
    return (lum > 0.5) & ((s > 0.35) | (lum > 0.8))


E_full = emitters(dec)
E = E_full.reshape(GH, 2, GW, 2).any((1, 3))
labg, ng = label(E)
sizes = np.bincount(labg.ravel())
small = np.isin(labg, np.nonzero(sizes < 40)[0]) & E
E = E & ~small
rib_g = rib.reshape(GH, 2, GW, 2).mean((1, 3)) > 0.25
rib_g_d = disk_morph(rib_g, 1, 'dilate')
R = E & ~rib_g_d
R = disk_morph(disk_morph(R, 6, 'dilate'), 6, 'erode')
R = R & ~rib_g_d
gx = (np.arange(GW) + 0.5) / GW
weight = 0.6 + 0.4 * (1 - smooth(0.04, 0.33, np.abs(gx - 0.5)))[None, :]
Rf = np.clip(blur(R * weight, 1.0), 0, 1) * (1 - rib_g_d) * R_GAIN
# G: structure of the graded plate before the fade, times the same fade (no ghost ribs below it)
struct_lin = out_lin / np.maximum(gain, 1e-3)
struct = enc(np.clip(struct_lin, 0, 1)) @ LUM
sg = arr(img(struct).resize((GW, GH), Image.LANCZOS))
kx = np.array([[-1, 0, 1], [-2, 0, 2], [-1, 0, 1]], np.float32)
pad = np.pad(sg, 1, mode='edge')
gxs = sum(kx[j, i] * pad[j:j + GH, i:i + GW] for j in range(3) for i in range(3))
gys = sum(kx.T[j, i] * pad[j:j + GH, i:i + GW] for j in range(3) for i in range(3))
mag = np.hypot(gxs, gys)
thr = np.percentile(mag, 85)
Gm = disk_morph(mag > thr, 2, 'dilate')
G_BLUR = float(os.environ.get('G_BLUR', '1.5'))
Gf = np.clip(blur(Gm.astype(np.float32), G_BLUR), 0, 1)
gyn = (np.arange(GH) + 0.5) / GH
Gf = Gf * (1 - smooth(0.30, 0.46, gyn))[:, None]
glow = np.stack([Rf, Gf, np.zeros_like(Rf)], -1)
glow_dst = os.path.join(WT, 'img', 'headroom', 'ember_glow.png')
g8 = np.round(glow * 255).astype(np.int32)
for levels in (256, 64, 32, 16):        # quantise G only as far as the 30 KB budget needs
    q = g8.copy()
    if levels < 256:
        step = 256 // levels
        q[..., 1] = np.where(q[..., 1] > 0, np.clip((q[..., 1] // step) * step + step // 2, 0, 255), 0)
    Image.fromarray(q.astype(np.uint8), 'RGB').save(glow_dst, optimize=True)
    if os.path.getsize(glow_dst) <= 30720:
        break
G_LEVELS = levels

# ---------------------------------------------------------------- checks
lum_dec = dec @ LUM
_, s_dec, v_dec = hsv(dec)
lin_y = lin(dec) @ LUM
E_d = E_full
E_near = maxf(E_d, 13) > 0.5
ys_e, xs_e = np.nonzero(E_d)
below = int(0.40 * H)
lb = lin_y[below:]
lbl = Image.fromarray(np.clip(lb * 4096, 0, 65535).astype(np.int32), 'I')
win = (np.asarray(lbl.filter(ImageFilter.MaxFilter(5))).astype(np.float32) -
       np.asarray(lbl.filter(ImageFilter.MinFilter(5))).astype(np.float32)) / 4096
hs_ = hsv(dec[E_d])[1] if E_d.any() else np.zeros(1)
hi_lum = (np.array([255, 217, 168]) / 255) @ LUM
ribm = rib_cut & (yn < 0.28) & (AD > 20)
rib_l = lum_dec[ribm]
halo = (~rib) & (AD > 12) & (AD < 90) & (yn < 0.36)
_, s_halo, _ = hsv(dec[halo])
dim_warm = halo & (lum_dec < 0.12)
_, s_dw, _ = hsv(dec[dim_warm]) if dim_warm.any() else (None, np.zeros(1), None)
panel = (~rib) & (AD > 90) & (yn < 0.28)
lines = [
    f'sources {os.path.basename(SRC_H)} (ribs, seam) + {os.path.basename(SRC_G)} (glass)',
    f'ember.webp {os.path.getsize(dst)} bytes (<= 143360), ember_glow.png {os.path.getsize(glow_dst)} bytes (<= 30720)',
    f'emitters {E_d.mean() * 100:.2f}% of the plate (<= 2%)',
    f'emitter rows {ys_e.min() / H:.3f}..{ys_e.max() / H:.3f} (in .10..35), columns {xs_e.min() / W:.3f}..{xs_e.max() / W:.3f} (in .15..85)',
    f'off-emitter (beyond 6 px of an emitter) max sRGB luminance {lum_dec[~E_near].max():.3f} (<= .30); p99.9 {np.percentile(lum_dec[~E_near], 99.9):.3f}',
    f'hot saturation: emitters max {hs_.max():.3f} p99.9 {np.percentile(hs_, 99.9):.3f} (<= .75); luma > .4 max {s_dec[lum_dec > 0.4].max():.3f}, pixels over .75: {int(((lum_dec > 0.4) & (s_dec > 0.75)).sum())}',
    f'peak sRGB luminance {lum_dec.max():.3f} vs heat-high {hi_lum:.3f}; peak linear luminance {lin_y.max():.3f} (target about .45)',
    f'max channels on the plate {np.round(dec.reshape(-1, 3).max(0) * 255).astype(int).tolist()} (heat-high [255, 217, 168])',
    f'ribs above row .28 (sRGB luminance): p50 {np.percentile(rib_l, 50):.3f} p90 {np.percentile(rib_l, 90):.3f} p99.5 {np.percentile(rib_l, 99.5):.3f} max {rib_l.max():.3f} (face .10-.18, edge <= .28)',
    f'halo 12-90 px from the seam: saturation p99 {np.percentile(s_halo, 99):.3f} (<= .60); dim warm pixels (lum < .12) saturation p99 {np.percentile(s_dw, 99):.3f}',
    f'glass panels above row .28 (beyond 90 px of the seam): sRGB luminance p5 {np.percentile(lum_dec[panel], 5):.3f} p50 {np.percentile(lum_dec[panel], 50):.3f} p95 {np.percentile(lum_dec[panel], 95):.3f}',
    f'below row .40: linear mean {lb.mean():.4f} (<= .01), max 5 px local contrast {win.max():.4f} (<= .04)',
    f'mean sRGB luminance by band: ' + ', '.join(f'{r0:.2f}-{r1:.2f} {lum_dec[int(r0 * H):int(r1 * H)].mean():.3f}' for r0, r1 in [(0, .1), (.1, .2), (.2, .3), (.3, .35), (.35, .4), (.4, .46), (.46, .7), (.7, 1)]),
    f'glow R: peak {Rf.max():.3f} (R_GAIN {R_GAIN}), {(Rf > 0.1).mean() * 100:.2f}% of the mask above .1; R on ribs (dilated rib mask) max {Rf[rib_g].max() if rib_g.any() else 0:.3f}',
    f'glow G: {(Gf > 0.1).mean() * 100:.1f}% above .1; below row .46 max {Gf[int(.46 * GH):].max():.3f}; Sobel 85th percentile {thr:.4f}; G levels {G_LEVELS}, blur sigma {G_BLUR}',
    f'SAT_BODY {SAT_BODY}, CORE_SRGB {CORE_SRGB}, seam bright between x {xl_in / W:.3f} and {xr_in / W:.3f}',
    f'seam rows: x=0 {seam_r[0] / H:.3f}, x=.15 {seam_r[int(.15 * W)] / H:.3f}, crown {seam_r.max() / H:.3f}, x=.85 {seam_r[int(.85 * W)] / H:.3f}, x=1 {seam_r[-1] / H:.3f}',
]
os.makedirs(REV, exist_ok=True)
with open(os.path.join(REV, 'ember-checks.txt'), 'w') as f:
    f.write('\n'.join(lines) + '\n')
print('\n'.join(lines))
np.save(os.path.join(TEMP, 'ember-rib-mask.npy'), rib)
