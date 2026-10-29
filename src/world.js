// Manhattan, street by street, from Mark's Vigil prototype: OpenStreetMap
// streets, buildings, parks and water, real businesses, and the MTA subway.
// The data is inlined by build/build.mjs (data/world.b64, data/biz.json,
// data/subway.json). This file decodes it and answers the game's questions:
// where can you walk, what street is this, how do I get there, what is near.
//
// Coordinates: meters, x east, z NORTH (the data stores z south; it is
// flipped once here), origin at Times Square. Manhattan's grid runs about 29
// degrees off true north, so nothing here assumes axis-aligned streets.
//
// Plain script (no modules) so the build can inline it and tests can run it
// in a vm: defines globalThis.MMWorld.
(function (g) {
  'use strict';
  const W = (g.MMWorld = {});

  // road classes: 0 motorway, 1 trunk, 2 primary, 3 secondary, 4 tertiary,
  // 5 residential, 6 motorway link, 7 other link, 8 light rail, 9 rail,
  // 10 runway, 11 taxiway. Widths (two-way, one-way) in meters.
  const CLS_W = [[22, 11.5], [16, 11], [18, 16], [15, 12], [12, 9], [10, 8.5], [9, 5.5], [9, 5.5], [2.6, 2.6], [2.6, 2.6], [45, 45], [23, 23]];
  W.SIDEWALK = 5; // m of sidewalk beyond the curb on each side
  W.CUT_DEPTH = 1; // m: a street line this far inside a building's outline cuts the building back (see chunk)
  W.MIN_BLOCK_AREA = 25; // m2: smaller footprints do not block walking
  // ground classes (data): 0 land, 1 park, 2 woods, 3 sand, 4 paved, 5 water inside land, 6 plaza, 7 other, 8 other boroughs
  W.GROUND_COL = [[158, 155, 149], [95, 127, 71], [86, 105, 63], [217, 203, 160], [142, 139, 133], null, [169, 162, 145], [111, 95, 79], [85, 82, 77]];
  W.WATER_COL = [44, 74, 98];

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  // ---------- decode ----------
  // raw: the gunzipped world bytes (Uint8Array); biz, subway: parsed JSON
  W.load = function (raw, biz, subway) {
    const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    const hl = dv.getUint32(0, true);
    let off = 4;
    const H = (W.H = JSON.parse(new TextDecoder().decode(raw.subarray(off, off + hl))));
    off += hl;
    const sec = (T) => {
      const n = dv.getUint32(off, true);
      off += 4;
      const b = raw.buffer.slice(raw.byteOffset + off, raw.byteOffset + off + n);
      off += n;
      return new T(b);
    };
    const ECLS = sec(Uint8Array), EFLAG = sec(Uint8Array), ENAME = sec(Uint16Array), EREF = sec(Uint16Array), ENPT = sec(Uint16Array);
    const FX = sec(Int32Array), FZ = sec(Int32Array), DX = sec(Int16Array), DZ = sec(Int16Array);
    const bcnt = sec(Uint16Array), BX = sec(Int16Array), BZ = sec(Int16Array), BW = sec(Uint16Array), BD = sec(Uint16Array), BA = sec(Uint8Array), BH = sec(Uint16Array);
    const pcnt = sec(Uint16Array), PN = sec(Uint8Array), PH = sec(Uint16Array), PPX = sec(Int16Array), PPZ = sec(Int16Array);
    const tcnt = sec(Uint16Array), GCLS = sec(Uint8Array), GNR = sec(Uint16Array), GRN = sec(Uint16Array), GX = sec(Uint16Array), GZ = sec(Uint16Array);
    Object.assign(W, { ECLS, EFLAG, ENAME, EREF, names: H.names });
    W.raw = { bcnt, BX, BZ, BW, BD, BA, BH, pcnt, PN, PH, PPX, PPZ, tcnt, GCLS, GNR, GRN, GX, GZ };
    // world bounds in game coordinates (z flipped)
    W.X0 = H.X0; W.X1 = H.X1; W.Z0 = -H.Z1; W.Z1 = -H.Z0;

    // edges -> points
    const NE = (W.NE = H.nEdges), Q = H.Q;
    const EP0 = (W.EP0 = new Uint32Array(NE + 1));
    let np = 0;
    for (let e = 0; e < NE; e++) { EP0[e] = np; np += ENPT[e]; }
    EP0[NE] = np;
    const PX = (W.PX = new Float32Array(np)), PZ = (W.PZ = new Float32Array(np)), CUM = (W.CUM = new Float32Array(np)), ELEN = (W.ELEN = new Float32Array(NE));
    let d = 0;
    for (let e = 0; e < NE; e++) {
      let x = FX[e], z = FZ[e];
      const a = EP0[e];
      PX[a] = x / Q; PZ[a] = -z / Q; CUM[a] = 0;
      for (let k = a + 1; k < EP0[e + 1]; k++) {
        x += DX[d]; z += DZ[d]; d++;
        PX[k] = x / Q; PZ[k] = -z / Q;
        CUM[k] = CUM[k - 1] + Math.hypot(PX[k] - PX[k - 1], PZ[k] - PZ[k - 1]);
      }
      ELEN[e] = CUM[EP0[e + 1] - 1];
    }
    // nodes from road endpoints (rails and runways are not in the graph)
    const nodeMap = new Map(), nx = [], nz = [];
    const EN0 = (W.EN0 = new Int32Array(NE)), EN1 = (W.EN1 = new Int32Array(NE));
    const nodeOf = (k) => {
      const key = Math.round(PX[k] * 2) * 1e6 + Math.round(PZ[k] * 2);
      let id = nodeMap.get(key);
      if (id === undefined) { id = nx.length; nodeMap.set(key, id); nx.push(PX[k]); nz.push(PZ[k]); }
      return id;
    };
    for (let e = 0; e < NE; e++) {
      if (ECLS[e] >= 8) { EN0[e] = EN1[e] = -1; continue; }
      EN0[e] = nodeOf(EP0[e]); EN1[e] = nodeOf(EP0[e + 1] - 1);
    }
    const NN = (W.NN = nx.length);
    W.NODEX = Float32Array.from(nx); W.NODEZ = Float32Array.from(nz);
    const NODE_OFF = (W.NODE_OFF = new Uint32Array(NN + 1));
    for (let e = 0; e < NE; e++) { if (EN0[e] < 0) continue; NODE_OFF[EN0[e] + 1]++; NODE_OFF[EN1[e] + 1]++; }
    for (let i = 0; i < NN; i++) NODE_OFF[i + 1] += NODE_OFF[i];
    const NODE_EDGES = (W.NODE_EDGES = new Int32Array(NODE_OFF[NN]));
    const fill = NODE_OFF.slice(0, NN);
    for (let e = 0; e < NE; e++) { if (EN0[e] < 0) continue; NODE_EDGES[fill[EN0[e]]++] = e * 2; NODE_EDGES[fill[EN1[e]]++] = e * 2 + 1; }

    // chunk offsets: buildings by 500 m chunk, ground by 1 km tile
    const cum = (cnt) => { const o = new Uint32Array(cnt.length + 1); for (let i = 0; i < cnt.length; i++) o[i + 1] = o[i] + cnt[i]; return o; };
    W.raw.BOX_OFF = cum(bcnt); W.raw.POLY_OFF = cum(pcnt); W.raw.POLY_PTOFF = cum(PN);
    W.raw.GT_OFF = cum(tcnt); W.raw.GRING_OFF = cum(GNR); W.raw.GXY_OFF = cum(GRN);
    buildBins();
    W.chunks = new Map();
    W.tiles = new Map();

    W.places = H.places.map(([name, x, z, big]) => ({ name, x, z: -z, big: !!big }));
    loadBiz(biz);
    loadSubway(subway);
    return W;
  };

  // ---------- edges ----------
  W.oneway = (e) => (W.EFLAG[e] & 1) === 1;
  W.isBridge = (e) => (W.EFLAG[e] & 2) === 2;
  W.roadW = (e) => CLS_W[W.ECLS[e]][W.oneway(e) ? 1 : 0];
  // streets people walk along: primary to residential and links (not highways or rail)
  W.walkEdge = (e) => { const c = W.ECLS[e]; return c >= 2 && c <= 7 && c !== 6; };
  W.edgeName = (e) => (e >= 0 && W.names[W.ENAME[e]]) || '';
  // direction of an edge at point index k (unit vector along increasing k)
  W.edgeDir = (e, k) => {
    const a = clamp(k, W.EP0[e], W.EP0[e + 1] - 2);
    const dx = W.PX[a + 1] - W.PX[a], dz = W.PZ[a + 1] - W.PZ[a], l = Math.hypot(dx, dz) || 1;
    return { x: dx / l, z: dz / l };
  };

  // 200 m bins of edges
  const BIN = 200;
  let NBX, NBZ, BIN_OFF, BIN_E, qStamp, qGen = 0;
  function buildBins() {
    NBX = Math.ceil((W.X1 - W.X0) / BIN); NBZ = Math.ceil((W.Z1 - W.Z0) / BIN);
    const nb = NBX * NBZ, cnt = new Uint32Array(nb + 1), stamp = new Int32Array(nb).fill(-1);
    const visit = (e, fn) => {
      const pad = W.roadW(e) / 2 + W.SIDEWALK + 2;
      for (let k = W.EP0[e]; k < W.EP0[e + 1] - 1; k++) {
        const x0 = Math.min(W.PX[k], W.PX[k + 1]) - pad, x1 = Math.max(W.PX[k], W.PX[k + 1]) + pad;
        const z0 = Math.min(W.PZ[k], W.PZ[k + 1]) - pad, z1 = Math.max(W.PZ[k], W.PZ[k + 1]) + pad;
        const i0 = clamp(Math.floor((x0 - W.X0) / BIN), 0, NBX - 1), i1 = clamp(Math.floor((x1 - W.X0) / BIN), 0, NBX - 1);
        const j0 = clamp(Math.floor((z0 - W.Z0) / BIN), 0, NBZ - 1), j1 = clamp(Math.floor((z1 - W.Z0) / BIN), 0, NBZ - 1);
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const b = j * NBX + i; if (stamp[b] !== e) { stamp[b] = e; fn(b); } }
      }
    };
    for (let e = 0; e < W.NE; e++) visit(e, (b) => cnt[b + 1]++);
    for (let i = 0; i < nb; i++) cnt[i + 1] += cnt[i];
    BIN_OFF = cnt; BIN_E = new Int32Array(cnt[nb]);
    const fill = cnt.slice(0, nb);
    stamp.fill(-1);
    for (let e = 0; e < W.NE; e++) visit(e, (b) => { BIN_E[fill[b]++] = e; });
    qStamp = new Uint32Array(W.NE);
  }
  W.edgesNear = function (x, z, r, fn) {
    qGen++;
    const i0 = clamp(Math.floor((x - r - W.X0) / BIN), 0, NBX - 1), i1 = clamp(Math.floor((x + r - W.X0) / BIN), 0, NBX - 1);
    const j0 = clamp(Math.floor((z - r - W.Z0) / BIN), 0, NBZ - 1), j1 = clamp(Math.floor((z + r - W.Z0) / BIN), 0, NBZ - 1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const b = j * NBX + i;
      for (let q = BIN_OFF[b]; q < BIN_OFF[b + 1]; q++) { const e = BIN_E[q]; if (qStamp[e] !== qGen) { qStamp[e] = qGen; fn(e); } }
    }
  };
  // nearest point on an edge within r; filter(e) picks which edges count.
  // Returns a fresh {e, d, x, z, k, s} or null.
  W.nearestEdge = function (x, z, r, filter) {
    let best = null, bd = r;
    W.edgesNear(x, z, r, (e) => {
      if (filter && !filter(e)) return;
      for (let k = W.EP0[e]; k < W.EP0[e + 1] - 1; k++) {
        const ax = W.PX[k], az = W.PZ[k], bx = W.PX[k + 1] - ax, bz = W.PZ[k + 1] - az, l2 = bx * bx + bz * bz || 1;
        const t = clamp(((x - ax) * bx + (z - az) * bz) / l2, 0, 1), px = ax + bx * t, pz = az + bz * t, dd = Math.hypot(x - px, z - pz);
        if (dd < bd) { bd = dd; best = { e, d: dd, x: px, z: pz, k, s: W.CUM[k] + Math.sqrt(l2) * t }; }
      }
    });
    return best;
  };
  W.inWorld = (x, z) => x > W.X0 + 5 && x < W.X1 - 5 && z > W.Z0 + 5 && z < W.Z1 - 5;

  // ---------- buildings: footprints by 500 m chunk, decoded on first use ----------
  // chunk indices are in the data's own (z south) grid
  W.chunkOf = (x, z) => [Math.floor((x - W.H.X0) / W.H.CH), Math.floor((-z - W.H.Z0) / W.H.CH)];
  const CELL = 16;
  function hash(a, b) { let h = Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
  W.chunk = function (cx, cz) {
    const H = W.H;
    if (cx < 0 || cz < 0 || cx >= H.NCX || cz >= H.NCZ) return null;
    const key = cz * 1000 + cx;
    let ch = W.chunks.get(key);
    if (ch) return ch;
    const R = W.raw, ci = cz * H.NCX + cx, ox = H.X0 + cx * H.CH, oz = H.Z0 + cz * H.CH;
    const blds = [];
    const add = (pts0, h, seed) => {
      let pts = pts0, n = pts.length / 2;
      // walls face outward: counterclockwise in x east, z north
      let a2 = 0;
      for (let k = 0; k < n; k++) { const k2 = (k + 1) % n; a2 += pts[k * 2] * pts[k2 * 2 + 1] - pts[k2 * 2] * pts[k * 2 + 1]; }
      if (a2 < 0) for (let k = 0; k < n / 2; k++) { const j = n - 1 - k; for (const o of [0, 1]) { const t = pts[k * 2 + o]; pts[k * 2 + o] = pts[j * 2 + o]; pts[j * 2 + o] = t; } }
      // 10/30 (Mark: floating buildings at 8th Avenue, 50th Street, Columbus Circle): a street that runs into an
      // outline (ramps, terminals, or a street line that overlaps the outline in the data) cuts the building back
      // to its side of the street, at the edge of the sidewalk; nothing floats over a street any more. Up to
      // six cuts (a corner building can meet two streets, a long one several); a sliver left over is dropped
      const area0 = Math.abs(a2) / 2;
      for (let pass = 0; pass < 6; pass++) {
        const cut = deepestStreet(pts, n, W.CUT_DEPTH);
        if (!cut || cut.deep < W.CUT_DEPTH) break;
        pts = clipHalf(pts, n, cut);
        n = pts.length / 2;
        if (n < 3) return;
      }
      if (n !== pts0.length / 2 || pts !== pts0) {
        let a3 = 0;
        for (let k = 0; k < n; k++) { const k2 = (k + 1) % n; a3 += pts[k * 2] * pts[k2 * 2 + 1] - pts[k2 * 2] * pts[k * 2 + 1]; }
        if (Math.abs(a3) / 2 < Math.max(30, 0.25 * area0)) return;
      }
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, mx = 0, mz = 0;
      for (let k = 0; k < n; k++) { const x = pts[k * 2], z = pts[k * 2 + 1]; x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); mx += x; mz += z; }
      mx /= n; mz /= n;
      // canopies and skybridges mapped over a street: leave the street clear
      const road = W.nearestEdge(mx, mz, 16, (e) => W.ECLS[e] <= 7 && !(W.EFLAG[e] & 6));
      if (road && road.d < W.roadW(road.e) / 2 - 0.5) return;
      let area = 0;
      for (let k = 0; k < n; k++) { const k2 = (k + 1) % n; area += pts[k * 2] * pts[k2 * 2 + 1] - pts[k2 * 2] * pts[k * 2 + 1]; }
      area = Math.abs(area) / 2;
      blds.push({ pts, n, h, x0, x1, z0, z1, x: mx, z: mz, r: Math.hypot(x1 - x0, z1 - z0) / 2, seed, over: false, base: 0, area });
    };
    for (let i = R.BOX_OFF[ci]; i < R.BOX_OFF[ci + 1]; i++) {
      const x = ox + R.BX[i] / 4, z = oz + R.BZ[i] / 4, w = R.BW[i] / 10, d = R.BD[i] / 10, a = (R.BA[i] / 255) * Math.PI, h = R.BH[i] / 10;
      const ca = Math.cos(a), sa = Math.sin(a), hw = w / 2, hd = d / 2;
      const c = [x - ca * hw + sa * hd, z - sa * hw - ca * hd, x + ca * hw + sa * hd, z + sa * hw - ca * hd, x + ca * hw - sa * hd, z + sa * hw + ca * hd, x - ca * hw - sa * hd, z - sa * hw + ca * hd];
      const pts = new Float32Array(8);
      for (let k = 0; k < 4; k++) { pts[k * 2] = c[k * 2]; pts[k * 2 + 1] = -c[k * 2 + 1]; }
      add(pts, h, hash(R.BX[i], R.BZ[i]));
    }
    for (let i = R.POLY_OFF[ci]; i < R.POLY_OFF[ci + 1]; i++) {
      const n = R.PN[i], p0 = R.POLY_PTOFF[i];
      const pts = new Float32Array(n * 2);
      for (let k = 0; k < n; k++) { pts[k * 2] = ox + R.PPX[p0 + k] / 4; pts[k * 2 + 1] = -(oz + R.PPZ[p0 + k] / 4); }
      add(pts, R.PH[i] / 10, hash(R.PPX[p0], R.PPZ[p0]));
    }
    // 16 m cells over the chunk (in game coordinates) for point queries
    const gx0 = ox, gz0 = -(oz + H.CH), ncell = Math.ceil(H.CH / CELL);
    const cells = new Array(ncell * ncell);
    blds.forEach((b, bi) => {
      const i0 = clamp(Math.floor((b.x0 - gx0) / CELL), 0, ncell - 1), i1 = clamp(Math.floor((b.x1 - gx0) / CELL), 0, ncell - 1);
      const j0 = clamp(Math.floor((b.z0 - gz0) / CELL), 0, ncell - 1), j1 = clamp(Math.floor((b.z1 - gz0) / CELL), 0, ncell - 1);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) (cells[j * ncell + i] || (cells[j * ncell + i] = [])).push(bi);
    });
    ch = { cx, cz, blds, cells, gx0, gz0, ncell };
    W.chunks.set(key, ch);
    return ch;
  };
  function pip(x, z, pts) {
    let c = false;
    const n = pts.length / 2;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = pts[i * 2], zi = pts[i * 2 + 1], xj = pts[j * 2], zj = pts[j * 2 + 1];
      if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
    }
    return c;
  }
  W.pip = pip;
  // the building footprint containing (x, z), grown by pad meters, or null
  W.buildingAt = function (x, z, pad = 0) {
    const [cx, cz] = W.chunkOf(x, z);
    const ch = W.chunk(cx, cz);
    if (!ch) return null;
    const i = Math.floor((x - ch.gx0) / CELL), j = Math.floor((z - ch.gz0) / CELL);
    if (i < 0 || j < 0 || i >= ch.ncell || j >= ch.ncell) return null;
    const list = ch.cells[j * ch.ncell + i];
    if (!list) return null;
    for (const bi of list) {
      const b = ch.blds[bi];
      if (b.area < W.MIN_BLOCK_AREA) continue; // kiosks, newsstands, subway stairs: step around them
      if (x < b.x0 - pad || x > b.x1 + pad || z < b.z0 - pad || z > b.z1 + pad) continue;
      if (pip(x, z, b.pts)) return b;
    }
    return null;
  };

  // ---------- ground: land, parks, water by 1 km tile ----------
  W.tile = function (ti, tj) {
    const H = W.H;
    if (ti < 0 || tj < 0 || ti >= H.NAX || tj >= H.NAZ) return null;
    const key = tj * 1000 + ti;
    let t = W.tiles.get(key);
    if (t) return t;
    const R = W.raw, idx = tj * H.NAX + ti, tx = H.X0 + ti * H.AT, tz = H.Z0 + tj * H.AT;
    const polys = [];
    for (let p = R.GT_OFF[idx]; p < R.GT_OFF[idx + 1]; p++) {
      const rings = [];
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (let r = R.GRING_OFF[p]; r < R.GRING_OFF[p + 1]; r++) {
        const n = R.GXY_OFF[r + 1] - R.GXY_OFF[r], pts = new Float32Array(n * 2);
        for (let k = 0; k < n; k++) {
          const q = R.GXY_OFF[r] + k, x = tx + R.GX[q] / 2, z = -(tz + R.GZ[q] / 2);
          pts[k * 2] = x; pts[k * 2 + 1] = z;
          x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
        }
        rings.push(pts);
      }
      polys.push({ cls: R.GCLS[p], rings, x0, x1, z0, z1 });
    }
    t = { ti, tj, polys };
    W.tiles.set(key, t);
    return t;
  };
  W.tileOf = (x, z) => [Math.floor((x - W.H.X0) / W.H.AT), Math.floor((-z - W.H.Z0) / W.H.AT)];
  // ground class at a point: the last polygon (in drawing order) that contains it; -1 is water
  const ORDER = [0, 6, 4, 2, 1, 3, 5, 7];
  W.groundAt = function (x, z) {
    const [ti, tj] = W.tileOf(x, z);
    const t = W.tile(ti, tj);
    if (!t) return -1;
    let cls = -1;
    for (const c of ORDER) {
      for (const p of t.polys) {
        if (p.cls !== c || x < p.x0 || x > p.x1 || z < p.z0 || z > p.z1) continue;
        let inside = false;
        for (const ring of p.rings) if (pip(x, z, ring)) inside = !inside; // even-odd over the rings
        if (inside) cls = c === 5 ? -1 : c;
      }
    }
    return cls;
  };

  // a walkable street segment running at least need meters into an outline: { deep, ax, az, bx, bz, e }
  // (the first found: a cut needs one, and a big outline crossed by a long street has many)
  function deepestStreet(pts, n, need) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let k = 0; k < n; k++) { x0 = Math.min(x0, pts[k * 2]); x1 = Math.max(x1, pts[k * 2]); z0 = Math.min(z0, pts[k * 2 + 1]); z1 = Math.max(z1, pts[k * 2 + 1]); }
    let best = null;
    W.edgesNear((x0 + x1) / 2, (z0 + z1) / 2, Math.hypot(x1 - x0, z1 - z0) / 2 + 12, (e) => {
      if ((best && best.deep >= need) || !W.walkEdge(e)) return;
      for (let k = W.EP0[e]; k < W.EP0[e + 1] - 1; k++) {
        const ax = W.PX[k], az = W.PZ[k], bx = W.PX[k + 1], bz = W.PZ[k + 1], L = Math.hypot(bx - ax, bz - az);
        if (L < 0.5 || Math.max(ax, bx) < x0 || Math.min(ax, bx) > x1 || Math.max(az, bz) < z0 || Math.min(az, bz) > z1) continue;
        for (let t = 0; t <= L; t += 2) {
          const px = ax + ((bx - ax) * t) / L, pz = az + ((bz - az) * t) / L;
          if (px < x0 || px > x1 || pz < z0 || pz > z1 || !pip(px, pz, pts)) continue;
          const d = edgeDist(px, pz, pts, n);
          if (!best || d > best.deep) best = { deep: d, ax, az, bx, bz, e };
          if (d >= need) return;
        }
      }
    });
    return best;
  }
  // an outline cut along a street segment's line: the side its middle lies on, from the edge of that street's
  // sidewalk outward (Sutherland and Hodgman against one half plane)
  function clipHalf(pts, n, c) {
    const dx = c.bx - c.ax, dz = c.bz - c.az, L = Math.hypot(dx, dz), nx = -dz / L, nz = dx / L, w = W.roadW(c.e) / 2 + W.SIDEWALK;
    let mx = 0, mz = 0;
    for (let k = 0; k < n; k++) { mx += pts[k * 2]; mz += pts[k * 2 + 1]; }
    const side = (mx / n - c.ax) * nx + (mz / n - c.az) * nz >= 0 ? 1 : -1;
    const f = (x, z) => side * ((x - c.ax) * nx + (z - c.az) * nz) - w;
    const out = [];
    for (let k = 0; k < n; k++) {
      const k2 = (k + 1) % n, x = pts[k * 2], z = pts[k * 2 + 1], x2 = pts[k2 * 2], z2 = pts[k2 * 2 + 1], fa = f(x, z), fb = f(x2, z2);
      if (fa >= 0) out.push(x, z);
      if ((fa >= 0) !== (fb >= 0)) { const t = fa / (fa - fb); out.push(x + (x2 - x) * t, z + (z2 - z) * t); }
    }
    return new Float32Array(out);
  }
  // the distance from (px, pz) to the nearest side of an outline
  function edgeDist(px, pz, pts, n) {
    let m = Infinity;
    for (let k = 0; k < n; k++) {
      const k2 = (k + 1) % n, ax = pts[k * 2], az = pts[k * 2 + 1], dx = pts[k2 * 2] - ax, dz = pts[k2 * 2 + 1] - az, L = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / L));
      m = Math.min(m, Math.hypot(px - ax - dx * t, pz - az - dz * t));
    }
    return m;
  }
  // on a walkable street's corridor (the road and its sidewalks)
  W.corridor = function (x, z) {
    const n = W.nearestEdge(x, z, 30, W.walkEdge);
    return !!n && n.d <= W.roadW(n.e) / 2 + W.SIDEWALK;
  };
  // ---------- where you can walk ----------
  // On a street's sidewalk corridor (half the road plus SIDEWALK) of a walkable
  // street, or in a park or plaza; never inside a building, never in water.
  W.walkable = function (x, z) {
    if (!W.inWorld(x, z)) return false;
    if (W.buildingAt(x, z)) return false;
    const n = W.nearestEdge(x, z, 30, W.walkEdge);
    if (n && n.d <= W.roadW(n.e) / 2 + W.SIDEWALK) return true;
    const g = W.groundAt(x, z);
    return g === 1 || g === 2 || g === 6;
  };

  // ---------- names and intersections ----------
  // the street you are on: the nearest walkable named edge
  W.streetAt = function (x, z, r = 40) {
    return W.nearestEdge(x, z, r, (e) => W.walkEdge(e) && !!W.edgeName(e));
  };
  const norm = (s) => s.toLowerCase().replace(/\bavenue\b/g, 'ave').replace(/\bstreet\b/g, 'st').replace(/\s+/g, ' ').trim();
  // names of the streets meeting at node n
  W.nodeNames = function (n) {
    const out = [];
    for (let q = W.NODE_OFF[n]; q < W.NODE_OFF[n + 1]; q++) { const nm = W.edgeName(W.NODE_EDGES[q] >> 1); if (nm && !out.includes(nm)) out.push(nm); }
    return out;
  };
  // where streets named a and b meet: {x, z} (closest to near, if given) or
  // null. Shared graph nodes first; long segments that cross without a shared
  // node are found by segment intersection.
  W.intersection = function (a, b, near) {
    const na = norm(a), nb = norm(b);
    let best = null, bd = Infinity;
    const take = (x, z) => { const d = near ? Math.hypot(x - near.x, z - near.z) : 0; if (d < bd) { bd = d; best = { x, z }; } };
    for (let n = 0; n < W.NN; n++) {
      const names = W.nodeNames(n).map(norm);
      if (names.includes(na) && names.includes(nb)) take(W.NODEX[n], W.NODEZ[n]);
    }
    if (best) return best;
    const A = [], B = [];
    for (let e = 0; e < W.NE; e++) { const nm = norm(W.edgeName(e)); if (nm === na) A.push(e); else if (nm === nb) B.push(e); }
    for (const ea of A) for (let i = W.EP0[ea]; i < W.EP0[ea + 1] - 1; i++) {
      const ax = W.PX[i], az = W.PZ[i], bx = W.PX[i + 1], bz = W.PZ[i + 1];
      for (const eb of B) for (let j = W.EP0[eb]; j < W.EP0[eb + 1] - 1; j++) {
        const cx = W.PX[j], cz = W.PZ[j], dx = W.PX[j + 1], dz = W.PZ[j + 1];
        const den = (bx - ax) * (dz - cz) - (bz - az) * (dx - cx);
        if (Math.abs(den) < 1e-9) continue;
        const t = ((cx - ax) * (dz - cz) - (cz - az) * (dx - cx)) / den, u = ((cx - ax) * (bz - az) - (cz - az) * (bx - ax)) / den;
        if (t >= -0.02 && t <= 1.02 && u >= -0.02 && u <= 1.02) take(ax + (bx - ax) * t, az + (bz - az) * t);
      }
    }
    return best;
  };
  // a short name for a street: "West 42nd Street" -> "W 42nd St", "7th Avenue" -> "7th Ave"
  W.short = (s) => s.replace(/^West /, 'W ').replace(/^East /, 'E ').replace(/ Street$/, ' St').replace(/ Avenue$/, ' Ave').replace(/^Avenue /, 'Ave ');

  // ---------- routing ----------
  // shortest walk over walkable streets from the nearest graph node to (x0, z0)
  // to the one nearest (x1, z1). Returns {nodes, edges, len} or null.
  function nearestNode(x, z) {
    const n = W.nearestEdge(x, z, 300, W.walkEdge);
    if (!n) return -1;
    const a = W.EN0[n.e], b = W.EN1[n.e];
    return Math.hypot(W.NODEX[a] - x, W.NODEZ[a] - z) <= Math.hypot(W.NODEX[b] - x, W.NODEZ[b] - z) ? a : b;
  }
  W.nearestNode = nearestNode;
  W.route = function (x0, z0, x1, z1) {
    const s = nearestNode(x0, z0), t = nearestNode(x1, z1);
    if (s < 0 || t < 0) return null;
    const N = W.NN, dist = new Float32Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1), done = new Uint8Array(N);
    // binary heap of [dist, node]
    const heap = [];
    const push = (d, n) => { heap.push([d, n]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = i * 2 + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    dist[s] = 0; push(0, s);
    while (heap.length) {
      const [d, n] = pop();
      if (done[n]) continue;
      done[n] = 1;
      if (n === t) break;
      for (let q = W.NODE_OFF[n]; q < W.NODE_OFF[n + 1]; q++) {
        const ee = W.NODE_EDGES[q], e = ee >> 1;
        if (!W.walkEdge(e)) continue;
        const m = ee & 1 ? W.EN0[e] : W.EN1[e];
        const nd = d + W.ELEN[e];
        if (nd < dist[m]) { dist[m] = nd; prev[m] = ee; push(nd, m); }
      }
    }
    if (!isFinite(dist[t])) return null;
    const nodes = [t], edges = [];
    for (let n = t; n !== s; ) { const ee = prev[n], e = ee >> 1; edges.push(ee); n = ee & 1 ? W.EN1[e] : W.EN0[e]; nodes.push(n); }
    nodes.reverse(); edges.reverse();
    return { nodes, edges, len: dist[t] };
  };
  // the direction an edge leaves node n (unit vector), for the edge as stored in
  // NODE_EDGES (ee = e * 2 + end, end 0 means n is the edge's first point)
  W.leaving = function (ee) {
    const e = ee >> 1;
    if ((ee & 1) === 0) return W.edgeDir(e, W.EP0[e]);
    const d = W.edgeDir(e, W.EP0[e + 1] - 2);
    return { x: -d.x, z: -d.z };
  };

  // ---------- businesses ----------
  const BBIN = 250;
  let BIZ_BIN = null, BIZ_NB = 0;
  function loadBiz(biz) {
    W.biz = { cats: biz.cats, n: biz.n, p: biz.p.map(([c, x, z]) => [c, x, -z]) };
    BIZ_NB = Math.ceil((W.X1 - W.X0) / BBIN);
    BIZ_BIN = new Map();
    W.biz.p.forEach((b, i) => {
      const k = Math.floor((b[2] - W.Z0) / BBIN) * BIZ_NB + Math.floor((b[1] - W.X0) / BBIN);
      if (!BIZ_BIN.has(k)) BIZ_BIN.set(k, []);
      BIZ_BIN.get(k).push(i);
    });
  }
  W.bizNear = function (x, z, r, fn) {
    const i0 = Math.floor((x - r - W.X0) / BBIN), i1 = Math.floor((x + r - W.X0) / BBIN), j0 = Math.floor((z - r - W.Z0) / BBIN), j1 = Math.floor((z + r - W.Z0) / BBIN);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const l = BIZ_BIN.get(j * BIZ_NB + i);
      if (!l) continue;
      for (const b of l) { const p = W.biz.p[b]; if (Math.hypot(p[1] - x, p[2] - z) <= r) fn(b, p); }
    }
  };
  W.bizCat = (i) => W.biz.cats[W.biz.p[i][0]];

  // ---------- subway ----------
  function loadSubway(sub) {
    W.lines = sub.lines.map((l) => ({ id: l.id, col: l.col, name: l.name, st: l.st }));
    W.stations = sub.stations.map(([name, x, z], i) => ({ i, name, x, z: -z, lines: [] }));
    for (const l of W.lines) for (const s of l.st) if (W.stations[s] && !W.stations[s].lines.includes(l.id)) W.stations[s].lines.push(l.id);
  }
})(globalThis);
