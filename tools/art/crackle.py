#!/usr/bin/env python3
"""R1 brick textures (ART.md 15.4 R1): the vein mask, the dark glaze and the glaze normal.

  python3 tools/art/crackle.py <out_dir> [take] [seed] [primary_max] [hair_peak] [draft|final] [hair_max] [spurs] [roll]

The shipped set (R1 refined, October 27, 2026):
  python3 tools/art/crackle.py assets/generated/r1/rg craze 23 250 1.0 final 100 0 144,8
then crackle_mask.png = craze_mask.png as is; crackle_n.png through resample.py at 512 (normal).
crackle.png (the glaze) is the first R1 set's: it does not depend on the veins.

take: craze (default), ice, grow or joints. primary_max: the largest primary cell (equivalent
diameter, px) before hairlines split it; hair_max: the largest cell after them; spurs: the share
of cells that get a hairline stopping inside them (0 ships: at brick size a free end is a speck).
Writes, all seamless at 1024:
  <take>_mask.png    RGB, linear, two masks: R the primary veins as anti-aliased lines, 0.5 at the
                     vein edge (C9 thresholds R at .5); G the hairlines as a soft value (a raised
                     cosine, 1 on the line, 0.5 at 1.5 px, 0 at 3 px; C9 weights it and fades it
                     out with distance, never thresholds it); B 0
  <take>_glaze.png   sRGB: the dark glaze, no veins and no weave (the brick face samples it at 0..1)
  <take>_n.png       normal, OpenGL +Y: the glaze with the veins as shallow grooves, aligned with the mask
  <take>_veins.json  the vein polylines (for the per-core vein count)
Ship with tools/art/resample.py: the mask stays 1024, glaze and normal go to 512.

Every junction is a T: a crack stops at an older one. A crack whose end would land within a vein's
clearance of an older junction (which reads as an X or a crossing at brick size) is regrown from a
shifted start; a hairline that cannot avoid one is dropped.

Why procedural: the mask is data with exact numbers (cells 70 to 100 px, primary veins 6 to 8 px,
hairlines 3 px, seamless), so it is built on a torus and is seamless by construction.

Takes:
  craze   glaze crazing. Each new crack splits the largest open area across its short side, so the
          cells stay even, and it bends to meet the older crack square on (T junctions), as real
          crazing forms. Earlier cracks are wider. Primaries leave cells of about 165 px (2 to 4
          primary veins on a core); hairlines split those into 70 to 100 px cells.
  ice     the same splitting with straight cracks and wider angles: angular shards.
  grow    free crazing: cracks branch off older ones at random, so cells vary a lot.
  joints  cooling joints: an even cell pattern with three-way junctions (relaxed Voronoi, warped).
"""
import json
import math
import os
import sys

import numpy as np
from PIL import Image

N = 1024          # mask size
G = 256           # coarse grid for finding open areas (4 px a cell)
S = N // G


def wrapd(d):
    """Shortest signed difference on the torus."""
    return (d + N / 2) % N - N / 2


# ------------------------------------------------------------------ distance on the torus (coarse)
_IDX = np.arange(G)
_DX = np.abs(_IDX[:, None] - _IDX[None, :])
_DX2 = np.minimum(_DX, G - _DX).astype(np.float32) ** 2


def edt_torus(occ):
    """Exact Euclidean distance (in coarse px) to the nearest occupied cell, wrapping."""
    o3 = np.concatenate([occ, occ, occ], axis=0)
    ar = np.arange(3 * G)[:, None].repeat(G, 1)
    last = np.maximum.accumulate(np.where(o3, ar, -10 ** 7), axis=0)
    nxt = np.minimum.accumulate(np.where(o3, ar, 10 ** 7)[::-1], axis=0)[::-1]
    d = np.minimum(ar - last, nxt - ar)[G:2 * G].astype(np.float32)
    d2 = np.minimum(d, 4 * G) ** 2
    out = np.empty((G, G), np.float32)
    for y0 in range(0, G, 32):
        out[y0:y0 + 32] = (d2[y0:y0 + 32][:, None, :] + _DX2[None, :, :]).min(axis=2)
    return np.sqrt(out)


def bilinear(a, x, y):
    """Sample a periodic G x G array at coarse coordinates."""
    x0, y0 = math.floor(x), math.floor(y)
    fx, fy = x - x0, y - y0
    x0 %= G
    y0 %= G
    x1, y1 = (x0 + 1) % G, (y0 + 1) % G
    return (a[y0, x0] * (1 - fx) * (1 - fy) + a[y0, x1] * fx * (1 - fy)
            + a[y1, x0] * (1 - fx) * fy + a[y1, x1] * fx * fy)


