/* =====================================================================================
   Overhead aircraft model generator: builds detailed glTF 2.0 models from type data.
   Runs in the browser (window.AircraftModels) and in Node (require), so the same code can
   bake model files offline.

   Authoring frame: X forward (nose = +X), Y left, Z up, meters, origin at fuselage center.
   Detail: airfoil-section wings with kinks and winglets, turbofan nacelles with fan faces and
   exhaust cones, pylons, cabin and cockpit windows, belly fairing, flap-track fairings,
   landing gear, propellers and rotors with real blades that spin (glTF animation).
   ===================================================================================== */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.AircraftModels = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const len3 = a => Math.hypot(a[0], a[1], a[2]);
  const norm = a => { const l = len3(a); return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0]; };
  const rad = d => d * Math.PI / 180;
  const lerp = (a, b, t) => a + (b - a) * t;
  const mirrorY = p => [p[0], -p[1], p[2]];
  // Two unit vectors perpendicular to axis a (right-handed: e1 x e2 = a).
  function basis(a) {
    a = norm(a);
    const h = Math.abs(a[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    const e1 = norm(cross(h, a)), e2 = cross(a, e1);
    return [e1, e2];
  }

  // ---------------------------------------------------------------------------------
  // Geometry builder. Geometry is grouped into parts (glTF nodes); a part can spin.
  // ---------------------------------------------------------------------------------
  class Builder {
    // q: tessellation multiplier. hq adds small details (lights, seams, antennas, chevrons).
    constructor(hq = false) { this.parts = [{ name: "airframe", pivot: [0, 0, 0], spin: null, g: {} }]; this.cur = this.parts[0]; this.lift = 0; this.hq = hq; this.q = hq ? 2 : 1; }
    // Switch to a named part, creating it on first use (used for the landing gear).
    use(name) { const p = this.parts.find(x => x.name === name) || this.part(name, [0, 0, 0], null); this.cur = p; return p; }
    part(name, pivot, spin) { const p = { name, pivot, spin, g: {} }; this.parts.push(p); this.cur = p; return p; }
    main() { this.cur = this.parts[0]; }
    // Adds a triangle; winding is fixed to agree with the given outward normal(s).
    tri(mat, a, b, c, na, nb, nc) {
      const g = this.cur.g[mat] || (this.cur.g[mat] = { p: [], n: [] });
      const geo = norm(cross(sub(b, a), sub(c, a)));
      if (len3(geo) === 0) return;
      if (!na) { na = nb = nc = geo; }
      const avgN = add(add(na, nb), nc);
      if (dot(geo, avgN) < 0) { [b, c] = [c, b]; [nb, nc] = [nc, nb]; }
      g.p.push(...a, ...b, ...c); g.n.push(...na, ...nb, ...nc);
    }
    // Flat quad oriented away from a reference point inside the solid.
    quad(mat, a, b, c, d, ref) {
      for (const [p, q, r] of [[a, b, c], [a, c, d]]) {
        let n = norm(cross(sub(q, p), sub(r, p)));
        const cen = mul(add(add(p, q), r), 1 / 3);
        if (dot(n, sub(cen, ref)) < 0) n = mul(n, -1);
        this.tri(mat, p, q, r, n, n, n);
      }
    }
    // Thin hexahedron from 8 corners: top [rootLE, rootTE, tipTE, tipLE], then bottom in same order.
    hexa(mat, c) {
      const ref = c.reduce((s, p) => add(s, mul(p, 1 / 8)), [0, 0, 0]);
      const f = [[0, 1, 2, 3], [4, 7, 6, 5], [0, 4, 5, 1], [3, 2, 6, 7], [0, 3, 7, 4], [1, 5, 6, 2]];
      for (const [a, b, d, e] of f) this.quad(mat, c[a], c[b], c[d], c[e], ref);
    }
    // Smooth surface through a grid P[i][j] (rows i = stations, columns j = around).
    // centers[i] is a point inside row i, used to point normals outward.
    // o.wrap closes each row into a ring; o.caps adds flat end caps; o.inward flips normals.
    grid(mat, P, centers, o = {}) {
      const ni = P.length, nj = P[0].length, wrap = !!o.wrap, sgn = o.inward ? -1 : 1;
      const at = (i, j) => P[Math.max(0, Math.min(ni - 1, i))][wrap ? (j + nj) % nj : Math.max(0, Math.min(nj - 1, j))];
      const N = P.map((row, i) => row.map((p, j) => {
        let n = norm(cross(sub(at(i, j + 1), at(i, j - 1)), sub(at(i + 1, j), at(i - 1, j))));
        let out = sub(p, centers[i]);
        if (len3(out) < 1e-9) out = sub(p, centers[i === 0 ? 1 : i - 1]);
        if (len3(n) === 0) n = norm(out);
        if (dot(n, out) < 0) n = mul(n, -1);
        return mul(n, sgn);
      }));
      const jmax = wrap ? nj : nj - 1;
      for (let i = 0; i < ni - 1; i++) for (let j = 0; j < jmax; j++) {
        const j1 = (j + 1) % nj;
        this.tri(mat, P[i][j], P[i + 1][j], P[i + 1][j1], N[i][j], N[i + 1][j], N[i + 1][j1]);
        this.tri(mat, P[i][j], P[i + 1][j1], P[i][j1], N[i][j], N[i + 1][j1], N[i][j1]);
      }
      if (o.caps) for (const [k, k2] of [[0, 1], [ni - 1, ni - 2]]) {
        const cen = centers[k], n = norm(sub(cen, centers[k2]));
        if (len3(n) === 0) continue;
        for (let j = 0; j < (wrap ? nj : nj - 1); j++) this.tri(mat, cen, P[k][j], P[k][(j + 1) % nj], n, n, n);
      }
    }
    // Lofted body along X through sections {x, ry, rz, yc, zc, e (superellipse exponent)}.
    loft(mat, secs, seg = 24, th0 = 0, th1 = 2 * Math.PI, o = {}) {
      seg = Math.max(1, Math.round(seg * this.q));
      const full = Math.abs(th1 - th0 - 2 * Math.PI) < 1e-6, cols = full ? seg : seg + 1;
      const P = secs.map(s => Array.from({ length: cols }, (_, j) => {
        const t = th0 + (th1 - th0) * j / seg, c = Math.cos(t), sn = Math.sin(t), e = s.e || 2;
        const fc = Math.sign(c) * Math.pow(Math.abs(c), 2 / e), fs = Math.sign(sn) * Math.pow(Math.abs(sn), 2 / e);
        return [s.x, (s.yc || 0) + Math.max(s.ry, 1e-3) * fc, (s.zc || 0) + Math.max(s.rz, 1e-3) * fs];
      }));
      this.grid(mat, P, secs.map(s => [s.x, s.yc || 0, s.zc || 0]), { wrap: full, caps: full && o.caps });
    }
    // Surface of revolution: profile [[s, r], ...] about axis a through c. The solid lies to the
    // right of the profile when walking along it in the (s, r) plane, so the outer skin of a body
    // runs nose to tail and an inner duct runs tail to nose.
    lathe(mat, c, a, prof, seg = 20, o = {}) {
      seg = Math.round(seg * this.q); a = norm(a); const [e1, e2] = basis(a);
      const P = [], C = [];
      prof.forEach(([s, r]) => {
        const row = [];
        for (let j = 0; j < seg; j++) {
          const t = 2 * Math.PI * j / seg, rd = add(mul(e1, Math.cos(t)), mul(e2, Math.sin(t)));
          row.push(add(add(c, mul(a, s)), mul(rd, Math.max(r, 1e-4))));
        }
        P.push(row); C.push(add(c, mul(a, s)));
      });
      // Normals from the 2D profile: n = (dr, -ds) rotated into 3D.
      const ni = prof.length;
      const N = prof.map((_, i) => {
        const p0 = prof[Math.max(0, i - 1)], p1 = prof[Math.min(ni - 1, i + 1)];
        const ds = p1[0] - p0[0], dr = p1[1] - p0[1], l = Math.hypot(ds, dr) || 1;
        return [dr / l, -ds / l];
      });
      for (let i = 0; i < ni - 1; i++) for (let j = 0; j < seg; j++) {
        const j1 = (j + 1) % seg;
        const nv = (ii, jj) => { const t = 2 * Math.PI * jj / seg, rd = add(mul(e1, Math.cos(t)), mul(e2, Math.sin(t))); return norm(add(mul(a, N[ii][0]), mul(rd, N[ii][1]))); };
        this.tri(mat, P[i][j], P[i + 1][j], P[i + 1][j1], nv(i, j), nv(i + 1, j), nv(i + 1, j1));
        this.tri(mat, P[i][j], P[i + 1][j1], P[i][j1], nv(i, j), nv(i + 1, j1), nv(i, j1));
      }
      if (o.cap) this.disc(mat, add(c, mul(a, prof[ni - 1][0])), prof[ni - 1][1], a, seg, o.capDir || 1);
    }
    // Round tube between two points.
    tube(mat, p0, p1, r, seg = 8) {
      const d = sub(p1, p0), l = len3(d);
      if (l < 1e-6) return;
      this.lathe(mat, p0, d, [[0, r * 0.6], [0.0001 * l, r], [l * 0.9999, r], [l, r * 0.6]], seg);
    }
    tubePath(mat, pts, r, seg = 8) { for (let i = 0; i < pts.length - 1; i++) this.tube(mat, pts[i], pts[i + 1], r, seg); }
    // Flat disc of radius r at cen, facing along axis (dir flips which way it faces).
    disc(mat, cen, r, axis, seg = 24, dir = 1) {
      axis = norm(axis); const [e1, e2] = basis(axis), n = mul(axis, dir);
      const pt = t => add(cen, add(mul(e1, r * Math.cos(t)), mul(e2, r * Math.sin(t))));
      for (let j = 0; j < seg; j++) this.tri(mat, cen, pt(2 * Math.PI * j / seg), pt(2 * Math.PI * (j + 1) / seg), n, n, n);
    }
    // Lifting surface through stations {x (leading edge), y, z, c (chord), t (thickness ratio),
    // cant (0 = horizontal, 90 = vertical, measured from +Y up)}. Mirrored when o.mirror.
    foil(mat, st, o = {}) {
      const n = Math.round((o.n || 9) * (this.q > 1 ? 1.6 : 1)), camber = o.camber || 0, us = [];
      for (let k = n; k >= 0; k--) us.push([(1 - Math.cos(Math.PI * k / n)) / 2, 1]);
      for (let k = 1; k < n; k++) us.push([(1 - Math.cos(Math.PI * k / n)) / 2, -1]);
      const half = (u, t) => 5 * t * (0.2969 * Math.sqrt(u) - 0.126 * u - 0.3516 * u * u + 0.2843 * u ** 3 - 0.1036 * u ** 4);
      const build = flip => {
        const P = [], C = [];
        for (const s of st) {
          const ca = rad(s.cant || 0), td = [0, -Math.sin(ca) * (flip ? -1 : 1), Math.cos(ca)];
          const y = flip ? -s.y : s.y;
          const row = us.map(([u, side]) => {
            const v = side * half(u, s.t) + camber * 4 * u * (1 - u);
            return [s.x - u * s.c, y + td[1] * v * s.c, s.z + td[2] * v * s.c];
          });
          P.push(row); C.push([s.x - 0.35 * s.c, y, s.z + td[2] * camber * s.c * 0.8]);
        }
        this.grid(mat, P, C, { wrap: true, caps: o.caps !== false });
      };
      build(false);
      if (o.mirror) build(true);
    }
    // Small emissive light (navigation / beacon / strobe).
    light(mat, p, r) { this.lathe(mat, add(p, [r, 0, 0]), [-1, 0, 0], [[0, .001], [.3 * r, .8 * r], [r, r], [1.7 * r, .8 * r], [2 * r, .001]], 8); }
    // Thin seam line drawn just above a lifting surface between (station a, u0) and (station b, u1).
    // side: +1 upper, -1 lower. Stations as for foil(); flip mirrors to -Y.
    seam(a, b, u0, u1, side, w, camber = 0, flip = false) {
      const p0 = foilPt(a, u0, side, camber, flip, .002), p1 = foilPt(b, u1, side, camber, flip, .002);
      const d = norm(sub(p1, p0)), ca = rad(lerp(a.cant || 0, b.cant || 0, .5));
      const n = flip ? [0, Math.sin(ca), Math.cos(ca)] : [0, -Math.sin(ca), Math.cos(ca)];
      const side3 = mul(norm(cross(n, d)), w / 2), ref = sub(lerp3(p0, p1, .5), mul(n, side));
      this.quad("seam", add(p0, side3), sub(p0, side3), sub(p1, side3), add(p1, side3), ref);
    }
  }
  const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  const foilHalf = (u, t) => 5 * t * (0.2969 * Math.sqrt(u) - 0.126 * u - 0.3516 * u * u + 0.2843 * u ** 3 - 0.1036 * u ** 4);
  // Point on a foil station's surface at chord fraction u (side +1 upper, -1 lower), pushed out by eps * chord.
  function foilPt(s, u, side, camber, flip, eps = 0) {
    const ca = rad(s.cant || 0), td = [0, -Math.sin(ca) * (flip ? -1 : 1), Math.cos(ca)];
    const v = side * (foilHalf(u, s.t) + eps) + camber * 4 * u * (1 - u);
    return [s.x - u * s.c, (flip ? -s.y : s.y) + td[1] * v * s.c, s.z + td[2] * v * s.c];
  }
  // Interpolated station at fraction f between stations a and b.
  const stLerp = (a, b, f) => ({ x: lerp(a.x, b.x, f), y: lerp(a.y, b.y, f), z: lerp(a.z, b.z, f), c: lerp(a.c, b.c, f), t: lerp(a.t, b.t, f), cant: lerp(a.cant || 0, b.cant || 0, f) });

  // ---------------------------------------------------------------------------------
  // Type data
  // ---------------------------------------------------------------------------------
  // Family layouts. d: fuselage diameter / length. eng.r: nacelle radius / fuselage diameter. eng.len: nacelle length / length.
  const FAM = {
    narrow: { fus: "jet", d: .105, wing: "low", wx: .10, cr: .17, taper: .3, sweep: 25, dih: 5, tail: "conv", fin: .165, hs: .35, eng: { n: 2, mount: "wing", r: .3, len: .11 }, gear: { track: 1.45, h: .55, wr: .28, bogie: 1 } },
    narrow4: { fus: "jet", d: .1, wing: "low", wx: .10, cr: .17, taper: .3, sweep: 33, dih: 5, tail: "conv", fin: .17, hs: .36, eng: { n: 4, mount: "wing", r: .22, len: .09 }, gear: { track: 1.6, h: .7, wr: .3, bogie: 2 } },
    wide2: { fus: "jet", d: .095, wing: "low", wx: .10, cr: .18, taper: .25, sweep: 31, dih: 6, tail: "conv", fin: .16, hs: .34, eng: { n: 2, mount: "wing", r: .32, len: .085 }, gear: { track: 1.8, h: .75, wr: .22, bogie: 2 } },
    wide4: { fus: "jet", d: .09, wing: "low", wx: .10, cr: .18, taper: .25, sweep: 35, dih: 6, tail: "conv", fin: .17, hs: .34, eng: { n: 4, mount: "wing", r: .23, len: .075 }, gear: { track: 1.9, h: .75, wr: .2, bogie: 2, body: true } },
    tri: { fus: "jet", d: .1, wing: "low", wx: .10, cr: .18, taper: .28, sweep: 35, dih: 5, tail: "conv", fin: .17, hs: .36, eng: { n: 3, mount: "tri", r: .3, len: .09 }, gear: { track: 1.8, h: .75, wr: .22, bogie: 2, body: true } },
    ejet: { fus: "jet", d: .1, wing: "low", wx: .08, cr: .17, taper: .3, sweep: 25, dih: 5, tail: "conv", fin: .2, hs: .36, eng: { n: 2, mount: "wing", r: .32, len: .11 }, gear: { track: 1.6, h: .6, wr: .28, bogie: 1 } },
    rearjet: { fus: "jet", d: .095, wing: "low", wx: .0, cr: .15, taper: .3, sweep: 26, dih: 3, tail: "T", fin: .2, hs: .34, eng: { n: 2, mount: "rear", r: .28, len: .14 }, gear: { track: 1.5, h: .55, wr: .28, bogie: 1 } },
    bizjet: { fus: "jet", d: .12, wing: "low", wx: -.02, cr: .16, taper: .35, sweep: 28, dih: 3, tail: "T", fin: .22, hs: .38, eng: { n: 2, mount: "rear", r: .3, len: .17 }, gear: { track: 1.6, h: .45, wr: .25, bogie: 1 }, win: "biz" },
    bizjet3: { fus: "jet", d: .11, wing: "low", wx: -.02, cr: .16, taper: .35, sweep: 30, dih: 3, tail: "conv", fin: .2, hs: .36, eng: { n: 3, mount: "rear3", r: .26, len: .15 }, gear: { track: 1.6, h: .45, wr: .25, bogie: 1 }, win: "biz" },
    turboprop: { fus: "jet", d: .1, wing: "high", wx: .07, cr: .095, taper: .6, sweep: 2, dih: 1, tail: "T", fin: .2, hs: .33, eng: { n: 2, mount: "propwing", r: .27, len: .2 }, prop: .075, blades: 6, gear: { track: 1.6, h: .45, wr: .3, bogie: 1 } },
    turboprop4: { fus: "jet", d: .14, wing: "high", wx: .07, cr: .1, taper: .55, sweep: 2, dih: 1, tail: "conv", fin: .2, hs: .36, eng: { n: 4, mount: "propwing", r: .2, len: .17 }, prop: .055, blades: 6, gear: { track: 1.1, h: .3, wr: .22, bogie: 2 }, win: "none" },
    kingair: { fus: "jet", d: .11, wing: "low", wx: .06, cr: .12, taper: .55, sweep: 3, dih: 6, tail: "T", fin: .2, hs: .34, eng: { n: 2, mount: "propwing", r: .32, len: .22 }, prop: .08, blades: 4, gear: { track: 2.6, h: .5, wr: .3, bogie: 1 }, win: "biz" },
    twinprop: { fus: "ga", d: .14, wing: "low", wx: .12, cr: .13, taper: .7, sweep: 0, dih: 6, tail: "conv", fin: .13, hs: .34, eng: { n: 2, mount: "propwing", r: .28, len: .24 }, prop: .085, blades: 2, gear: { track: 2.6, h: .45, wr: .3, bogie: 1 } },
    singlehigh: { fus: "ga", d: .14, wing: "high", wx: .16, cr: .145, taper: .75, sweep: 0, dih: 1.5, tail: "conv", fin: .12, hs: .32, eng: { n: 1, mount: "propnose" }, prop: .085, blades: 2, gear: { track: 2.1, h: .55, wr: .3, bogie: 1 } },
    singlelow: { fus: "ga", d: .14, wing: "low", wx: .14, cr: .14, taper: .7, sweep: 0, dih: 6, tail: "conv", fin: .12, hs: .32, eng: { n: 1, mount: "propnose" }, prop: .085, blades: 2, gear: { track: 2.4, h: .5, wr: .3, bogie: 1 } },
    mil4jet: { fus: "jet", d: .13, wing: "high", wx: .07, cr: .16, taper: .3, sweep: 25, dih: -3, tail: "T", fin: .2, hs: .38, eng: { n: 4, mount: "wing", r: .26, len: .1 }, gear: { track: 1.05, h: .3, wr: .2, bogie: 2 }, win: "none" },
    heli: { fus: "heli" },
  };

  // ICAO type designator -> [family, length m, wingspan m (rotor diameter for helicopters)]
  const T = {};
  const addT = (fam, list) => list.split(",").forEach(e => { const [c, l, b] = e.trim().split(" "); T[c] = [fam, +l, +b]; });
  addT("narrow", "A318 31.4 34.1,A319 33.8 35.8,A320 37.6 35.8,A321 44.5 35.8,A19N 33.8 35.8,A20N 37.6 35.8,A21N 44.5 35.8,B736 31.2 34.3,B737 33.6 35.8,B738 39.5 35.8,B739 42.1 35.8,B37M 35.6 35.9,B38M 39.5 35.9,B39M 42.2 35.9,B3XM 43.8 35.9,BCS1 35 35.1,BCS3 38.7 35.1,B752 47.3 38.05,B753 54.4 38.05,A20 37.6 35.8");
  addT("narrow4", "K35R 41.5 39.9,E3TF 46.6 44.4,B703 46.6 44.4");
  addT("wide2", "A332 58.8 60.3,A333 63.7 60.3,A338 58.8 64,A339 63.7 64,A359 66.8 64.75,A35K 73.8 64.75,B762 48.5 47.6,B763 54.9 47.6,B764 61.4 51.9,B772 63.7 60.9,B77L 63.7 64.8,B773 73.9 60.9,B77W 73.9 64.8,B778 70.9 71.8,B779 76.7 71.8,B788 56.7 60.1,B789 62.8 60.1,B78X 68.3 60.1,A306 54.1 44.8,A30B 53.6 44.8,A310 46.7 43.9,KC46 50.5 48.1");
  addT("wide4", "A343 63.6 60.3,A346 75.3 63.5,A388 72.7 79.8,B744 70.7 64.4,B748 76.3 68.4,B74S 56.3 59.6");
  addT("tri", "MD11 61.6 51.7,DC10 55.5 50.4,L101 54.2 47.3");
  addT("ejet", "E170 29.9 26,E75L 31.7 28.7,E75S 31.7 26,E190 36.2 28.7,E195 38.7 28.7,E290 36.2 33.7,E295 41.5 35.1,A221 35 35.1,A223 38.7 35.1,SU95 29.9 27.8");
  addT("rearjet", "CRJ1 26.8 21.2,CRJ2 26.8 21.2,CRJ7 32.5 23.2,CRJ9 36.2 24.9,CRJX 39.1 26.2,E135 26.3 20,E145 29.9 20,E35L 26.3 21.2,B712 37.8 28.4,MD81 45 32.8,MD82 45 32.8,MD83 45 32.8,MD87 39.8 32.8,MD88 45 32.8,MD90 46.5 32.9,DC93 36.4 28.5,F100 35.5 28.1,F70 30.9 28.1");
  addT("bizjet", "C25A 13 14.4,C25B 14.4 15.8,C25C 16.3 16.3,C25M 12.9 14.4,C510 10.7 13.2,C525 12.4 14.4,C550 14.4 15.9,C560 14.9 15.9,C56X 15.8 17.2,C650 16.9 16.3,C680 19.4 19.4,C68A 19.4 22,C700 22.3 22,C750 22 19.4,CL30 20.9 19.5,CL35 20.9 19.5,CL60 20.9 19.6,GL5T 29.5 28.7,GLEX 30.3 28.7,GL6T 30.3 28.7,GL7T 33.8 31.7,GLF4 26.9 23.7,GLF5 29.4 28.5,GLF6 30.4 30.4,GA6C 30.4 30.4,G280 20.4 19.2,GALX 18.97 17.7,LJ31 14.8 13.4,LJ35 14.8 12,LJ40 16.9 14.6,LJ45 17.7 14.6,LJ60 17.9 13.4,LJ75 17.7 15.5,E50P 12.8 12.3,E55P 15.6 16.2,E545 20.7 20,E550 20.7 20,PC24 16.9 17,HDJT 13 12.1,H25B 15.6 15.7,H25C 15.6 15.7,PRM1 14 13.6,BE40 14.8 13.3,SF50 9.4 11.8,EA50 10.1 11.6,ASTR 16.9 16.6");
  addT("bizjet3", "FA50 18.5 18.9,FA7X 23.4 26.2,FA8X 24.5 26.3,F900 20.2 19.3,F2TH 20.2 19.3,FA6X 25.7 25.9");
  addT("turboprop", "AT43 22.7 24.6,AT45 22.7 24.6,AT72 27.2 27.05,AT75 27.2 27.05,AT76 27.2 27.05,DH8A 22.3 25.9,DH8B 22.3 25.9,DH8C 25.7 27.4,DH8D 32.8 28.4,SF34 19.7 21.4,DHC6 15.8 19.8,D328 21.3 21,SW4 18.1 17.4,JS41 19.3 18.3");
  addT("turboprop4", "C130 29.8 40.4,C30J 29.8 40.4,A400 45.1 42.4,P3 35.6 30.4,DHC7 24.6 28.4");
  addT("kingair", "BE20 13.3 16.6,BE30 14.2 17.7,BE35 8.1 10.2,BE9L 10.8 15.3,BE9T 10.8 15.3,B190 17.6 17.7,B350 14.2 17.7,PAY2 10.2 13.4,PAY3 12.2 14.1");
  addT("twinprop", "BE55 8.5 11.5,BE58 9.1 11.5,BE76 8.9 11.6,PA34 8.7 11.9,PA31 9.9 12.4,PA44 8.4 11.8,C310 9.7 11.3,C340 10.5 11.6,C414 11.1 12.1,C421 11.1 12.5,DA42 8.6 13.4,DA62 9.2 14.6,P68 9.4 12");
  addT("singlehigh", "C150 7.3 10.2,C152 7.3 10.2,C162 6.9 9.1,C170 7.6 11,C172 8.3 11,C177 8.4 10.8,C180 7.8 11,C182 8.8 11,C185 7.8 11,C206 8.6 11,C207 9.7 11,C208 11.5 15.9,C210 8.6 11.2,P210 8.6 11.2,PA18 6.9 10.7,CH7A 6.9 10.7,BL8 6.9 10.2,KODI 10 14.5");
  addT("singlelow", "PA28 7.3 10.7,P28A 7.3 10.7,P28B 7.3 10.7,P28R 7.6 10.8,PA32 8.4 11,P32R 8.4 11,PA46 8.8 13.1,SR20 7.9 11.7,SR22 7.9 11.7,S22T 7.9 11.7,BE33 8.1 10.2,BE36 8.4 10.2,M20P 7.5 11,M20T 7.9 11,DA40 8 11.9,TBM7 10.6 12.8,TBM8 10.6 12.8,TBM9 10.7 12.8,PC12 14.4 16.3,RV7 6.2 7.7,RV10 7.4 9.7,DA20 7.2 10.9,AA5 6.9 9.4,TOBA 7.7 10");
  addT("mil4jet", "C17 53 51.75,C5M 75.3 67.9");
  addT("heli", "R22 8.8 7.7,R44 11.7 10.1,R66 11.7 10.1,EC20 10.7 10.2,EC30 12.9 10.7,EC35 12.2 10.2,EC45 13 11,EC55 14.3 12.6,EC75 16.6 14.8,AS50 12.9 10.7,AS55 12.9 10.7,AS65 13.7 11.9,AS32 18.7 16.2,A109 13 11,A119 13 10.8,A139 16.7 13.8,A169 14.6 12.1,B06 11.8 10.2,B407 12.7 10.7,B429 13.1 11,B412 17.1 14,B212 17.1 14,B505 11.6 11.3,S76 16 13.4,S92 20.9 17.2,H60 19.8 16.4,UH60 19.8 16.4,MD52 9.9 8.4,MD60 11 8.4,EXPL 11.8 10.3");

  const CLASS_NAME = { narrow: "Narrow-body jet", narrow4: "Four-engine jet", wide2: "Wide-body jet", wide4: "Four-engine wide-body", tri: "Three-engine wide-body",
    ejet: "Regional jet", rearjet: "Regional jet", bizjet: "Business jet", bizjet3: "Business jet", turboprop: "Turboprop", turboprop4: "Four-engine turboprop",
    kingair: "Twin turboprop", twinprop: "Twin piston", singlehigh: "Single-engine prop", singlelow: "Single-engine prop", mil4jet: "Military transport", heli: "Helicopter" };

  // Per-type features. tip: wingtip style. hump: 747 upper deck. dd: A380 double deck.
  const FEAT = {};
  const feat = (f, list) => list.split(",").forEach(c => { FEAT[c.trim()] = Object.assign(FEAT[c.trim()] || {}, f); });
  feat({ tip: "sharklet" }, "A19N,A20N,A21N,A338,A339,A221,A223,BCS1,BCS3");
  feat({ tip: "fence" }, "A318,A319,A320,A321,A20,A306,A30B,A310,A388");
  feat({ tip: "blended" }, "B736,B737,B738,B739,B752,B753,B763,E170,E75L,E190,E195,CRJ7,CRJ9,CRJX,C25C,C56X,C68A,C700,CL35,GL5T,GLEX,GL6T,GL7T,GLF4,GLF5,GLF6,GA6C,G280,LJ45,LJ60,LJ75,E545,E550,PC24,HDJT,FA7X,FA8X,FA6X,F2TH,B350,B190,KC46");
  feat({ tip: "split" }, "B37M,B38M,B39M,B3XM,MD11,E290,E295");
  feat({ tip: "raked" }, "B764,B77L,B77W,B778,B779,B788,B789,B78X,B748,E75S");
  feat({ tip: "canted" }, "B744,A332,A333,A343,A346,C17");
  feat({ tip: "curved" }, "A359,A35K");
  feat({ hump: .33 }, "B744,B748"); feat({ hump: .27 }, "B74S");
  feat({ dd: true }, "A388");
  // Propeller blade counts that differ from the family default.
  const BLADES = { DHC6: 3, SF34: 4, SW4: 3, JS41: 4, D328: 6, P3: 4, DHC7: 4, PAY2: 3, PAY3: 3, BE35: 2, BE20: 3, C208: 3, KODI: 4, SR20: 3, SR22: 3, S22T: 3,
    PA46: 3, PC12: 5, TBM7: 4, TBM8: 4, TBM9: 5, M20T: 3, DA40: 3, DA42: 3, DA62: 3, C340: 3, C414: 3, C421: 3, P28R: 2, PA32: 3, P32R: 3, BE36: 3, A400: 8 };
  // Fixed landing gear (always drawn). Tail draggers put the main wheels ahead of the wing.
  const FIXED = new Set("C150,C152,C162,C170,C172,C180,C182,C185,C206,C207,C208,PA18,CH7A,BL8,KODI,PA28,P28A,P28B,PA32,SR20,SR22,S22T,DA40,DA20,AA5,RV7,RV10,TOBA,P68".split(","));
  const TAILDRAG = new Set("C170,C180,C185,PA18,CH7A,BL8,RV7".split(","));
  const NO_STRUT = new Set("C177,C210,P210,C162".split(","));
  // Helicopters: main blades, rotor direction seen from above (+1 counterclockwise), tail type, landing gear.
  const HELI = {};
  const heli = (o, list) => list.split(",").forEach(c => { HELI[c.trim()] = o; });
  heli({ n: 2, dir: 1, tail: "tr", tn: 2, gear: "skid" }, "R22,R44,R66,B06,B505,B212");
  heli({ n: 3, dir: -1, tail: "fen", tn: 10, gear: "skid" }, "EC20,EC30");
  heli({ n: 3, dir: -1, tail: "tr", tn: 2, gear: "skid" }, "AS50,AS55");
  heli({ n: 4, dir: -1, tail: "fen", tn: 10, gear: "skid" }, "EC35,EC45");
  heli({ n: 5, dir: -1, tail: "fen", tn: 10, gear: "wheel" }, "EC55");
  heli({ n: 4, dir: -1, tail: "fen", tn: 11, gear: "wheel" }, "AS65");
  heli({ n: 5, dir: -1, tail: "tr", tn: 3, gear: "wheel" }, "EC75");
  heli({ n: 4, dir: -1, tail: "tr", tn: 5, gear: "wheel" }, "AS32");
  heli({ n: 4, dir: -1, tail: "tr", tn: 2, gear: "wheel" }, "A109,A169");
  heli({ n: 4, dir: -1, tail: "tr", tn: 2, gear: "skid" }, "A119");
  heli({ n: 5, dir: -1, tail: "tr", tn: 4, gear: "wheel" }, "A139");
  heli({ n: 4, dir: 1, tail: "tr", tn: 2, gear: "skid" }, "B407,B412");
  heli({ n: 4, dir: 1, tail: "tr", tn: 4, gear: "skid" }, "B429");
  heli({ n: 4, dir: 1, tail: "tr", tn: 4, gear: "wheel" }, "S76,S92,H60,UH60");
  heli({ n: 5, dir: 1, tail: "notar", tn: 0, gear: "skid" }, "MD52,MD60,EXPL");

  // Visual spin rates (revolutions per second). Real rates would strobe at screen refresh rates.
  const SPIN = { rotor: 1.6, tail: 6, prop: 3.2, fen: 7 };

  // Per-type measurements (meters) that override the family proportions.
  // fd: fuselage width. fh: fuselage height / width. nac: nacelle outer radius. nl: nacelle length.
  // ws: windshield panes per side (2 on 787 and A350). mask: dark A350 window surround. chev: nozzle chevrons.
  // mg: main gear [wheels per axle, axle rows]. cg: center gear [wheels per axle, rows]. doors: passenger doors per side.
  const SPEC = {};
  const spec = (o, list) => list.split(",").forEach(c => { SPEC[c.trim()] = Object.assign(SPEC[c.trim()] || {}, o); });
  spec({ fd: 3.95, nac: 1.08, nl: 4.4, doors: 2, ovw: 2 }, "A318,A319,A320,A321,A20");
  spec({ fd: 3.95, nac: 1.25, nl: 5.0, doors: 2, ovw: 2 }, "A19N,A20N,A21N");
  spec({ doors: 3 }, "A321,A21N");
  spec({ fd: 3.76, nac: 1.0, nl: 4.0, doors: 2, ovw: 2 }, "B736,B737,B738,B739");
  spec({ fd: 3.76, nac: 1.1, nl: 4.6, doors: 2, ovw: 2, chev: true }, "B37M,B38M,B39M,B3XM");
  spec({ fd: 3.76, nac: 1.2, nl: 5.0, doors: 3, ovw: 1 }, "B752,B753");
  spec({ fd: 3.7, nac: 1.1, nl: 4.4, doors: 2, ovw: 1 }, "BCS1,BCS3,A221,A223");
  spec({ fd: 5.03, nac: 1.4, nl: 5.5, doors: 3, ovw: 1 }, "B762,B763,B764,KC46");
  spec({ fd: 6.19, nac: 1.85, nl: 6.5, doors: 4, mg: [2, 3] }, "B772,B773");
  spec({ fd: 6.19, nac: 2.05, nl: 7.3, doors: 5, mg: [2, 3] }, "B77L,B77W");
  spec({ fd: 6.2, nac: 2.15, nl: 7.6, doors: 5, mg: [2, 3], chev: false }, "B778,B779");
  spec({ fd: 5.77, nac: 1.75, nl: 6.4, doors: 4, ws: 2, chev: true }, "B788,B789,B78X");
  spec({ fd: 5.64, nac: 1.55, nl: 5.6, doors: 4 }, "A332,A333,A306,A30B,A310");
  spec({ fd: 5.64, nac: 1.75, nl: 6.0, doors: 4 }, "A338,A339");
  spec({ fd: 5.64, nac: 1.1, nl: 4.8, doors: 4, cg: [2, 1] }, "A343");
  spec({ fd: 5.64, nac: 1.5, nl: 5.6, doors: 5, cg: [2, 2] }, "A346");
  spec({ fd: 5.96, nac: 1.9, nl: 6.7, doors: 4, ws: 2, mask: true }, "A359");
  spec({ fd: 5.96, nac: 1.95, nl: 6.9, doors: 4, ws: 2, mask: true, mg: [2, 3] }, "A35K");
  spec({ fd: 7.14, fh: 1.18, nac: 1.85, nl: 6.8, doors: 5, cg: [2, 3] }, "A388");
  spec({ fd: 6.5, nac: 1.5, nl: 5.6, doors: 5 }, "B744,B74S");
  spec({ fd: 6.5, nac: 1.65, nl: 6.0, doors: 5, chev: true }, "B748");
  spec({ fd: 6.02, nac: 1.45, nl: 5.5, doors: 4, cg: [2, 1] }, "MD11,DC10,L101");
  spec({ fd: 3.01, nac: .8, nl: 3.3, doors: 2 }, "E170,E75L,E75S,E190,E195");
  spec({ fd: 3.01, nac: 1.05, nl: 4.0, doors: 2 }, "E290,E295");
  spec({ fd: 3.46, nac: .9, nl: 3.6, doors: 2 }, "SU95");
  spec({ fd: 2.69, nac: .7, nl: 3.5, doors: 1, ovw: 1 }, "CRJ1,CRJ2,CRJ7,CRJ9,CRJX");
  spec({ fd: 2.28, nac: .62, nl: 3.0, doors: 1 }, "E135,E145,E35L");
  spec({ fd: 3.35, nac: .7, nl: 4.6, doors: 2, ovw: 1 }, "B712,MD81,MD82,MD83,MD87,MD88,MD90,DC93");
  spec({ fd: 3.3, nac: .75, nl: 4.2, doors: 2 }, "F100,F70");
  spec({ fd: 2.87, doors: 2 }, "AT43,AT45,AT72,AT75,AT76");
  spec({ fd: 2.69, doors: 2 }, "DH8A,DH8B,DH8C,DH8D");
  spec({ fd: 4.3, doors: 1 }, "C130,C30J");
  spec({ fd: 6.85, doors: 1 }, "C17");

  // ---------------------------------------------------------------------------------
  // Parts
  // ---------------------------------------------------------------------------------
  const tipStations = (s, kind, b) => {
    // s: last wing station. Returns extra stations continuing the wing (upward for winglets).
    const out = [];
    if (kind === "blended" || kind === "sharklet" || kind === "curved" || kind === "split") {
      const h = (kind === "curved" ? .06 : .065) * b, r = (kind === "sharklet" ? .32 : kind === "curved" ? .9 : .42) * h;
      const sw = kind === "curved" ? 55 : 42, topC = (kind === "sharklet" ? .32 : .38) * s.c;
      const angles = kind === "curved" ? [15, 30, 45, 60, 72] : [22, 45, 68, 82];
      for (const a of angles) {
        const ar = rad(a), y = s.y + r * Math.sin(ar), z = s.z + r * (1 - Math.cos(ar));
        const f = (z - s.z) / h;
        out.push({ x: s.x - (z - s.z) * Math.tan(rad(sw)) - (y - s.y) * .3, y, z, c: lerp(s.c, topC, f * .9) * (1 - .06 * f), t: s.t, cant: a });
      }
      const y = s.y + r, z = s.z + h;
      out.push({ x: s.x - h * Math.tan(rad(sw)) - r * .3, y, z, c: topC, t: s.t * .9, cant: 90 });
    } else if (kind === "canted") {
      const h = .055 * b, ca = 62;
      out.push({ x: s.x - .03 * h, y: s.y + .12 * h, z: s.z + .08 * h, c: s.c * .92, t: s.t, cant: 30 });
      out.push({ x: s.x - h * Math.tan(rad(40)), y: s.y + h * Math.cos(rad(ca)), z: s.z + h * Math.sin(rad(ca)), c: s.c * .4, t: s.t * .9, cant: ca });
    } else if (kind === "raked") {
      const l = .05 * b;
      out.push({ x: s.x - l * .6 * Math.tan(rad(50)), y: s.y + l * .6, z: s.z + l * .03, c: s.c * .65, t: s.t * .95 });
      out.push({ x: s.x - l * Math.tan(rad(58)), y: s.y + l, z: s.z + l * .05, c: s.c * .25, t: s.t * .9 });
    }
    return out;
  };

  function wingStations(o) {
    // o: {xLE, y0, z0, cr, ct, semi, sweep, dih, kink, tR, tT}
    const st = [];
    const at = (y, c, t) => ({ x: o.xLE - (y - o.y0) * Math.tan(rad(o.sweep)), y, z: o.z0 + (y - o.y0) * Math.tan(rad(o.dih)), c, t });
    st.push(at(o.y0, o.cr, o.tR));
    if (o.kink) { const yk = o.y0 + o.kink * o.semi; st.push(at(yk, lerp(o.cr, o.ct, o.kink) * .78, lerp(o.tR, o.tT, .4))); }
    st.push(at(o.y0 + o.semi * .7, lerp(o.cr, o.ct, .7) * (o.kink ? .86 : 1), lerp(o.tR, o.tT, .75)));
    st.push(at(o.y0 + o.semi, o.ct, o.tT));
    return st;
  }

  // Turbofan nacelle, intake at x0, length len, radius r, centered on (y, z).
  function turbofan(B, x0, y, z, r, len, livery, chev) {
    const c = [x0, y, z], ax = [1, 0, 0];
    if (chev) { // sawtooth chevrons on the fan nozzle (787, 747-8, 737 MAX)
      const N = 14, xr = x0 - .92 * len;
      for (let k = 0; k < N; k++) {
        const ang = t => [Math.cos(t), Math.sin(t)], a0 = 2 * Math.PI * (k - .5) / N, a1 = 2 * Math.PI * (k + .5) / N, am = 2 * Math.PI * k / N;
        const P = (t, rr, x) => { const [cy, sz] = ang(t); return [x, y + cy * rr, z + sz * rr]; };
        const nrm = t => { const [cy, sz] = ang(t); return norm([.15, cy, sz]); };
        B.tri("engine", P(a0, .745 * r, xr + .001), P(a1, .745 * r, xr + .001), P(am, .69 * r, xr - .07 * len), nrm(a0), nrm(a1), nrm(am));
      }
    }
    // Inner duct from the fan face forward, around the lip, then the outer skin to the nozzle.
    B.lathe("metal", c, ax, [[-.1 * len, .8 * r], [-.02 * len, .82 * r], [.004 * len, .86 * r], [0, .91 * r], [-.012 * len, .97 * r]], 22);
    B.lathe(livery ? "livery" : "engine", c, ax, [[-.012 * len, .97 * r], [-.07 * len, r], [-.4 * len, .99 * r], [-.75 * len, .88 * r], [-.92 * len, .74 * r]], 22);
    B.disc("dark", add(c, [-.1 * len, 0, 0]), .8 * r, ax, 22);
    B.lathe("metal", c, ax, [[-.02 * len, .01 * r], [-.05 * len, .16 * r], [-.1 * len, .27 * r]], 14);
    // Core nozzle and exhaust plug.
    B.lathe("dark", c, ax, [[-.92 * len, .74 * r], [-.9 * len, .66 * r], [-.88 * len, .6 * r]], 22);
    B.lathe("engine", c, ax, [[-.86 * len, .62 * r], [-1.02 * len, .5 * r], [-1.08 * len, .44 * r]], 18);
    B.lathe("dark", c, ax, [[-1.0 * len, .4 * r], [-1.1 * len, .3 * r], [-1.2 * len, .08 * r], [-1.22 * len, .01 * r]], 14);
  }

  function propeller(B, cen, R, n, dir, kind = "prop") {
    const spinRate = (kind === "prop" ? SPIN.prop : kind === "fen" ? SPIN.fen : SPIN.tail) * dir;
    B.part(kind, cen, { axis: [1, 0, 0], rate: spinRate });
    for (let k = 0; k < n; k++) {
      const t = 2 * Math.PI * k / n, d = [0, Math.cos(t), Math.sin(t)], tg = [0, -Math.sin(t), Math.cos(t)];
      const corner = (rr, ch, beta, side, th) => {
        const chv = add(mul(tg, Math.cos(beta) * ch / 2), mul([-1, 0, 0], Math.sin(beta) * ch / 2));
        const tv = mul(norm(cross(d, chv)), th / 2);
        return add(add(add(cen, mul(d, rr)), mul(chv, side)), tv);
      };
      const r0 = .14 * R, c0 = .14 * R, c1 = .07 * R, b0 = rad(50), b1 = rad(18), t0 = .035 * R, t1 = .012 * R;
      const top = [corner(r0, c0, b0, 1, t0), corner(r0, c0, b0, -1, t0), corner(R, c1, b1, -1, t1), corner(R, c1, b1, 1, t1)];
      const bot = [corner(r0, c0, b0, 1, -t0), corner(r0, c0, b0, -1, -t0), corner(R, c1, b1, -1, -t1), corner(R, c1, b1, 1, -t1)];
      B.hexa("blade", [...top, ...bot]);
    }
    B.main();
    B.disc("disc", cen, R, [1, 0, 0], 32);
  }

  function wheel(B, cen, r, w) {
    B.lathe("tire", cen, [0, 1, 0], [[w / 2, .55 * r], [w / 2, .85 * r], [w * .35, r], [-w * .35, r], [-w / 2, .85 * r], [-w / 2, .55 * r]], 16);
    B.disc("metal", add(cen, [0, w / 2, 0]), .56 * r, [0, 1, 0], 12, 1);
    B.disc("metal", add(cen, [0, -w / 2, 0]), .56 * r, [0, 1, 0], 12, -1);
  }
  // Strut down to a wheel set. n = wheels side by side, rows = bogie rows.
  function gearLeg(B, x, y, zTop, zG, wr, n, rows, w = wr * .7) {
    const zc = zG + wr, sr = Math.max(.04, wr * .18);
    B.tube("metal", [x, y, zTop], [x, y, zc + (rows > 1 ? wr * .3 : 0)], sr);
    const xs = rows > 1 ? [x + wr * 1.15, x - wr * 1.15] : [x];
    if (rows > 1) B.tube("metal", [xs[0], y, zc], [xs[1], y, zc], sr * .8);
    for (const xx of xs) {
      if (n === 1) wheel(B, [xx, y, zc], wr, w);
      else for (const s of [1, -1]) wheel(B, [xx, y + s * (w * .55 + sr), zc], wr, w);
      if (n > 1) B.tube("metal", [xx, y - w * .6, zc], [xx, y + w * .6, zc], sr * .6);
    }
  }

  // ---------------------------------------------------------------------------------
  // Fixed-wing aircraft
  // ---------------------------------------------------------------------------------
  function buildPlane(B, fam, L, b, code, gearDown, gearPart) {
    const F = FAM[fam], ft = FEAT[code] || {}, S = SPEC[code] || {}, D = S.fd || F.d * L, R = D / 2, ga = F.fus === "ga";
    const ey = ga ? .9 : 1, ez = ga ? 1.1 : (S.fh || (ft.dd ? 1.17 : 1.04)), hq = B.hq, q = B.q;
    const seamW = Math.max(.025, .0011 * b);
    const livery = "livery";

    // --- Fuselage ---
    let secs, cabin0, cabin1;
    if (ga) {
      const keys = [[L / 2, .42, -.1, 2], [L / 2 - .06 * L, .8, -.03, 2.2], [L / 2 - .14 * L, .97, 0, 2.6], [L / 2 - .3 * L, 1, .05, 2.8], [L / 2 - .42 * L, .9, .1, 2.6],
        [L / 2 - .55 * L, .62, .18, 2.2], [-L / 2 + .2 * L, .33, .25, 2], [-L / 2 + .04 * L, .18, .3, 2], [-L / 2, .12, .31, 2]];
      secs = smooth(keys, 3).map(([x, r, zc, e]) => ({ x, ry: r * R * ey, rz: r * R * ez, zc: zc * R, e }));
    } else {
      const Ln = 2.3 * R, Lt = 3.5 * R;
      secs = [];
      for (let i = 0, n = 12 * q; i <= n; i++) {
        const s = i / n, sx = Math.pow(s, 1.6), f = Math.max(.025, Math.pow(1 - Math.pow(1 - sx, 2.6), .55));
        secs.push({ x: L / 2 - sx * Ln, ry: f * R * ey, rz: f * R * ez, zc: -.24 * R * Math.pow(1 - sx, 2.4) });
      }
      cabin0 = L / 2 - Ln; cabin1 = -L / 2 + Lt;
      secs.push({ x: (cabin0 + cabin1) / 2, ry: R * ey, rz: R * ez, zc: 0 });
      for (let i = 0, n = 12 * q; i <= n; i++) {
        const s = i / n, g = 1 - .87 * Math.pow(s, 1.7);
        secs.push({ x: cabin1 - s * Lt, ry: g * R * ey, rz: g * R * ez * (1 - .12 * s), zc: .58 * R * Math.pow(s, 1.35) });
      }
    }
    B.loft("body", secs, 28, 0, 2 * Math.PI, { caps: true });
    const secAt = x => { // interpolated section at x
      for (let i = 0; i < secs.length - 1; i++) {
        const a = secs[i], c = secs[i + 1];
        if ((x <= a.x && x >= c.x)) { const t = (a.x - x) / (a.x - c.x || 1); return { x, ry: lerp(a.ry, c.ry, t), rz: lerp(a.rz, c.rz, t), zc: lerp(a.zc, c.zc, t), e: lerp(a.e || 2, c.e || 2, t) }; }
      }
      return secs[x > secs[0].x ? 0 : secs.length - 1];
    };
    const band = (x0, x1, th0, th1, k = 1.012, n = 6) => {
      const ss = []; for (let i = 0; i <= n; i++) { const s = secAt(lerp(x0, x1, i / n)); ss.push({ ...s, ry: s.ry * k, rz: s.rz * k, zc: s.zc }); }
      return ss;
    };
    // Cockpit windows
    if (ga) {
      B.loft("glass", band(L / 2 - .2 * L, L / 2 - .3 * L, rad(28), rad(152)), 10, rad(28), rad(152));
      B.loft("glass", band(L / 2 - .3 * L, L / 2 - .47 * L, rad(-4), rad(42)), 6, rad(-4), rad(42));
      B.loft("glass", band(L / 2 - .3 * L, L / 2 - .47 * L, rad(138), rad(184)), 6, rad(138), rad(184));
    } else {
      if (S.mask) B.loft("dark", band(L / 2 - .5 * R, L / 2 - 1.3 * R, 0, 0, 1.006), 12, rad(12), rad(168));
      B.loft("glass", band(L / 2 - .62 * R, L / 2 - 1.12 * R, 0, 0, 1.01), 12, rad(22), rad(158));
      // Window frame posts: thin body-colored strips break the band into panes.
      for (const a of S.ws === 2 ? [52, 90, 128] : [40, 64, 90, 116, 140]) {
        const ar = rad(a), ss = band(L / 2 - .6 * R, L / 2 - 1.14 * R, 0, 0, 1.02);
        B.loft("body", ss, 1, ar - rad(1.6), ar + rad(1.6));
      }
    }
    // Upper deck (747 hump)
    if (ft.hump) {
      const xe = L / 2 - ft.hump * L, zc = .42 * R;
      const keys = [[L / 2 - .35 * R, .3, .78], [L / 2 - .9 * R, .52, 1.12], [L / 2 - 1.8 * R, .62, 1.36], [L / 2 - 3 * R, .64, 1.44], [xe + .6 * R, .64, 1.44], [xe - .4 * R, .55, 1.3], [xe - 1.6 * R, .3, 1.05]];
      B.loft("body", smooth(keys, 3).map(([x, ry, top]) => ({ x, ry: ry * R, rz: (top - .42) * R, zc })), 24, 0, 2 * Math.PI, { caps: true });
      B.loft("glass", smooth([[L / 2 - .45 * R, .32, .8], [L / 2 - .85 * R, .5, 1.1]], 2).map(([x, ry, top]) => ({ x, ry: ry * R * 1.03, rz: (top - .42) * R * 1.03, zc })), 10, rad(25), rad(155));
      windows(B, { x0: L / 2 - 2.2 * R, x1: xe + .4 * R, ry: .64 * R, rz: 1.02 * R, zc, th: rad(18), pitch: .53, w: .26, h: .36 });
    }
    // Cabin windows and doors
    if (!ga && F.win !== "none") {
      const biz = F.win === "biz";
      const w = biz ? .34 : .25, h = biz ? .42 : .36, pitch = biz ? Math.max(.85, L * .055) : .53;
      const xa = cabin0 - (biz ? .3 * R : .55 * R) - 1.1, xb = cabin1 + (biz ? .6 * R : .4 * R);
      windows(B, { x0: xa, x1: xb, ry: R * ey, rz: R * ez, zc: 0, th: Math.asin(Math.min(.5, (ft.dd ? -.2 : .2) / ez)), pitch, w: Math.min(w, .06 * R * 4), h: Math.min(h, .08 * R * 4) });
      if (ft.dd) windows(B, { x0: xa - .5, x1: xb + 2, ry: R * ey, rz: R * ez, zc: 0, th: Math.asin(.42), pitch, w, h });
      // Doors: forward and aft outlines on both sides.
      const dW = biz ? .8 : 1.0, dH = biz ? 1.5 : 1.9, nd = biz ? 1 : (S.doors || 2);
      const xd0 = cabin0 - .3 * R, xd1 = cabin1 + .3 * R + dW;
      for (let k = 0; k < nd; k++) door(B, nd === 1 ? xd0 : lerp(xd0, xd1, k / (nd - 1)), dW, dH, R * ey, R * ez);
      if (hq && !biz) {
        const xWc = F.wx * L + F.cr * b * .5 - .45 * F.cr * b;
        for (let k = 0; k < (S.ovw || 0); k++) door(B, xWc + (k - ((S.ovw || 0) - 1) / 2) * 1.1 + .25, .5, .95, R * ey, R * ez); // overwing exits
        if (R > 1.3) for (const xc of [cabin0 - 1.6 * R, cabin1 + 2.2 * R]) door(B, xc, Math.min(3, 1.4 * R), Math.min(1.8, .8 * R), R * ey, R * ez, rad(-40), [-1]); // cargo doors, right side
      }
    }

    // --- Wing ---
    const zW = F.wing === "high" ? .82 * R * ez : -.55 * R * ez, y0 = .45 * R, semiFull = b / 2 - y0;
    const tipK = ft.tip, rakedLen = tipK === "raked" ? .05 * b : 0, semi = semiFull - rakedLen;
    const cr = F.cr * b, ct = cr * F.taper, xW = F.wx * L + cr / 2;
    const jet = F.sweep > 15, tR = ga ? .15 : jet ? .14 : .17, tT = ga ? .12 : jet ? .1 : .13;
    const wing = { xLE: xW, y0, z0: zW, cr, ct, semi, sweep: F.sweep, dih: F.dih, kink: jet && !ga && fam !== "bizjet" && fam !== "bizjet3" ? .32 : 0, tR, tT };
    let wst = wingStations(wing);
    const extra = tipK && tipK !== "fence" ? tipStations(wst[wst.length - 1], tipK, b) : [];
    if (hq && extra.length && tipK !== "raked") {
      B.foil("body", wst, { mirror: true, camber: .012, n: 10 });
      B.foil(livery, [wst[wst.length - 1], ...extra], { mirror: true, camber: .012, n: 10 }); // painted winglets
    } else B.foil("body", wst.concat(extra), { mirror: true, camber: .012, n: 10 });
    // Station at a fraction of the semi-span (main wing only).
    const stAt = f => {
      const y = y0 + f * semi;
      for (let k = 0; k < wst.length - 1; k++) if (y >= wst[k].y - 1e-6 && y <= wst[k + 1].y + 1e-6) return stLerp(wst[k], wst[k + 1], (y - wst[k].y) / ((wst[k + 1].y - wst[k].y) || 1));
      return wst[wst.length - 1];
    };
    if (hq) {
      // Control surface outlines: flaps, ailerons, spoilers and slats.
      const line = (f0, f1, u0, u1, side = 1) => { for (const fl of [false, true]) B.seam(stAt(f0), stAt(f1), u0, u1, side, seamW, .012, fl); };
      const ail0 = jet ? .72 : .66, flapU = jet ? .74 : .72;
      line(.04, ail0 - .02, flapU, flapU); line(ail0, .97, .76, .76); line(.04, .04, flapU, .99);
      line(ail0 - .02, ail0 - .02, flapU, .99); line(ail0, ail0, .76, .99); line(.97, .97, .76, .99);
      line(.04, ail0 - .02, flapU, flapU, -1); line(ail0, .97, .76, .76, -1);
      if (jet && !ga) {
        line(.16, .96, .1, .1); line(.32, .68, .6, .6);
        for (let k = 0; k <= 4; k++) { const f = lerp(.32, .68, k / 4); line(f, f, .6, flapU); }
      }
      // Navigation lights: red on the left wingtip, green on the right, white tail, red beacons.
      const tip = wst[wst.length - 1], lr = Math.max(.07, .0035 * b), tp = [tip.x - .3 * tip.c, tip.y + lr * .6, tip.z];
      B.light("navR", tp, lr); B.light("navG", mirrorY(tp), lr);
      B.light("strobe", [tip.x - .75 * tip.c, tip.y + lr * .5, tip.z], lr * .8); B.light("strobe", mirrorY([tip.x - .75 * tip.c, tip.y + lr * .5, tip.z]), lr * .8);
    }
    if (tipK === "fence") {
      const s = wst[wst.length - 1], h = .022 * b;
      B.foil("body", [{ x: s.x + .1 * s.c, y: s.y + .02, z: s.z - .45 * h, c: s.c * .9, t: .08, cant: 90 }, { x: s.x - .05 * s.c, y: s.y + .02, z: s.z + h, c: s.c * .55, t: .08, cant: 90 }], { mirror: true });
    }
    if (tipK === "split") {
      const s = wst[wst.length - 1], h = .025 * b;
      B.foil("body", [{ x: s.x - .05 * s.c, y: s.y - .05, z: s.z, c: s.c * .75, t: .09, cant: -90 }, { x: s.x - .45 * s.c, y: s.y + .15 * h, z: s.z - h, c: s.c * .3, t: .09, cant: -70 }], { mirror: true });
    }
    const wingAt = y => {
      const i = Math.max(0, wst.findIndex((s, k) => k < wst.length - 1 && y >= s.y && y <= wst[k + 1].y));
      const a = wst[i], c = wst[i + 1] || a, t = (y - a.y) / ((c.y - a.y) || 1);
      return { x: lerp(a.x, c.x, t), z: lerp(a.z, c.z, t), c: lerp(a.c, c.c, t) };
    };
    // Belly fairing and flap-track fairings on airliners
    if (!ga && F.wing === "low" && fam !== "bizjet" && fam !== "bizjet3" && fam !== "kingair") {
      const keys = [[xW + .25 * cr, .55, -.6, .25], [xW, .85, -.62, .4], [xW - .5 * cr, .92, -.6, .45], [xW - 1.05 * cr, .85, -.58, .4], [xW - 1.45 * cr, .4, -.5, .2]];
      B.loft("body", smooth(keys, 3).map(([x, ry, zc, rz]) => ({ x, ry: ry * R, rz: rz * R, zc: zc * R })), 18, 0, 2 * Math.PI, { caps: true });
    }
    if (jet && !ga && fam !== "bizjet" && fam !== "bizjet3") {
      for (const f of [.22, .42, .62, .8]) for (const sg of [1, -1]) {
        const y = y0 + f * semi, w = wingAt(y), xt = w.x - w.c, r = .055 * w.c;
        B.loft("body", [{ x: xt + .45 * w.c, ry: r * .2, rz: r * .3, yc: y * sg, zc: w.z - r * .2 }, { x: xt + .1 * w.c, ry: r * .7, rz: r, yc: y * sg, zc: w.z - r * .9 },
          { x: xt - .15 * w.c, ry: r * .5, rz: r * .7, yc: y * sg, zc: w.z - r * .6 }, { x: xt - .3 * w.c, ry: r * .05, rz: r * .05, yc: y * sg, zc: w.z - r * .1 }], 8);
      }
    }
    // High-wing struts
    if (fam === "singlehigh" && !NO_STRUT.has(code)) {
      const ys = .55 * semi + y0, w = wingAt(ys);
      for (const s of [1, -1]) {
        B.tube("body", [w.x - .25 * w.c, ys * s, w.z - .05 * w.c], [xW - .3 * cr, .75 * R * s, -.45 * R], .035 * cr * .5 + .02, 8);
      }
    }

    // --- Tail ---
    const hf = F.fin * b * (ga ? 1.1 : 1), fcr = (ga ? .9 : 1.05) * hf, fct = .45 * fcr, finSweep = ga ? 25 : 38;
    const finX = -L / 2 + .015 * L + fcr, finZ = (ga ? .2 : .5) * R;
    const xT = finX - hf * Math.tan(rad(finSweep)), zTop = finZ + hf;
    B.foil(livery, [{ x: finX + .25 * fcr, y: 0, z: finZ - .35 * R, c: fcr * 1.25, t: .1, cant: 90 }, { x: finX, y: 0, z: finZ, c: fcr, t: .1, cant: 90 },
      { x: xT, y: 0, z: zTop, c: fct, t: .1, cant: 90 }], { n: 8 });
    // Dorsal fillet
    if (!ga) B.foil(livery, [{ x: finX + .7 * fcr, y: 0, z: finZ - .2 * R, c: .7 * fcr, t: .05, cant: 90 }, { x: finX + .05 * fcr, y: 0, z: finZ + .22 * hf, c: .1 * fcr, t: .1, cant: 90 }], { n: 6 });
    const hb = F.hs * b, hcr = (ga ? .4 : .28) * hb, hsw = ga ? 0 : (F.sweep > 10 ? 30 : 6);
    if (F.tail === "T") {
      B.foil("body", [{ x: xT + .05 * fct, y: 0, z: zTop - .03 * hf, c: fct * 1.05, t: .09 }, { x: xT + .05 * fct - hb / 2 * Math.tan(rad(hsw)), y: hb / 2, z: zTop - .03 * hf, c: fct * .45, t: .08 }], { mirror: true, n: 8 });
    } else {
      const hx = -L / 2 + .02 * L + hcr * 1.1, hz = .25 * R, hy0 = .15 * R;
      B.foil("body", [{ x: hx, y: hy0, z: hz, c: hcr, t: .09 }, { x: hx - (hb / 2 - hy0) * Math.tan(rad(hsw)), y: hb / 2, z: hz + (hb / 2) * Math.tan(rad(ga ? 0 : 6)), c: hcr * .4, t: .08 }], { mirror: true, n: 8 });
    }

    if (hq) {
      const f0 = { x: finX, y: 0, z: finZ, c: fcr, t: .1, cant: 90 }, f1 = { x: xT, y: 0, z: zTop, c: fct, t: .1, cant: 90 };
      for (const sd of [1, -1]) B.seam(stLerp(f0, f1, .04), stLerp(f0, f1, .92), .66, .66, sd, seamW);
      const last = secs[secs.length - 1], lr = Math.max(.07, .0035 * b);
      if (!ga) {
        B.disc("dark", [last.x - .005, 0, last.zc], Math.max(last.ry, .08) * .9, [1, 0, 0], 12, -1); // APU exhaust
        B.light("navW", [last.x - lr * 1.2, 0, last.zc + Math.max(last.rz, .1) + lr], lr);
      } else B.light("navW", [xT - fct * .9, 0, zTop - .1], lr);
      const xb = F.wx * L + F.cr * b * .2;
      B.light("beacon", [xb, 0, R * ez + lr * .6], lr * 1.2); B.light("beacon", [xb, 0, -R * ez - lr * .6], lr * 1.2);
      // Antennas on the crown and belly, pitot probes by the nose.
      const ant = (x, up) => B.foil("metal", [{ x, y: 0, z: up * R * ez * .98, c: .5 * Math.min(1, R / 1.8), t: .14, cant: 90 * up },
        { x: x - .3 * Math.min(1, R / 1.8), y: 0, z: up * (R * ez + .32 * Math.min(1, R / 1.8)), c: .22 * Math.min(1, R / 1.8), t: .12, cant: 90 * up }], { n: 5 });
      if (!ga) { ant(cabin0 - .6 * R, 1); ant(xb - 2 * R, 1); ant(xb + 1.5 * R, -1); }
      const nose = secAt(L / 2 - .9 * R);
      if (!ga) for (const sd of [1, -1]) B.tube("metal", [L / 2 - .9 * R, sd * nose.ry * .92, nose.zc - nose.rz * .35], [L / 2 - .9 * R + .2 * Math.min(1, R / 1.8), sd * (nose.ry * .92 + .12), nose.zc - nose.rz * .35], .018, 6);
    }

    // --- Engines ---
    const E = F.eng;
    if (E.mount === "wing" || E.mount === "tri" || E.mount === "propwing") {
      const prop = E.mount === "propwing";
      const r = S.nac || (prop ? E.r * D * .9 : E.r * D), len = S.nl || E.len * L;
      const fr = E.n === 4 ? [.3, .56] : prop ? [ga ? .3 : .33] : [.34];
      for (const f of fr) for (const s of [1, -1]) {
        const y = f * b / 2, w = wingAt(y);
        if (prop) {
          const zc = F.wing === "high" ? w.z - r * .35 : w.z + r * .2, x0 = w.x + len * .45;
          B.lathe("engine", [x0, y * s, zc], [1, 0, 0], [[0, .55 * r], [-.08 * len, .9 * r], [-.25 * len, r], [-.6 * len, .95 * r], [-.85 * len, .6 * r], [-len, .2 * r], [-1.02 * len, .02 * r]], 18);
          B.lathe("dark", [x0, y * s, zc], [1, 0, 0], [[.001, .4 * r], [0, .55 * r]], 18);
          B.lathe("metal", [x0, y * s, zc], [1, 0, 0], [[r * .9, .01], [r * .55, .3 * r], [0, .45 * r]], 14);
          propeller(B, [x0 + r * .3, y * s, zc], F.prop * b, BLADES[code] || F.blades, s);
        } else {
          const zc = w.z - r * 1.15, x0 = w.x + len * .45;
          turbofan(B, x0, y * s, zc, r, len, false, hq && S.chev);
          // Pylon
          B.foil("engine", [{ x: x0 - .2 * len, y: y * s, z: zc + .55 * r, c: .95 * len, t: Math.min(.3, .22 * r / len) }, { x: w.x + .05 * w.c, y: y * s, z: w.z, c: .75 * w.c, t: Math.min(.25, .2 * r / w.c) }],
            { n: 6 });
        }
      }
      if (E.mount === "tri") {
        const r = E.r * D * .95, len = E.len * L * 1.2, x0 = -L / 2 + .05 * L + fcr * 1.05, zc = .5 * R + hf * .2;
        turbofan(B, x0, 0, zc, r, len);
      }
    } else if (E.mount === "rear" || E.mount === "rear3") {
      const r = S.nac || E.r * D, len = S.nl ? S.nl / .85 : E.len * L, xc = -L / 2 + .27 * L, x0 = xc + len / 2, yy = R * .95 + r * 1.05, zc = .3 * R;
      for (const s of [1, -1]) {
        turbofan(B, x0, yy * s, zc, r, len * .85);
        B.foil("engine", [{ x: xc + .2 * len, y: R * .5 * s, z: zc, c: .55 * len, t: .14 }, { x: xc + .1 * len, y: (yy - r * .6) * s, z: zc, c: .45 * len, t: .14 }], { n: 6 });
      }
      if (E.mount === "rear3") turbofan(B, x0 - .02 * L, 0, R * .75 + r * .7, r * .9, len * .8);
    } else if (E.mount === "propnose") {
      B.lathe("metal", [L / 2, 0, -.05 * R], [1, 0, 0], [[.5 * R, .01], [.35 * R, .2 * R], [.08 * R, .33 * R], [0, .36 * R]], 14);
      propeller(B, [L / 2 + .12 * R, 0, -.05 * R], F.prop * b, BLADES[code] || F.blades, 1);
    }

    // --- Landing gear ---
    const fixed = FIXED.has(code), gear = gearDown || fixed || gearPart;
    if (gear) {
      if (gearPart && !fixed) B.use("gear");
      const G = F.gear, wr = Math.max(.18, G.wr * R), zG = -R * ez - G.h * R * 2 * .5;
      const xm = ga ? (TAILDRAG.has(code) ? xW + .1 * cr : xW - .75 * cr) : xW - .62 * cr, ym = G.track * R;
      const n = ga || fam === "turboprop4" ? 1 : 2, rows = S.mg ? S.mg[1] : G.bogie;
      if (ga) {
        for (const s of [1, -1]) {
          B.tube("metal", [xm, .55 * R * s, -.75 * R * ez], [xm - .05 * cr, ym * s, zG + wr], .05);
          wheel(B, [xm - .05 * cr, ym * s, zG + wr], wr, wr * .7);
        }
        if (TAILDRAG.has(code)) { B.tube("metal", [-L / 2 + .12 * L, 0, .05 * R], [-L / 2 + .08 * L, 0, zG + wr * .45 - .05 * L * .3], .03); wheel(B, [-L / 2 + .08 * L, 0, zG + wr * .45 - .05 * L * .3], wr * .45, wr * .35); }
        else { const xn = L / 2 - .06 * L; B.tube("metal", [xn, 0, -.6 * R], [xn, 0, zG + wr * .85], .05); wheel(B, [xn, 0, zG + wr * .85], wr * .85, wr * .6); }
      } else {
        const wy = ym > 1.2 * R ? zW : -.6 * R * ez;
        for (const s of [1, -1]) {
          gearLeg(B, xm, ym * s, wy, zG, wr, S.mg ? S.mg[0] : n, rows);
          if (hq) { // gear door beside the strut
            const dz0 = wy - .1, dz1 = zG + wr * 2.4, yd = ym * s + s * (wr * .9 + .08);
            B.hexa("body", [[xm + wr * .9, yd, dz0], [xm - wr * .9, yd, dz0], [xm - wr * .9, yd, dz1], [xm + wr * .9, yd, dz1],
              [xm + wr * .9, yd + s * .04, dz0], [xm - wr * .9, yd + s * .04, dz0], [xm - wr * .9, yd + s * .04, dz1], [xm + wr * .9, yd + s * .04, dz1]]);
          }
        }
        if (S.cg) gearLeg(B, xm - .25 * cr, 0, -.7 * R, zG, wr, S.cg[0], S.cg[1]);
        if (G.body) for (const s of [1, -1]) gearLeg(B, xm - .9 * cr * .5, .6 * R * s, -.7 * R, zG, wr, 2, 2);
        const xn = L / 2 - (fam === "bizjet" || fam === "bizjet3" ? .14 : .1) * L;
        gearLeg(B, xn, 0, -.6 * R * ez, zG, wr * .85, 2, 1);
      }
      if (gearPart && !fixed) B.gearLift = -zG; else B.lift = -zG;
      B.main();
    }
    return B;
  }

  // Row of cabin windows on both sides of a fuselage section {ry, rz, zc} at angle th above the side.
  function windows(B, o) {
    const n = Math.max(1, Math.floor((o.x0 - o.x1) / o.pitch));
    for (let k = 0; k <= n; k++) {
      const x = o.x0 - k * o.pitch;
      for (const s of [1, -1]) {
        const pt = (dx, dth) => { const t = o.th + dth; return [x + dx, s * o.ry * 1.006 * Math.cos(t), o.zc + o.rz * 1.006 * Math.sin(t)]; };
        const dth = o.h / 2 / o.rz;
        const ref = [x, 0, o.zc];
        B.quad("glass", pt(o.w / 2, -dth), pt(-o.w / 2, -dth), pt(-o.w / 2, dth), pt(o.w / 2, dth), ref);
      }
    }
  }
  function door(B, x, w, h, ry, rz, thc = 0, sides = [1, -1]) {
    const th0 = thc - h * .45 / rz, th1 = thc + h * .55 / rz, f = 1.007, lw = .05;
    for (const s of sides) {
      const pt = (xx, t) => [xx, s * ry * f * Math.cos(t), rz * f * Math.sin(t)];
      const ref = [x, 0, 0];
      const line = (a, b, c, d) => B.quad("seam", a, b, c, d, ref);
      line(pt(x, th0), pt(x - lw, th0), pt(x - lw, th1), pt(x, th1));
      line(pt(x - w + lw, th0), pt(x - w, th0), pt(x - w, th1), pt(x - w + lw, th1));
      line(pt(x, th1 - lw / rz), pt(x - w, th1 - lw / rz), pt(x - w, th1), pt(x, th1));
      line(pt(x, th0), pt(x - w, th0), pt(x - w, th0 + lw / rz), pt(x, th0 + lw / rz));
    }
  }

  // Catmull-Rom smoothing of keyframes [[x, ...values]]; sub = points per span.
  function smooth(keys, sub) {
    const out = [];
    for (let i = 0; i < keys.length - 1; i++) {
      const p0 = keys[Math.max(0, i - 1)], p1 = keys[i], p2 = keys[i + 1], p3 = keys[Math.min(keys.length - 1, i + 2)];
      for (let k = 0; k < sub; k++) {
        const t = k / sub, t2 = t * t, t3 = t2 * t;
        out.push(p1.map((_, d) => .5 * ((2 * p1[d]) + (-p0[d] + p2[d]) * t + (2 * p0[d] - 5 * p1[d] + 4 * p2[d] - p3[d]) * t2 + (-p0[d] + 3 * p1[d] - 3 * p2[d] + p3[d]) * t3)));
      }
    }
    out.push(keys[keys.length - 1].slice());
    return out;
  }

  // ---------------------------------------------------------------------------------
  // Helicopters
  // ---------------------------------------------------------------------------------
  function buildHeli(B, L, rotorD, code) {
    const H = HELI[code] || { n: 4, dir: -1, tail: "tr", tn: 2, gear: "skid" };
    const Lb = .86 * L, Rp = .085 * L, xs = Lb / 2 - .02 * L, livery = "livery";
    const podLen = .46 * Lb, xm = xs - .3 * Lb; // mast position
    // Cabin pod
    const keys = [[xs, .2, -.25], [xs - .04 * Lb, .62, -.12], [xs - .1 * Lb, .9, 0], [xs - .2 * Lb, 1, .06], [xs - .32 * Lb, .98, .1], [xs - podLen, .7, .22], [xs - podLen - .06 * Lb, .42, .4]];
    const pod = smooth(keys, 3).map(([x, r, zc]) => ({ x, ry: r * Rp * .86, rz: r * Rp * 1.08, zc: zc * Rp, e: 2.2 }));
    B.loft(livery, pod, 24, 0, 2 * Math.PI, { caps: true });
    // Canopy glass: upper front of the pod.
    const glass = pod.filter(s => s.x > xs - .2 * Lb).map(s => ({ ...s, ry: s.ry * 1.012, rz: s.rz * 1.012 }));
    B.loft("glass", glass, 14, rad(-30), rad(210));
    B.loft("body", pod.filter(s => s.x <= xs - .19 * Lb && s.x >= xs - .3 * Lb).map(s => ({ ...s, ry: s.ry * 1.014, rz: s.rz * 1.014 })), 8, rad(-8), rad(40));
    B.loft("glass", pod.filter(s => s.x <= xs - .2 * Lb && s.x >= xs - .29 * Lb).map(s => ({ ...s, ry: s.ry * 1.016, rz: s.rz * 1.016 })), 6, rad(-6), rad(34));
    B.loft("glass", pod.filter(s => s.x <= xs - .2 * Lb && s.x >= xs - .29 * Lb).map(s => ({ ...s, ry: s.ry * 1.016, rz: s.rz * 1.016 })), 6, rad(146), rad(186));
    // Engine cowling and mast
    const cz = .95 * Rp;
    B.loft("body", smooth([[xm + .1 * Lb, .05, .05], [xm + .04 * Lb, .42, .3], [xm - .1 * Lb, .48, .36], [xm - .2 * Lb, .3, .22], [xm - .24 * Lb, .12, .08]], 2)
      .map(([x, ry, rz]) => ({ x, ry: ry * Rp, rz: rz * Rp, zc: cz })), 16, 0, 2 * Math.PI, { caps: true });
    const zh = cz + .62 * Rp;
    B.tube("metal", [xm, 0, cz + .2 * Rp], [xm, 0, zh], .09 * Rp, 10);
    // Tail boom
    const xb0 = xs - podLen + .02 * Lb, xb1 = -Lb / 2, zb = .38 * Rp;
    B.loft(H.tail === "notar" ? livery : "body", [{ x: xb0, ry: .34 * Rp, rz: .34 * Rp, zc: zb }, { x: lerp(xb0, xb1, .5), ry: .2 * Rp, rz: .22 * Rp, zc: zb + .05 * Rp }, { x: xb1 + .04 * Lb, ry: .14 * Rp, rz: .16 * Rp, zc: zb + .1 * Rp },
      { x: xb1, ry: .1 * Rp, rz: .12 * Rp, zc: zb + .1 * Rp }].map(s => H.tail === "notar" ? { ...s, ry: s.ry * 1.35, rz: s.rz * 1.35 } : s), 14, 0, 2 * Math.PI, { caps: true });
    // Horizontal stabilizer
    const xhs = lerp(xb0, xb1, .72), hsY = .18 * L * (H.tail === "notar" ? .9 : .75);
    B.foil("body", [{ x: xhs + .025 * L, y: .12 * Rp, z: zb + .06 * Rp, c: .06 * L, t: .12 }, { x: xhs + .02 * L, y: hsY / 2, z: zb + .06 * Rp, c: .045 * L, t: .1 }], { mirror: true, n: 6 });
    const xf = xb1 + .05 * L, zf = zb + .1 * Rp;
    if (H.tail === "notar") {
      for (const s of [1, -1]) B.foil(livery, [{ x: xhs + .025 * L, y: s * hsY / 2, z: zb - .05 * L, c: .05 * L, t: .1, cant: 90 }, { x: xhs + .015 * L, y: s * hsY / 2, z: zb + .1 * L, c: .035 * L, t: .1, cant: 90 }], { n: 6 });
      B.lathe("dark", [xb1, 0, zb + .1 * Rp], [1, 0, 0], [[.001, .06 * Rp], [0, .14 * Rp]], 12);
    } else if (H.tail === "fen") {
      const rf = .045 * L, xc = xf - .01 * L, zc = zf + .3 * rf;
      // Shrouded fan in a thick fin
      B.foil(livery, [{ x: xc + 1.5 * rf, y: 0, z: zc - 1.1 * rf, c: 2.9 * rf, t: .2, cant: 90 }, { x: xc + 1.4 * rf, y: 0, z: zc + 1.2 * rf, c: 2.3 * rf, t: .18, cant: 90 },
        { x: xc + 1.4 * rf - .07 * L, y: 0, z: zc + 1.2 * rf + .08 * L, c: .045 * L, t: .12, cant: 90 }], { n: 8 });
      B.lathe(livery, [xc, 0, zc], [0, 1, 0], [[-.26 * rf, 1.2 * rf], [-.26 * rf, .98 * rf], [.26 * rf, .98 * rf], [.26 * rf, 1.2 * rf]], 24);
      B.disc("dark", [xc, -.02 * rf, zc], .98 * rf, [0, 1, 0], 24, -1);
      B.disc("dark", [xc, .02 * rf, zc], .98 * rf, [0, 1, 0], 24, 1);
      B.part("fen", [xc, 0, zc], { axis: [0, 1, 0], rate: SPIN.fen * H.dir });
      for (let k = 0; k < H.tn; k++) {
        const t = 2 * Math.PI * k / H.tn, d = [Math.cos(t), 0, Math.sin(t)], tg = [-Math.sin(t), 0, Math.cos(t)];
        const p = (rr, sd, th) => add(add(add([xc, 0, zc], mul(d, rr)), mul(tg, sd * .07 * rf)), [0, th * .1 * rf, 0]);
        B.hexa("blade", [p(.2 * rf, 1, 1), p(.2 * rf, -1, -1), p(.95 * rf, -1, -1), p(.95 * rf, 1, 1), p(.2 * rf, 1, 1.3), p(.2 * rf, -1, -.7), p(.95 * rf, -1, -.7), p(.95 * rf, 1, 1.3)]);
      }
      B.main();
      B.lathe("metal", [xc, 0, zc], [0, 1, 0], [[-.12 * rf, .01], [-.06 * rf, .18 * rf], [.06 * rf, .18 * rf], [.12 * rf, .01]], 12);
    } else {
      // Fin with a tail rotor on the left side
      const fh = .16 * L;
      B.foil(livery, [{ x: xf + .05 * L, y: 0, z: zf - .02 * L, c: .08 * L, t: .12, cant: 90 }, { x: xf + .05 * L - fh * Math.tan(rad(35)), y: 0, z: zf + fh, c: .05 * L, t: .1, cant: 90 }], { n: 6 });
      const tr = .095 * rotorD, xr = xf + .02 * L - .5 * fh * Math.tan(rad(35)), zr = zf + .55 * fh, yr = .05 * Rp + .03 * L;
      B.tube("metal", [xr, 0, zr], [xr, yr, zr], .03 * Rp + .02, 8);
      B.part("tail", [xr, yr, zr], { axis: [0, 1, 0], rate: SPIN.tail * H.dir });
      bladeSet(B, [xr, yr, zr], [0, 1, 0], tr, H.tn, .17 * tr, .03 * tr, 0);
      B.main();
      B.disc("disc", [xr, yr, zr], tr, [0, 1, 0], 24);
    }
    // Main rotor
    B.part("rotor", [xm, 0, zh], { axis: [0, 0, 1], rate: SPIN.rotor * H.dir });
    B.lathe("metal", [xm, 0, zh], [0, 0, 1], [[-.08 * Rp, .01], [-.06 * Rp, .2 * Rp], [.06 * Rp, .2 * Rp], [.12 * Rp, .01]], 12);
    bladeSet(B, [xm, 0, zh], [0, 0, 1], rotorD / 2, H.n, .055 * rotorD / 2, .012 * rotorD / 2, .025);
    B.main();
    B.disc("disc", [xm, 0, zh + .02], rotorD / 2, [0, 0, 1], 40);
    // Landing gear
    const zg = -1.4 * Rp;
    if (H.gear === "skid") {
      const yk = .85 * Rp, x0 = xs - .08 * Lb, x1 = xs - .55 * Lb;
      for (const s of [1, -1]) {
        B.tubePath("metal", [[x0 + .05 * Lb, s * yk, zg + .25 * Rp], [x0, s * yk, zg + .05 * Rp], [x0 - .03 * Lb, s * yk, zg], [x1, s * yk, zg]], .05 * Rp + .015, 8);
        for (const x of [lerp(x0, x1, .2), lerp(x0, x1, .78)]) B.tubePath("metal", [[x, s * yk, zg], [x, s * yk * .9, zg + .3 * Rp], [x, s * .45 * Rp, -.75 * Rp]], .045 * Rp + .012, 8);
      }
    } else {
      const wr = .2 * Rp;
      const xn = xs - .1 * Lb;
      B.tube("metal", [xn, 0, -.7 * Rp], [xn, 0, zg + wr], .05 * Rp + .02); wheel(B, [xn, 0, zg + wr], wr, wr * .7);
      for (const s of [1, -1]) {
        const xw = xs - .4 * Lb;
        B.loft(livery, [{ x: xw + .1 * Lb, ry: .05 * Rp, rz: .05 * Rp, yc: s * .85 * Rp, zc: -.6 * Rp }, { x: xw + .03 * Lb, ry: .28 * Rp, rz: .2 * Rp, yc: s * .95 * Rp, zc: -.62 * Rp },
          { x: xw - .08 * Lb, ry: .2 * Rp, rz: .16 * Rp, yc: s * .92 * Rp, zc: -.6 * Rp }, { x: xw - .12 * Lb, ry: .03 * Rp, rz: .03 * Rp, yc: s * .85 * Rp, zc: -.58 * Rp }], 12);
        B.tube("metal", [xw, s * .95 * Rp, -.62 * Rp], [xw, s * 1.05 * Rp, zg + wr], .05 * Rp + .02);
        wheel(B, [xw, s * 1.05 * Rp, zg + wr], wr * 1.1, wr * .75);
      }
    }
    if (B.hq) {
      const lr = Math.max(.06, .006 * L);
      B.light("navR", [xhs + .01 * L, hsY / 2 + lr, zb + .06 * Rp], lr); B.light("navG", [xhs + .01 * L, -hsY / 2 - lr, zb + .06 * Rp], lr);
      B.light("navW", [xb1 - lr, 0, zb + .1 * Rp], lr); B.light("beacon", [xm - .14 * Lb, 0, cz + .38 * Rp], lr * 1.2);
      B.light("beacon", [xs - .3 * Lb, 0, -1.08 * Rp], lr);
      // Cabin door outlines and exhaust stacks
      const mid = pod[Math.floor(pod.length * .45)];
      door(B, xs - .2 * Lb, .2 * Lb, 1.1 * Rp, mid.ry * 1.01, mid.rz * 1.01);
      for (const sd of [1, -1]) B.lathe("dark", [xm - .17 * Lb, sd * .3 * Rp, cz + .1 * Rp], [-1, sd * .5, .2], [[0, .1 * Rp], [.12 * Lb, .1 * Rp]], 10);
    }
    B.lift = -zg;
    return B;
  }
  // Rotor blades around an axis: radius R, chord c, thickness t, droop (fraction of R).
  function bladeSet(B, cen, axis, R, n, c, t, droop) {
    const [e1, e2] = basis(axis);
    for (let k = 0; k < n; k++) {
      const th = 2 * Math.PI * k / n, d = add(mul(e1, Math.cos(th)), mul(e2, Math.sin(th))), tg = cross(axis, d);
      const p = (rr, sd, up) => add(add(add(add(cen, mul(d, rr)), mul(tg, sd * c / 2)), mul(axis, up * t / 2)), mul(axis, -droop * R * (rr / R) ** 2));
      const r0 = .1 * R, seg = (mat, a, b2) => B.hexa(mat, [p(a, 1, 1), p(a, -1, .6), p(b2, -1, .6), p(b2, 1, 1), p(a, 1, -.6), p(a, -1, -1), p(b2, -1, -1), p(b2, 1, -.6)]);
      if (B.hq) { seg("blade", r0, .93 * R); seg("tip", .93 * R, R); } else seg("blade", r0, R);
    }
  }

  // ---------------------------------------------------------------------------------
  // glTF writer
  // ---------------------------------------------------------------------------------
  const MATS = {
    body: { c: [.92, .93, .94, 1], m: .05, r: .45 }, engine: { c: [.62, .64, .68, 1], m: .5, r: .4 }, metal: { c: [.72, .74, .77, 1], m: .85, r: .3 },
    dark: { c: [.04, .045, .05, 1], m: .2, r: .6 }, glass: { c: [.03, .05, .08, 1], m: .6, r: .12 }, tire: { c: [.05, .05, .05, 1], m: 0, r: .85 },
    seam: { c: [.62, .64, .67, 1], m: .05, r: .6 }, blade: { c: [.13, .13, .14, 1], m: .3, r: .5 },
    disc: { c: [.15, .15, .16, .12], blend: true }, livery: { c: null, m: .05, r: .4 }, tip: { c: [.95, .8, .1, 1], m: .1, r: .5 },
    navR: { c: [1, .1, .08, 1], e: [1, .08, .05] }, navG: { c: [.1, 1, .3, 1], e: [.05, 1, .25] }, navW: { c: [1, 1, 1, 1], e: [1, 1, 1] },
    strobe: { c: [1, 1, 1, 1], e: [.9, .9, .95] }, beacon: { c: [1, .15, .1, 1], e: [1, .1, .05] },
  };
  const toG = v => [v[1], v[2], v[0]]; // authoring (X fwd, Y left, Z up) -> glTF (+X left, +Y up, +Z fwd)

  // Returns { json, bin } for a glTF with one binary buffer.
  function toGltf(B, livery) {
    const chunks = [], bufferViews = [], accessors = [], materials = [], matIndex = {}, meshes = [], nodes = [{ name: "aircraft", children: [], translation: toG([0, 0, B.lift || 0]) }];
    const animations = [];
    let offset = 0;
    const push = (arr, target) => {
      const pad = (4 - (offset % 4)) % 4; if (pad) { chunks.push(new Uint8Array(pad)); offset += pad; }
      chunks.push(new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength));
      bufferViews.push(Object.assign({ buffer: 0, byteOffset: offset, byteLength: arr.byteLength }, target ? { target } : {}));
      offset += arr.byteLength; return bufferViews.length - 1;
    };
    const mat = name => {
      if (name in matIndex) return matIndex[name];
      const M = MATS[name], col = M.c || livery;
      materials.push({ name, pbrMetallicRoughness: { baseColorFactor: col, metallicFactor: M.m ?? .1, roughnessFactor: M.r ?? .55 }, ...(M.e ? { emissiveFactor: M.e } : {}),
        doubleSided: name === "disc" || name === "glass" || name === "seam" || name === "blade", ...(M.blend ? { alphaMode: "BLEND" } : {}) });
      return (matIndex[name] = materials.length - 1);
    };
    for (const part of B.parts) {
      const names = Object.keys(part.g).filter(n => part.g[n].p.length);
      if (!names.length) continue;
      const prims = [];
      for (const name of names) {
        const g = part.g[name], n = g.p.length / 3, P = new Float32Array(n * 3), N = new Float32Array(n * 3);
        const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
        for (let i = 0; i < n; i++) {
          const v = toG(sub([g.p[i * 3], g.p[i * 3 + 1], g.p[i * 3 + 2]], part.pivot));
          P.set(v, i * 3); N.set(toG([g.n[i * 3], g.n[i * 3 + 1], g.n[i * 3 + 2]]), i * 3);
          for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], v[k]); mx[k] = Math.max(mx[k], v[k]); }
        }
        const pv = push(P, 34962), nv = push(N, 34962);
        accessors.push({ bufferView: pv, componentType: 5126, count: n, type: "VEC3", min: mn, max: mx });
        accessors.push({ bufferView: nv, componentType: 5126, count: n, type: "VEC3" });
        prims.push({ attributes: { POSITION: accessors.length - 2, NORMAL: accessors.length - 1 }, material: mat(name), mode: 4 });
      }
      meshes.push({ name: part.name, primitives: prims });
      nodes.push({ name: part.name, mesh: meshes.length - 1, ...(part.pivot.some(v => v) ? { translation: toG(part.pivot) } : {}) });
      const ni = nodes.length - 1; nodes[0].children.push(ni);
      if (part.spin) {
        const ax = norm(toG(part.spin.axis)), period = 1 / Math.abs(part.spin.rate), sg = Math.sign(part.spin.rate), K = 8;
        const times = new Float32Array(K + 1), rots = new Float32Array((K + 1) * 4);
        for (let k = 0; k <= K; k++) {
          const a = sg * 2 * Math.PI * k / K, s = Math.sin(a / 2);
          times[k] = period * k / K; rots.set([ax[0] * s, ax[1] * s, ax[2] * s, Math.cos(a / 2)], k * 4);
        }
        const tv = push(times), rv = push(rots);
        accessors.push({ bufferView: tv, componentType: 5126, count: K + 1, type: "SCALAR", min: [0], max: [period] });
        accessors.push({ bufferView: rv, componentType: 5126, count: K + 1, type: "VEC4" });
        animations.push({ name: part.name, samplers: [{ input: accessors.length - 2, output: accessors.length - 1, interpolation: "LINEAR" }], channels: [{ sampler: 0, target: { node: ni, path: "rotation" } }] });
      }
    }
    const bin = new Uint8Array(offset); let o = 0;
    for (const c of chunks) { bin.set(c, o); o += c.byteLength; }
    if (B.gearLift) nodes[0].extras = { gearLift: B.gearLift };
    const json = {
      asset: { version: "2.0", generator: "Overhead3D" }, scene: 0, scenes: [{ nodes: [0] }], nodes, meshes, materials, accessors, bufferViews,
      buffers: [{ byteLength: offset }], ...(animations.length ? { animations } : {}),
    };
    return { json, bin };
  }

  // opts: code, gear (draw retractable gear), hq (high detail), gearPart (put retractable gear in its own "gear" node).
  function build(fam, L, b, opts = {}) {
    const B = new Builder(!!opts.hq);
    if (FAM[fam].fus === "heli") buildHeli(B, L, b, opts.code); else buildPlane(B, fam, L, b, opts.code, !!opts.gear, !!opts.gearPart);
    return B;
  }
  const liveryLinear = hex => [...hex.match(/\w\w/g).map(h => Math.pow(parseInt(h, 16) / 255, 2.2)), 1]; // sRGB -> linear

  // Binary .glb for a model (Node or browser).
  function glb(fam, L, b, liveryHex = "7f8a9c", opts = {}) {
    const B = build(fam, L, b, opts);
    const { json, bin } = toGltf(B, liveryLinear(liveryHex));
    if (opts.info) Object.assign(opts.info, { gearLift: B.gearLift || 0, lift: B.lift || 0 });
    const enc = s => new TextEncoder().encode(s);
    let js = enc(JSON.stringify(json)); const jpad = (4 - js.length % 4) % 4;
    if (jpad) { const t = new Uint8Array(js.length + jpad); t.set(js); t.fill(0x20, js.length); js = t; }
    const bpad = (4 - bin.length % 4) % 4, binLen = bin.length + bpad, total = 12 + 8 + js.length + 8 + binLen;
    const out = new Uint8Array(total), dv = new DataView(out.buffer);
    dv.setUint32(0, 0x46546C67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
    dv.setUint32(12, js.length, true); dv.setUint32(16, 0x4E4F534A, true); out.set(js, 20);
    const bo = 20 + js.length; dv.setUint32(bo, binLen, true); dv.setUint32(bo + 4, 0x004E4942, true); out.set(bin, bo + 8);
    return out;
  }
  function triangles(fam, L, b, opts = {}) {
    const B = build(fam, L, b, opts);
    return B.parts.reduce((s, p) => s + Object.values(p.g).reduce((t, g) => t + g.p.length / 9, 0), 0);
  }

  const urlCache = new Map();
  // Object URL for a model, cached by shape + livery + landing gear.
  function modelUrl(fam, L, b, liveryHex, opts = {}) {
    const code = opts.code || "", gear = !!opts.gear;
    const key = `${fam}|${L}|${b}|${liveryHex}|${code}|${gear}`;
    if (!urlCache.has(key)) urlCache.set(key, URL.createObjectURL(new Blob([glb(fam, L, b, liveryHex, { code, gear })], { type: "model/gltf-binary" })));
    return urlCache.get(key);
  }
  // Copy of a .glb with the "livery" material set to a new sRGB hex color (for baked model files).
  function recolorGlb(buf, liveryHex) {
    const u8 = new Uint8Array(buf), dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const jlen = dv.getUint32(12, true), json = JSON.parse(new TextDecoder().decode(u8.subarray(20, 20 + jlen)));
    for (const m of json.materials || []) if (m.name === "livery") m.pbrMetallicRoughness.baseColorFactor = liveryLinear(liveryHex);
    let js = new TextEncoder().encode(JSON.stringify(json)); const pad = (4 - js.length % 4) % 4;
    if (pad) { const t = new Uint8Array(js.length + pad); t.set(js); t.fill(0x20, js.length); js = t; }
    const rest = u8.subarray(20 + jlen), total = 20 + js.length + rest.length, out = new Uint8Array(total), ov = new DataView(out.buffer);
    out.set(u8.subarray(0, 12)); ov.setUint32(8, total, true); ov.setUint32(12, js.length, true); ov.setUint32(16, 0x4E4F534A, true);
    out.set(js, 20); out.set(rest, 20 + js.length);
    return out;
  }
  // Fixed gear and skids are always drawn; retractable gear only when asked.
  const hasFixedGear = (fam, code) => fam === "heli" || FIXED.has(code);

  return { T, FAM, FEAT, HELI, SPEC, CLASS_NAME, modelUrl, glb, recolorGlb, triangles, hasFixedGear };
});