# ------------------------------------------------------------------ the crack network
class Net:
    R = 24  # reach of the fine distance field (px)

    def __init__(self, rng):
        self.rng = rng
        self.df = np.full((N, N), float(self.R), np.float32)   # fine distance to cracks, capped
        self.occ = np.zeros((G, G), bool)                       # coarse occupancy
        self.cracks = []
        self.joins = []     # (x, y, tier): where a crack end met an older crack
        self.dropped = 0    # hairlines left out because every try made an X
        k = np.arange(-self.R, self.R + 1)
        self.stamp = np.sqrt(k[None, :] ** 2 + k[:, None] ** 2).astype(np.float32)
        self.k = k

    def fine(self, x, y):
        x0, y0 = math.floor(x), math.floor(y)
        fx, fy = x - x0, y - y0
        a = self.df
        x0 %= N
        y0 %= N
        x1, y1 = (x0 + 1) % N, (y0 + 1) % N
        return (a[y0, x0] * (1 - fx) * (1 - fy) + a[y0, x1] * fx * (1 - fy)
                + a[y1, x0] * (1 - fx) * fy + a[y1, x1] * fx * fy)

    def toward(self, x, y):
        """Unit vector toward the nearest crack (down the fine distance field)."""
        gx = self.fine(x + 1, y) - self.fine(x - 1, y)
        gy = self.fine(x, y + 1) - self.fine(x, y - 1)
        n = math.hypot(gx, gy)
        if n < 1e-6:
            return None
        return -gx / n, -gy / n

    # clearance (px) a new junction keeps from an older one: closer than this, two T junctions on
    # either side of a vein read as an X at brick size
    GAP = {1: 20.0, 2: 13.0}

    def clearance(self, pts, free, tier):
        """Smallest (distance - needed gap) from this crack's met ends to the older junctions.
        Negative means the crack would make an X (or a crowded fan) with an older junction."""
        best = float('inf')
        if not self.joins:
            return best
        J = np.asarray(self.joins, np.float64)
        for e, p in ((0, pts[0]), (1, pts[-1])):
            if free[e]:
                continue
            d = np.hypot(wrapd(J[:, 0] - p[0]), wrapd(J[:, 1] - p[1]))
            gap = np.where((J[:, 2] == 1) | (tier == 1), self.GAP[1], self.GAP[2])
            best = min(best, float((d - gap).min()))
        return best

    def add(self, pts, tier, width, free_ends, order):
        pts = np.asarray(pts, np.float32)
        self.cracks.append({'pts': pts, 'tier': tier, 'w': width, 'free': free_ends, 'order': order})
        for e, p in ((0, pts[0]), (1, pts[-1])):
            if not free_ends[e]:
                self.joins.append((float(p[0]) % N, float(p[1]) % N, tier))
        self.draw(pts)

    def draw(self, pts):
        """Write a polyline into the distance field and the coarse occupancy."""
        pts = np.asarray(pts, np.float32)
        # densify to 1 px for the fields
        dense = [pts[0]]
        for a, b in zip(pts[:-1], pts[1:]):
            n = max(1, int(math.ceil(float(np.hypot(*(b - a))))))
            for t in range(1, n + 1):
                dense.append(a + (b - a) * t / n)
        dense = np.asarray(dense)
        for x, y in dense[::1]:
            ix, iy = int(round(x)) % N, int(round(y)) % N
            fx, fy = x - round(x), y - round(y)
            cols = (ix + self.k) % N
            rows = (iy + self.k) % N
            st = np.sqrt((self.k[None, :] - fx) ** 2 + (self.k[:, None] - fy) ** 2).astype(np.float32)
            sub = self.df[np.ix_(rows, cols)]
            self.df[np.ix_(rows, cols)] = np.minimum(sub, st)
        for x, y in dense[::2]:
            self.occ[int(y // S) % G, int(x // S) % G] = True

    def grow(self, x, y, ang, opts, own=None, head=0):
        """Grow one end from (x, y) heading `ang` until it meets a crack. Returns (points, met)."""
        rng = self.rng
        pts = [(x, y)]
        omega = 0.0
        base = ang
        step = 1.0
        approach = opts.get('approach', 16.0)
        snap = opts.get('snap', 2.5)
        free_steps = opts.get('free_steps', 0)
        for i in range(opts.get('max_len', 1400)):
            omega = omega * 0.94 + rng.normal(0, opts.get('wander', 0.006))
            ang += omega
            # Only a crack ahead (or beside) counts: the crack this one grew from is behind it.
            d = self.fine(x, y)
            t = self.toward(x, y) if d < approach else None
            dot = (math.cos(ang) * t[0] + math.sin(ang) * t[1]) if t is not None else -1.0
            if t is not None and i > free_steps and d < snap and dot > -0.3:
                x += t[0] * d
                y += t[1] * d
                pts.append((x, y))
                return pts, True
            if t is not None and i > max(2, free_steps) and dot > -0.1:
                # bend to meet it square on, as a crack does when it runs into an older one
                target = math.atan2(t[1], t[0])
                w = opts.get('square', 0.18) * (1 - d / approach) ** 1.5
                ang += w * math.atan2(math.sin(target - ang), math.cos(target - ang))
            else:
                ang += opts.get('hold', 0.015) * math.atan2(math.sin(base - ang), math.cos(base - ang))
            x += step * math.cos(ang)
            y += step * math.sin(ang)
            # self contact (long first cracks that wrap the torus)
            if own is not None and len(own) > head + 60 and i % 2 == 0:
                o = np.asarray(own[head:-50])
                dd = np.hypot(wrapd(o[:, 0] - x), wrapd(o[:, 1] - y))
                j = int(np.argmin(dd))
                if dd[j] < snap or (head == 0 and j < 40 and dd[j] < 3 * snap):
                    # back near its own start: close the loop on the start itself (no stub)
                    tx, ty = (pts[0] if head == 0 and j < 40 else o[j])
                    x = x + wrapd(tx - x)
                    y = y + wrapd(ty - y)
                    pts.append((x, y))
                    return pts, True
            if opts.get('straight') and i % opts['straight'] == 0 and i > 0:
                pts.append((x, y))
            elif not opts.get('straight') and i % 3 == 0:
                pts.append((x, y))
            if own is not None:
                own.append((x, y))
        pts.append((x, y))
        return pts, False

    def trace(self, x, y, ang, opts, ends=2):
        own = [] if opts.get('self') else None
        a, met_a = self.grow(x, y, ang, opts, own)
        if ends == 2:
            b, met_b = self.grow(x, y, ang + math.pi, opts, own, head=60)
            pts = b[::-1] + a[1:]
            free = (not met_b, not met_a)
        else:
            pts = a
            free = (False, not met_a)
        p = np.asarray(pts)
        length = float(np.hypot(*(p[1:] - p[:-1]).T).sum()) if len(p) >= 2 else 0.0
        return pts, free, length

    def crack(self, x, y, ang, tier, width, opts, order, ends=2, tries=1, drop=False):
        """Grow a crack both ways from (x, y) and add it. With tries > 1, a crack whose end would
        make an X with an older junction is regrown from a start shifted across it (and turned a
        little); the clearest try is kept, or, with drop, none if every try makes an X."""
        best = None
        for k in range(tries):
            if k == 0:
                sx, sy, sa = x, y, ang
            else:
                s = self.rng.uniform(-1, 1) * (6 + 5 * k)
                sx, sy = x - math.sin(ang) * s, y + math.cos(ang) * s
                sa = ang + self.rng.normal(0, 0.05 * k)
                if self.fine(sx, sy) < 6:
                    continue
            pts, free, length = self.trace(sx, sy, sa, opts, ends)
            if length < 6:
                continue
            c = self.clearance(pts, free, tier)
            if best is None or c > best[0]:
                best = (c, pts, free)
            if c >= 0:
                break
        if best is None:
            return None
        c, pts, free = best
        if c < 0 and drop:
            self.dropped += 1
            return None
        self.add(pts, tier, width, free, order)
        return pts

    # -------------------------------------------------- finding the next split
    def largest_open(self, D, pick=1):
        flat = np.argsort(D.ravel())[::-1][:pick * 40]
        cand = []
        for f in flat:
            y, x = divmod(int(f), G)
            if all(abs(wrapd((x - cx) * S)) + abs(wrapd((y - cy) * S)) > 40 for cx, cy in cand):
                cand.append((x, y))
            if len(cand) >= pick:
                break
        return cand[int(self.rng.integers(len(cand)))]

    def nearest_dir(self, cx, cy, D):
        """Unit vector (full px) from coarse (cx, cy) to the nearest occupied coarse cell."""
        r = int(D[cy, cx]) + 2
        ys, xs = np.nonzero(self.occ[np.ix_((cy + np.arange(-r, r + 1)) % G, (cx + np.arange(-r, r + 1)) % G)])
        if len(xs) == 0:
            a = self.rng.uniform(0, 2 * math.pi)
            return math.cos(a), math.sin(a)
        dx, dy = xs - r, ys - r
        j = int(np.argmin(dx * dx + dy * dy))
        n = math.hypot(dx[j], dy[j]) or 1
        return dx[j] / n, dy[j] / n

    def split_point(self, cx, cy, D, ux, uy):
        """Centre the cut along the open area's long side (the ridge of D)."""
        rx, ry = -uy, ux
        d0 = D[cy, cx]
        ends = []
        for sgn in (1, -1):
            t = 0.0
            while t < G / 2:
                t += 0.5
                if bilinear(D, cx + sgn * rx * t, cy + sgn * ry * t) < 0.86 * d0:
                    break
            ends.append(sgn * t)
        mid = (ends[0] + ends[1]) / 2 + self.rng.uniform(-0.12, 0.12) * (ends[0] - ends[1])
        return (cx + rx * mid) * S + S / 2, (cy + ry * mid) * S + S / 2


def build(take, seed, prim_max=170.0):
    rng = np.random.default_rng(seed)
    net = Net(rng)
    if take == 'joints':
        return net, None
    curved = take != 'ice'
    opts = {'wander': 0.0035 if curved else 0.0, 'hold': 0.02 if curved else 0.0,
            'square': 0.18 if take != 'ice' else 0.0, 'approach': 16.0 if take != 'ice' else 4.0,
            'straight': None if curved else 6}
    order = 0
    # 1. the first crack: long and free, it wraps the tile and meets itself
    x, y = rng.uniform(0, N, 2)
    own = []
    pts, met = net.grow(x, y, rng.uniform(0, math.pi), dict(opts, max_len=2600), own)
    p = np.asarray(pts)
    closed = met and math.hypot(wrapd(p[-1, 0] - p[0, 0]), wrapd(p[-1, 1] - p[0, 1])) < 1.0
    net.add(pts, 1, 0, (not closed, not met), order)
    order += 1
    stop = 0.37 * prim_max   # largest open radius (px) left before the cells are refined
    D = None
    failed = []
    for it in range(3000):
        if take != 'grow' or it % 25 == 0:
            D = edt_torus(net.occ) * S
            if D.max() < stop:
                break
        if take == 'grow':
            # branch off a random older crack, roughly square to it, wherever it is
            c = net.cracks[int(rng.integers(len(net.cracks)))]
            p = c['pts']
            j = int(rng.integers(len(p) - 1))
            tx, ty = p[j + 1] - p[j]
            n = math.hypot(tx, ty) or 1
            ang = math.atan2(ty, tx) + (math.pi / 2) * (1 if rng.random() < 0.5 else -1) + rng.normal(0, 0.25)
            sx, sy = p[j] + np.array([math.cos(ang), math.sin(ang)]) * 1.5
            # only start where there is room ahead
            if net.fine(sx + 6 * math.cos(ang), sy + 6 * math.sin(ang)) < 3:
                continue
            net.crack(sx, sy, ang, 1, 0, dict(opts, free_steps=3), order, ends=1)
            order += 1
            if order > 900:
                break
            continue
        Dp = D / S
        for fx, fy in failed:
            Dp[np.ix_((fy + np.arange(-3, 4)) % G, (fx + np.arange(-3, 4)) % G)] = 0
        if Dp.max() * S < stop:
            break
        cx, cy = net.largest_open(Dp, pick=3)
        ux, uy = net.nearest_dir(cx, cy, D / S)
        sx, sy = net.split_point(cx, cy, D / S, ux, uy)
        jit = rng.normal(0, 0.2 if take == 'craze' else 0.38)
        ang = math.atan2(uy, ux) + jit
        if net.crack(sx, sy, ang, 1, 0, opts, order, tries=TRIES) is None:
            failed.append((cx, cy))
        order += 1
    close_ends(net, opts, 1)
    if take != 'grow':
        refine_cells(net, opts, take, prim_max, 1)
    return net, opts


def bfs_unwrap(m, xs, ys):
    """Unwrapped coordinates of a region that reaches across the tile edges (flood fill)."""
    from collections import deque
    U = np.full((G, G), np.nan)
    V = np.full((G, G), np.nan)
    sx, sy = int(xs[0]), int(ys[0])
    U[sy, sx], V[sy, sx] = sx, sy
    q = deque([(sx, sy)])
    while q:
        x, y = q.popleft()
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = (x + dx) % G, (y + dy) % G
            if m[ny, nx] and np.isnan(U[ny, nx]):
                U[ny, nx], V[ny, nx] = U[y, x] + dx, V[y, x] + dy
                q.append((nx, ny))
    return U[ys, xs], V[ys, xs]


def region_stats(lab, i):
    """Area (px^2), centroid (full px) and principal axes of one coarse region, unwrapped."""
    m = lab == i
    ys, xs = np.nonzero(m)
    rx, ry = xs[0], ys[0]
    ux = ((xs - rx + G / 2) % G) - G / 2
    uy = ((ys - ry + G / 2) % G) - G / 2
    if len(xs) > 1500 or np.ptp(ux) > 0.4 * G or np.ptp(uy) > 0.4 * G:
        bx, by = bfs_unwrap(m, xs, ys)
        ux, uy = bx - rx, by - ry
    mx, my = ux.mean(), uy.mean()
    cov = np.cov(np.stack([ux - mx, uy - my])) if len(xs) > 2 else np.eye(2)
    ev, evec = np.linalg.eigh(cov)
    area = len(xs) * S * S
    # the region pixel nearest the centroid (a concave cell's centroid can sit outside it)
    j = int(np.argmin((ux - mx) ** 2 + (uy - my) ** 2))
    cx, cy = (rx + ux[j]) % G, (ry + uy[j]) % G
    return area, (cx, cy), (rx + mx, ry + my), ev, evec


def refine_cells(net, opts, take, most, tier):
    """Split any cell that is too big (equivalent diameter over `most` px) or long (axes over 2:1)
    across its long side. Primaries do it at the primary size; hairlines then split those cells
    down to 70 to 100 px."""
    rng = net.rng
    order = 5000 if tier == 1 else 20000
    tried = {}
    for _ in range(600):
        lab = cells(net.occ)
        worst, score = None, 0.0
        for i in np.unique(lab):
            if i >= G * G:
                continue
            area, near, cen, ev, evec = region_stats(lab, i)
            key = (int(cen[0] % G) // 3, int(cen[1] % G) // 3)
            if tried.get(key, 0) >= 2:
                continue   # a sliver that will not split: leave it
            eqd = math.sqrt(4 * area / math.pi)
            elong = math.sqrt(max(ev[1], 1e-6) / max(ev[0], 1e-6))
            # long thin cells split too, but a hairline never makes a cell under ~70 px
            s = max(eqd / most, (elong / 2.0) * min(1.0, eqd / ((0.62 if tier == 1 else 0.95) * most)))
            if s > 1.0 and s > score:
                worst, score = (near, cen, evec, key), s
        if worst is None:
            return
        (cx, cy), (fx, fy), evec, key = worst
        tried[key] = tried.get(key, 0) + 1
        major = evec[:, 1]
        # cut along the minor axis through the centroid (offset a little along the major axis)
        off = rng.uniform(-0.1, 0.1)
        px = (fx + major[0] * off * 6) * S + S / 2
        py = (fy + major[1] * off * 6) * S + S / 2
        if net.fine(px, py) < 6:
            px, py = (cx + 0.5) * S, (cy + 0.5) * S
        jit = rng.normal(0, (0.15 if take == 'craze' else 0.3) + (0.12 if tier == 2 else 0))
        ang = math.atan2(major[0], -major[1]) + jit
        net.crack(px, py, ang, tier, 0, opts, order, tries=TRIES, drop=tier == 2)
        order += 1


TRIES = 8   # starts tried per crack before an X is accepted (primary) or the hairline dropped


def close_ends(net, opts, tier):
    """Keep any free end of this tier going until it meets a crack (turning it a little if it
    would land on an older junction). An end that still cannot meet one stays free and tapers
    (to 0 in the hairline mask)."""
    rng = net.rng
    for c in list(net.cracks):
        if c['tier'] != tier:
            continue
        for e in (0, 1):
            if not c['free'][e]:
                continue
            p = c['pts']
            a, b = (p[0], p[1]) if e == 0 else (p[-1], p[-2])
            ang0 = math.atan2(a[1] - b[1], a[0] - b[0])
            best = None
            for k in range(TRIES):
                ang = ang0 + (rng.normal(0, 0.12 * k) if k else 0.0)
                ext, met = net.grow(float(a[0]), float(a[1]), ang, dict(opts, free_steps=3))
                if len(ext) < 2:
                    continue
                cl = net.clearance(np.asarray(ext), (True, not met), tier) if met else -1e9
                if best is None or cl > best[0]:
                    best = (cl, ext, met)
                if met and cl >= 0:
                    break
            if best is None:
                continue
            cl, ext, met = best
            # the extension is the same vein: join it on, and draw it into the fields
            net.draw(ext)
            if met:
                net.joins.append((float(ext[-1][0]) % N, float(ext[-1][1]) % N, tier))
            ext = np.asarray(ext[1:], np.float32)
            c['pts'] = np.concatenate([ext[::-1], p]) if e == 0 else np.concatenate([p, ext])
            free = list(c['free'])
            free[e] = not met
            c['free'] = tuple(free)


def cells(occ):
    """4-connected open regions of the coarse grid (torus): label array."""
    big = G * G + 1
    lab = np.where(occ, big, np.arange(G * G).reshape(G, G))
    while True:
        m = lab.copy()
        for ax in (0, 1):
            for sh in (1, -1):
                m = np.minimum(m, np.roll(lab, sh, axis=ax))
        m = np.where(occ, big, m)
        # pointer jumping
        flat = m.ravel()
        ok = flat < big
        flat2 = flat.copy()
        flat2[ok] = np.minimum(flat[ok], flat[flat[ok]])
        m = flat2.reshape(G, G)
        if (m == lab).all():
            return lab
        lab = m


def hairlines(net, opts, take, hair_max=100.0, spurs=0.0):
    """Hairlines split the primary cells down to `hair_max`; with spurs > 0, that share of the
    cells gets one more hairline that stops short inside it (a free end)."""
    rng = net.rng
    hopts = dict(opts or {}, approach=10.0, snap=1.5)
    if take == 'craze':
        hopts['wander'] = 0.005
    refine_cells(net, hopts, take, hair_max, 2)
    close_ends(net, hopts, 2)
    if spurs <= 0:
        return
    order = 30000
    D = edt_torus(net.occ) * S
    lab = cells(net.occ)
    ids = [i for i in np.unique(lab) if i < G * G]
    rng.shuffle(ids)
    for i in ids:
        m = lab == i
        area = m.sum() * S * S
        if area < 3000:
            continue
        r = rng.random()
        Dm = np.where(m, D, 0)
        f = int(np.argmax(Dm))
        cy, cx = divmod(f, G)
        if r < spurs:         # a hairline from the cell wall that stops inside it
            ux, uy = net.nearest_dir(cx, cy, D / S)
            sx, sy = (cx + 0.5) * S + rng.normal(0, 6), (cy + 0.5) * S + rng.normal(0, 6)
            ln = rng.uniform(18, 34)
            pts, met = net.grow(sx, sy, math.atan2(uy, ux) + rng.normal(0, 0.3), hopts)
            back, _ = net.grow(sx, sy, math.atan2(-uy, -ux) + rng.normal(0, 0.2), dict(hopts, max_len=int(ln)))
            line = back[::-1] + pts[1:]
            net.add(line, 2, 0, (True, not met), order)
            order += 1


def joints(seed, ncell):
    """Relaxed periodic Voronoi with warped edges: distance (px) to the nearest cell wall."""
    rng = np.random.default_rng(seed)
    pts = rng.uniform(0, N, (ncell, 2))
    yy, xx = np.mgrid[0:N:4, 0:N:4].astype(np.float32)
    for _ in range(12):  # Lloyd relaxation on a coarse grid
        d = np.stack([np.hypot(wrapd(xx - px), wrapd(yy - py)) for px, py in pts], 0)
        own = d.argmin(0)
        for k in range(ncell):
            sel = own == k
            if sel.any():
                ox = wrapd(xx[sel] - pts[k, 0]).mean()
                oy = wrapd(yy[sel] - pts[k, 1]).mean()
                pts[k] = (pts[k] + [ox, oy]) % N
    y, x = np.mgrid[0:N, 0:N].astype(np.float32)
    wx, wy = periodic_noise(rng, 6, 2.2) * 9, periodic_noise(rng, 6, 2.2) * 9
    x2, y2 = x + wx, y + wy
    d1 = np.full((N, N), 1e9, np.float32)
    d2 = np.full((N, N), 1e9, np.float32)
    for px, py in pts:
        d = np.hypot(wrapd(x2 - px), wrapd(y2 - py))
        nd2 = np.where(d < d1, d1, np.minimum(d2, d))
        d1 = np.minimum(d1, d)
        d2 = nd2
    return (d2 - d1) / 2


def periodic_noise(rng, f0, beta):
    """Seamless band-limited noise, unit std (FFT filtered white noise)."""
    w = rng.normal(0, 1, (N, N))
    F = np.fft.fft2(w)
    fy = np.fft.fftfreq(N)[:, None] * N
    fx = np.fft.fftfreq(N)[None, :] * N
    r = np.hypot(fx, fy)
    r[0, 0] = 1
    amp = 1 / (1 + (r / f0) ** beta)
    amp[0, 0] = 0
    n = np.real(np.fft.ifft2(F * amp))
    return (n / n.std()).astype(np.float32)


def widths(net):
    """Primary veins 6.5 to 7.5 px before the slow variation (earlier cracks opened wider), hairlines 3 px."""
    prim = [c for c in net.cracks if c['tier'] == 1]
    orders = sorted(c['order'] for c in prim)
    for c in net.cracks:
        if c['tier'] == 1:
            rank = orders.index(c['order']) / max(1, len(orders) - 1)
            c['w'] = 7.5 - 1.0 * rank ** 0.6   # x (1 +- .06) along the vein: 6.1 to 8 px
        else:
            c['w'] = 3.0


def render(net, aa=1.0, groove=False, hair_peak=1.0, step=2.0, tier=None, soft=False):
    """Vein mask: max over segments of clamp(.5 + (hw - d) / (2 aa)). Free ends taper.
    tier: only that tier's veins. soft: a raised cosine instead, peak `hair_peak` on the line,
    half at hw and 0 at 2 hw, and a free end fades to 0."""
    P = 40
    out = np.zeros((N + 2 * P, N + 2 * P), np.float32)
    for c in net.cracks:
        if tier is not None and c['tier'] != tier:
            continue
        p = c['pts'].astype(np.float64)
        # resample at 2 px for smooth curves
        seg = np.hypot(*(p[1:] - p[:-1]).T)
        s = np.concatenate([[0], np.cumsum(seg)])
        L = s[-1]
        if L < 1:
            continue
        n = max(2, int(L / step) + 1)
        t = np.linspace(0, L, n)
        q = np.stack([np.interp(t, s, p[:, 0]), np.interp(t, s, p[:, 1])], 1)
        hw = np.full(n, c['w'] / 2)
        # slow width variation along the vein, +-6%
        hw *= 1 + 0.06 * np.sin(t / 37.0 + c['order']) * np.sin(t / 13.0 + 2 * c['order'])
        taper = 22.0 if c['tier'] == 1 else 26.0
        amp = np.ones(n)
        if c['free'][0]:
            hw *= np.clip(t / taper, 0.15, 1)
            amp *= np.clip(t / taper, 0, 1)
        if c['free'][1]:
            hw *= np.clip((L - t) / taper, 0.15, 1)
            amp *= np.clip((L - t) / taper, 0, 1)
        for k in range(n - 1):
            a, b = q[k], q[k + 1]
            shift = np.floor(a / N) * N
            a, b = a - shift, b - shift
            h = max(hw[k], hw[k + 1])
            reach = h + 2 * aa + 1
            x0 = int(math.floor(min(a[0], b[0]) - reach)) + P
            x1 = int(math.ceil(max(a[0], b[0]) + reach)) + P
            y0 = int(math.floor(min(a[1], b[1]) - reach)) + P
            y1 = int(math.ceil(max(a[1], b[1]) + reach)) + P
            yy, xx = np.mgrid[y0:y1 + 1, x0:x1 + 1].astype(np.float64)
            xx -= P - 0.5
            yy -= P - 0.5
            ab = b - a
            l2 = max(ab @ ab, 1e-9)
            u = np.clip(((xx - a[0]) * ab[0] + (yy - a[1]) * ab[1]) / l2, 0, 1)
            d = np.hypot(xx - a[0] - u * ab[0], yy - a[1] - u * ab[1])
            hh = hw[k] + (hw[k + 1] - hw[k]) * u
            if groove:
                v = np.clip(1 - d / (hh + 1.5), 0, 1) ** 1.5 * np.minimum(1, hh / 3.5)
            elif soft:
                am = amp[k] + (amp[k + 1] - amp[k]) * u
                v = hair_peak * am * 0.5 * (1 + np.cos(np.pi * np.clip(d / (2 * hh), 0, 1)))
            else:
                v = np.clip(0.5 + (hh - d) / (2 * aa), 0, 1 if c['tier'] == 1 else hair_peak)
            sub = out[y0:y1 + 1, x0:x1 + 1]
            np.maximum(sub, v.astype(np.float32), out=sub)
    core = out[P:P + N, P:P + N].copy()
    # fold the pads back (wrap)
    core[:, :P] = np.maximum(core[:, :P], out[P:P + N, N + P:N + 2 * P])
    core[:, N - P:] = np.maximum(core[:, N - P:], out[P:P + N, :P])
    core[:P, :] = np.maximum(core[:P, :], out[N + P:N + 2 * P, P:P + N])
    core[N - P:, :] = np.maximum(core[N - P:, :], out[:P, P:P + N])
    for oy, ox in ((0, 0), (0, 1), (1, 0), (1, 1)):
        ys = slice(0, P) if oy == 0 else slice(N - P, N)
        xs = slice(0, P) if ox == 0 else slice(N - P, N)
        sy = slice(N + P, N + 2 * P) if oy == 0 else slice(0, P)
        sx = slice(N + P, N + 2 * P) if ox == 0 else slice(0, P)
        core[ys, xs] = np.maximum(core[ys, xs], out[sy, sx])
    return core


def to_srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)


def glaze(rng):
    """Dark warm-graphite glaze: the old map's brightness (linear luminance .0131), no structure that
    repeats visibly on every brick (the face samples the whole map), a faint glassy mottle and a few
    tiny iron specks."""
    mott = periodic_noise(rng, 5, 2.5) * 0.05 + periodic_noise(rng, 40, 2.0) * 0.035
    speck = periodic_noise(rng, 300, 1.0)
    speck = np.clip((speck - 2.6) / 0.8, 0, 1) * -0.25
    base = np.array([0.0142, 0.0131, 0.0118], np.float32)   # warm near-black, R > G > B
    lin = base[None, None, :] * (1 + mott + speck)[..., None]
    lum = lin @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    lin *= 0.0131 / lum.mean()
    return lin


def normal_from_height(h, strength):
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * strength
    dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * strength
    n = np.stack([-dx, dy, np.ones_like(h)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return n


def main():
    out = sys.argv[1]
    take = sys.argv[2] if len(sys.argv) > 2 else 'craze'
    seed = int(sys.argv[3]) if len(sys.argv) > 3 else 7
    prim_max = float(sys.argv[4]) if len(sys.argv) > 4 else 250.0
    hair_peak = float(sys.argv[5]) if len(sys.argv) > 5 else 1.0
    final = len(sys.argv) > 6 and sys.argv[6] == 'final'
    hair_max = float(sys.argv[7]) if len(sys.argv) > 7 else 100.0
    spurs = float(sys.argv[8]) if len(sys.argv) > 8 else 0.0
    # roll "dx,dy" (even px): moves the wrap seams of the mask and the normal together, so they sit
    # where no vein runs along them (the map is seamless either way; this only settles tilecheck)
    dx, dy = (int(v) for v in sys.argv[9].split(',')) if len(sys.argv) > 9 else (0, 0)
    assert dx % 2 == 0 and dy % 2 == 0, 'roll by even px, so the 512 normal stays in register'
    os.makedirs(out, exist_ok=True)
    if take == 'joints':
        d = joints(seed, int(round(N * N / (math.pi / 4 * (0.8 * prim_max) ** 2))))
        prim = np.clip(0.5 + (3.6 - d) / 2.0, 0, 1)
        hair = np.zeros_like(prim)
        grooves = np.clip(1 - d / 5.0, 0, 1) ** 1.5
        net = None
    else:
        net, opts = build(take, seed, prim_max)
        hairlines(net, opts, take, hair_max, spurs)
        widths(net)
        step = 1.0 if final else 2.0   # the final follows each curve every pixel
        prim = render(net, step=step, tier=1)
        hair = render(net, step=step, tier=2, soft=True, hair_peak=hair_peak)
        grooves = render(net, groove=True, step=step)
    rgb = np.roll(np.stack([prim, hair, np.zeros_like(prim)], -1), (dy, dx), axis=(0, 1))
    Image.fromarray((rgb * 255 + 0.5).astype(np.uint8), 'RGB').save(os.path.join(out, f'{take}_mask.png'),
                                                                     optimize=True)
    rng = np.random.default_rng(seed + 101)
    lin = glaze(rng)
    Image.fromarray((to_srgb(lin) * 255 + 0.5).astype(np.uint8), 'RGB').save(os.path.join(out, f'{take}_glaze.png'))
    # height: the glaze undulates very gently; the veins are shallow grooves (a soft V, not a cut)
    und = periodic_noise(rng, 6, 2.5) * 0.35
    blur = grooves
    k = np.array([1, 4, 6, 4, 1], np.float32) / 16
    for ax in (0, 1):
        blur = sum(np.roll(blur, i - 2, axis=ax) * k[i] for i in range(5))
    h = und * 0.25 - blur * 1.0
    n = np.roll(normal_from_height(h, 0.55), (dy, dx), axis=(0, 1))
    Image.fromarray(((n * 0.5 + 0.5) * 255 + 0.5).astype(np.uint8), 'RGB').save(os.path.join(out, f'{take}_n.png'))
    if net is not None:
        with open(os.path.join(out, f'{take}_veins.json'), 'w') as f:
            json.dump([{'tier': c['tier'], 'w': c['w'], 'free': c['free'], 'order': c['order'],
                        'pts': (c['pts'] + np.float32([dx, dy])).round(2).tolist()} for c in net.cracks], f)
        print(take, 'cracks', sum(c['tier'] == 1 for c in net.cracks), 'hairlines', sum(c['tier'] == 2 for c in net.cracks),
              'dropped (X)', net.dropped)
    print('wrote', out, take)


if __name__ == '__main__':
    main()
