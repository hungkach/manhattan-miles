// The city in WebGL (10/23, Mark: "aim for GTA3 / Vice City"): low-poly geometry, tiled textures,
// vertex light from the look's sun and sky, distance fog. Everything is made here in code (no
// downloaded models or textures): facades, roofs, asphalt, sidewalk slabs and ground detail are
// painted into a texture array at startup; buildings are the map's real footprints raised to their
// real heights, one mesh per 500 m chunk; streets are ribbons per chunk; the ground (land, parks,
// water) is each 1 km tile painted once into a texture. People and props arrive each frame as
// capsules in camera space (the game's own body models), cars and carts as tapered boxes.
//
// The game keeps its camera (toCam and F); this file turns the same camera into matrices, so the
// 2D layer on top (HUD, bubbles, signs, the player's arms) lines up exactly.
//
// Plain script (no modules) so the build can inline it: defines globalThis.MMGL.
(function (g) {
  'use strict';
  const MMGL = (g.MMGL = {});

  // texture array layers
  const LAYER = { brick: 0, brickSt: 1, stone: 2, stoneSt: 3, brown: 4, brownSt: 5, glass: 6, glassSt: 7, grid: 8, gridSt: 9, roof: 10, asphalt: 11, slab: 12, detail: 13, fire: 14 };
  const NLAYER = 15;
  // first floor height on a street (the storefront), meters
  const FIRST = 4.4;

  // ---------- shaders ----------
  const COMMON = `#version 300 es
precision highp float;
uniform vec3 uCam; uniform vec3 uAmb; uniform vec3 uSun; uniform vec3 uFog; uniform float uD;
float fogK(vec3 wp) { float d = length(wp.xz - uCam.xz); return pow(clamp(d / uD, 0.0, 1.0), 1.3); }
`;
  // the ground: a painted tile texture with a little world-tiled detail
  const GROUND_VS = COMMON + `
in vec2 aXZ; uniform mat4 uM; uniform vec4 uTile; out vec2 vUV; out vec3 vW;
void main() { vW = vec3(aXZ.x, 0.0, aXZ.y); vUV = vec2((aXZ.x - uTile.x) / uTile.z, (uTile.y - aXZ.y) / uTile.z); gl_Position = uM * vec4(aXZ.x, 0.0, aXZ.y, 1.0); }`;
  const GROUND_FS = COMMON + `
precision highp sampler2DArray;
in vec2 vUV; in vec3 vW; uniform sampler2D uTex; uniform sampler2DArray uArr; out vec4 o;
void main() {
  vec3 c = texture(uTex, vUV).rgb;
  float d = texture(uArr, vec3(vW.xz / 3.0, ${LAYER.detail}.0)).r, d2 = texture(uArr, vec3(vW.xz / 23.0, ${LAYER.detail}.0)).g;
  c *= (0.82 + 0.36 * d) * (0.9 + 0.2 * d2);
  c *= uAmb + uSun * 0.85;
  o = vec4(mix(c, uFog, fogK(vW)), 1.0);
}`;
  // streets: flat ribbons, colored per vertex; asphalt and sidewalk take their texture
  const STREET_VS = COMMON + `
in vec3 aPos; in vec3 aCol; in float aMat; uniform mat4 uM; out vec3 vW; out vec3 vCol; out float vMat;
void main() { vW = aPos; vCol = aCol; vMat = aMat; gl_Position = uM * vec4(aPos, 1.0); }`;
  const STREET_FS = COMMON + `
precision highp sampler2DArray;
in vec3 vW; in vec3 vCol; in float vMat; uniform sampler2DArray uArr; out vec4 o;
void main() {
  vec3 c = vCol;
  if (vMat > 0.5 && vMat < 1.5) c *= 0.55 + 0.9 * texture(uArr, vec3(vW.xz / 6.0, ${LAYER.asphalt}.0)).r;
  else if (vMat > 1.5) c *= 0.5 + 0.7 * texture(uArr, vec3(vW.xz / 1.6, ${LAYER.slab}.0)).r;
  c *= uAmb + uSun * 0.85;
  o = vec4(mix(c, uFog, fogK(vW)), 1.0);
}`;
  // see-through flat things on the ground: the route ribbon, shadows
  const FLAT_VS = COMMON + `
in vec3 aPos; in vec4 aCol; uniform mat4 uM; out vec4 vCol; out vec3 vW;
void main() { vW = aPos; vCol = aCol; gl_Position = uM * vec4(aPos, 1.0); }`;
  const FLAT_FS = COMMON + `
in vec4 vCol; in vec3 vW; uniform float uLit; out vec4 o;
void main() { vec3 c = vCol.rgb; if (uLit > 0.5) c = mix(c, uFog, fogK(vW)); o = vec4(c * vCol.a, vCol.a); }`;
  // buildings: walls with the facade of their style, roofs, plain parts (water tanks)
  const BLD_VS = COMMON + `
in vec3 aPos; in vec3 aNrm; in vec4 aWall; in vec4 aKind; in vec3 aTint;
uniform mat4 uM; out vec3 vW; out vec3 vN; out vec4 vWall; flat out vec4 vKind; flat out vec3 vTint;
void main() { vW = aPos; vN = aNrm; vWall = aWall; vKind = aKind; vTint = aTint; gl_Position = uM * vec4(aPos, 1.0); }`;
  const BLD_FS = COMMON + `
precision highp sampler2DArray;
in vec3 vW; in vec3 vN; in vec4 vWall; flat in vec4 vKind; flat in vec3 vTint;
uniform sampler2DArray uArr; uniform vec2 uSunH; uniform vec3 uGlass; uniform vec3 uGlassTower; uniform float uGolden; uniform float uNight; out vec4 o;
// a stable hash of whole numbers (a window's cell and its wall)
float h3(vec3 p) { uvec3 q = uvec3(ivec3(p) + 65536); uint h = q.x * 73856093u ^ q.y * 19349663u ^ q.z * 83492791u; h ^= h >> 13; h *= 0x5bd1e995u; h ^= h >> 15; return float(h & 0xffffu) / 65535.0; }
vec3 awning(float s) {
  float k = floor(fract(s * 7.13) * 7.0);
  return k < 1.0 ? vec3(0.59, 0.12, 0.13) : k < 2.0 ? vec3(0.13, 0.33, 0.24) : k < 3.0 ? vec3(0.12, 0.2, 0.38) : k < 4.0 ? vec3(0.47, 0.33, 0.16) : k < 5.0 ? vec3(0.27, 0.16, 0.31) : k < 6.0 ? vec3(0.08, 0.08, 0.1) : vec3(0.67, 0.47, 0.12);
}
void main() {
  // vWall: along the wall (m), height above its base (m), floor height, bay width
  // vKind: upper layer (or -1 plain, -2 roof), street layer (or -1), seed, wall height (m)
  float sunlit = max(0.0, dot(normalize(vN.xz + 1e-5), uSunH));
  vec3 c;
  if (vKind.x < -1.5) {
    float t = texture(uArr, vec3(vW.xz / 4.0, ${LAYER.roof}.0)).r;
    c = vTint * (0.55 + 0.8 * t) * (uAmb + uSun * 0.85);
  } else if (vKind.x < -0.5) {
    bool isFlat = abs(vN.y) > 0.5;
    c = vTint * (uAmb + uSun * (isFlat ? 0.85 : sunlit * 1.25));
  } else {
    float hb = vWall.y, top = vKind.w;
    bool street = vKind.y >= 0.0 && hb < ${FIRST.toFixed(1)};
    vec2 st = street ? vec2(vWall.x / vWall.w, hb / ${FIRST.toFixed(1)}) : vec2(vWall.x / vWall.w, (hb - (vKind.y >= 0.0 ? ${FIRST.toFixed(1)} : 0.0)) / vWall.z);
    float layer = street ? vKind.y : vKind.x;
    // fire escapes down every third bay of some brick walk-ups
    if (!street && layer == ${LAYER.brick}.0 && fract(vKind.z * 3.7) < 0.55 && mod(floor(st.x), 3.0) == 1.0 && hb < top - 2.0) layer = ${LAYER.fire}.0;
    vec4 t = texture(uArr, vec3(st, layer));
    bool tower = vKind.x > ${(LAYER.glass - 0.5).toFixed(1)};
    vec3 light = uAmb + uSun * sunlit * 1.25;
    // darker toward the sidewalk, as the street's own shade
    float ao = mix(0.68, 1.0, smoothstep(0.0, 9.0, hb));
    if (hb > top - 0.9 && !tower) {
      // the parapet and its cornice
      c = vTint * (hb > top - 0.55 ? 1.12 : 0.9) * light;
    } else if (t.a < 0.25) {
      // glass: the sky's color (golden on a sunlit wall at golden hour), lit rooms at night
      vec2 cell = floor(st);
      float lit = step(h3(vec3(cell, floor(vKind.z * 9973.0))), street ? 0.7 : 0.36);
      vec3 sky = tower ? uGlassTower : uGlass;
      if (uGolden > 0.5 && sunlit > 0.45) sky = mix(sky, vec3(0.93, 0.62, 0.42), 0.55 * smoothstep(0.45, 0.9, sunlit));
      c = sky * (0.75 + 0.5 * t.r);
      if (uNight > 0.5) c = lit > 0.5 ? vec3(1.0, 0.77, 0.44) * (0.75 + 0.35 * t.r) : vec3(0.05, 0.07, 0.13) * (0.8 + 0.5 * t.r);
      c *= street ? 0.85 : 1.0;
    } else if (t.a < 0.75) {
      c = awning(vKind.z) * (0.75 + 0.4 * t.r) * (uAmb + uSun * sunlit * 1.4);
    } else {
      c = t.rgb * vTint * 1.3 * light * ao;
    }
  }
  o = vec4(mix(c, uFog, fogK(vW)), 1.0);
}`;
  // people, props: capsules from a to b in camera space, radius r
  const CAP_VS = COMMON + `
in vec4 aLocal; in vec3 iA; in vec3 iB; in float iR; in vec3 iCol;
uniform mat4 uP; out vec3 vN; out vec3 vCol; out float vDist;
void main() {
  vec3 ax = iB - iA; float l = length(ax); vec3 w = l > 1e-4 ? ax / l : vec3(0.0, 1.0, 0.0);
  vec3 up = abs(w.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 u = normalize(cross(up, w)), v = cross(w, u);
  vec3 n = u * aLocal.x + v * aLocal.y + w * aLocal.z;
  vec3 p = mix(iA, iB, aLocal.w) + iR * n;
  vN = n; vCol = iCol; vDist = length(p.xz);
  gl_Position = uP * vec4(p, 1.0);
}`;
  const CAP_FS = COMMON + `
in vec3 vN; in vec3 vCol; in float vDist; uniform vec3 uSunCam; uniform vec3 uUpCam; out vec4 o;
void main() {
  vec3 n = normalize(vN);
  float k = 0.4 + 0.75 * max(0.0, dot(n, uSunCam)), sky = 0.82 + 0.28 * dot(n, uUpCam);
  vec3 c = vCol * (uAmb * sky + uSun * k);
  o = vec4(mix(c, uFog, pow(clamp(vDist / uD, 0.0, 1.0), 1.3)), 1.0);
}`;
  // boxes in the world (cars, carts, railings): center, heading, half sizes, a taper for the top
  const BOX_VS = COMMON + `
in vec3 aPos; in vec3 aNrm; in vec3 iC; in vec2 iH; in vec3 iS; in vec4 iCol;
uniform mat4 uM; out vec3 vN; out vec4 vCol; out vec3 vW;
void main() {
  float tp = aPos.y > 0.0 ? iCol.w : 1.0;
  vec3 H = vec3(iH.x, 0.0, iH.y), R = vec3(iH.y, 0.0, -iH.x);
  vec3 p = iC + H * aPos.x * iS.x * abs(tp) + R * aPos.z * iS.y * mix(1.0, abs(tp), 0.35) + vec3(0.0, aPos.y * iS.z, 0.0);
  vN = H * aNrm.x + R * aNrm.z + vec3(0.0, aNrm.y, 0.0); vCol = iCol; vW = p;
  gl_Position = uM * vec4(p, 1.0);
}`;
  const BOX_FS = COMMON + `
in vec3 vN; in vec4 vCol; in vec3 vW; uniform vec3 uSunW; out vec4 o;
void main() {
  vec3 n = normalize(vN);
  // a negative taper marks a light: it glows instead of taking the light
  vec3 c = vCol.w < 0.0 ? vCol.rgb : vCol.rgb * (uAmb * (0.85 + 0.2 * n.y) + uSun * (n.y > 0.5 ? 0.95 : 0.3 + 0.9 * max(0.0, dot(n, uSunW))));
  o = vec4(mix(c, uFog, fogK(vW)), 1.0);
}`;

  // ---------- small helpers ----------
  function compile(gl, vs, fs) {
    const mk = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader');
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || 'link');
    const u = {}, a = {};
    for (let i = 0, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); i < n; i++) { const info = gl.getActiveUniform(p, i); u[info.name] = gl.getUniformLocation(p, info.name); }
    for (let i = 0, n = gl.getProgramParameter(p, gl.ACTIVE_ATTRIBUTES); i < n; i++) { const info = gl.getActiveAttrib(p, i); a[info.name] = gl.getAttribLocation(p, info.name); }
    return { p, u, a };
  }
  function rng(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let r = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }
  // a growable float buffer
  function Floats(n) { return { a: new Float32Array(n), n: 0 }; }
  function grow(b, k) { if (b.n + k > b.a.length) { const a = new Float32Array(Math.max(b.a.length * 2, b.n + k)); a.set(b.a.subarray(0, b.n)); b.a = a; } }

  // ---------- the textures, painted in code ----------
  // Each layer is one tile: a bay and a floor of a facade, a storefront, or a patch of roof,
  // asphalt, sidewalk or ground. RGB is a gray to be tinted by the building's own color; alpha
  // marks glass (0), an awning (0.5) and wall (1). Row 0 is the bottom of the tile.
  function paintLayers(S) {
    const out = [];
    for (let li = 0; li < NLAYER; li++) out.push(new Uint8Array(S * S * 4));
    const r = rng(1234);
    // value noise at a few octaves
    const noise = (() => {
      const N = 64, grid = new Float32Array(N * N);
      for (let i = 0; i < grid.length; i++) grid[i] = r();
      const at = (x, y) => grid[((y % N + N) % N) * N + ((x % N + N) % N)];
      const smooth = (x, y) => { const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy); return (at(x0, y0) * (1 - sx) + at(x0 + 1, y0) * sx) * (1 - sy) + (at(x0, y0 + 1) * (1 - sx) + at(x0 + 1, y0 + 1) * sx) * sy; };
      return (x, y, f) => { let v = 0, a = 0.5, s = 0; for (let o = 0; o < 4; o++) { v += a * smooth(x * f * (1 << o), y * f * (1 << o)); s += a; a *= 0.5; } return v / s; };
    })();
    // the period of the noise has to divide the tile so it repeats: frequencies in cells per tile
    const tileNoise = (x, y, cells) => noise((x / S) * cells, (y / S) * cells, 1);
    const put = (L, x, y, v, a = 1, gch = v, b = v) => { const i = (y * S + x) * 4; L[i] = Math.max(0, Math.min(255, v * 255)); L[i + 1] = Math.max(0, Math.min(255, gch * 255)); L[i + 2] = Math.max(0, Math.min(255, b * 255)); L[i + 3] = a * 255; };
    const get = (L, x, y) => L[(y * S + x) * 4] / 255;
    const each = (L, fn) => { for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) fn(x, y, x / S, y / S); };
    // a rectangle in tile units (u right, v up), fn(u, v) gives [value, alpha]
    const rect = (L, u0, v0, u1, v1, fn) => {
      for (let y = Math.max(0, Math.floor(v0 * S)); y < Math.min(S, Math.ceil(v1 * S)); y++) for (let x = Math.max(0, Math.floor(u0 * S)); x < Math.min(S, Math.ceil(u1 * S)); x++) {
        const q = typeof fn === 'function' ? fn(x / S, y / S, x, y) : fn;
        put(L, x, y, q[0], q[1]);
      }
    };
    // glass: a sky reflection running up the pane, darker at the bottom, a streak across
    const glass = (u, v, u0, v0, u1, v1) => { const a = (u - u0) / (u1 - u0), b = (v - v0) / (v1 - v0); return [0.55 + 0.35 * b + 0.18 * Math.max(0, 1 - Math.abs(a + b - 1.1) * 6), 0]; };
    const brickWall = (L, warm) => each(L, (x, y) => {
      const bh = S / 16, row = Math.floor(y / bh), bw = S / 6, off = row % 2 ? bw / 2 : 0, col = Math.floor((x + off) / bw);
      const mortar = y % bh < 1.2 || (x + off) % bw < 1.2;
      const bv = 0.66 + 0.16 * ((Math.sin(row * 12.9 + col * 78.2) * 43758.5) % 1 + 1) % 1 * 0.9 + 0.12 * tileNoise(x, y, 16);
      put(L, x, y, mortar ? 0.92 : bv * (warm ? 1 : 0.97));
    });
    const stoneWall = (L) => each(L, (x, y) => {
      const joint = y % (S / 4) < 1.2 || (x % (S / 2) < 1.2 && Math.floor(y / (S / 4)) % 2 === 0) || ((x + S / 4) % (S / 2) < 1.2 && Math.floor(y / (S / 4)) % 2 === 1);
      put(L, x, y, joint ? 0.72 : 0.8 + 0.1 * tileNoise(x, y, 8) + 0.05 * tileNoise(x, y, 32));
    });
    const brownWall = (L) => each(L, (x, y) => put(L, x, y, 0.7 + 0.18 * tileNoise(x, y, 8) + 0.1 * tileNoise(x, y, 32)));
    const concrete = (L) => each(L, (x, y) => put(L, x, y, 0.76 + 0.14 * tileNoise(x, y, 8) + 0.08 * tileNoise(x, y, 32)));
    // a punched window: a lintel above, a sill below, a frame, two panes over two
    const punched = (L, u0, v0, u1, v1, lintel) => {
      rect(L, u0 - 0.06, v1, u1 + 0.06, v1 + (lintel ? 0.1 : 0.05), () => [0.96, 1]);
      rect(L, u0 - 0.05, v0 - 0.05, u1 + 0.05, v0, () => [0.93, 1]);
      rect(L, u0, v0, u1, v1, () => [0.2, 1]);
      const m = 0.025;
      rect(L, u0 + m, v0 + m, u1 - m, v1 - m, (u, v) => glass(u, v, u0, v0, u1, v1));
      rect(L, (u0 + u1) / 2 - 0.012, v0, (u0 + u1) / 2 + 0.012, v1, () => [0.22, 1]);
      rect(L, u0, (v0 + v1) / 2 - 0.012, u1, (v0 + v1) / 2 + 0.012, () => [0.22, 1]);
    };
    // a storefront: display glass with a door at one side, a kickplate, an awning, a sign band
    const store = (L, frameV) => {
      rect(L, 0.04, 0.02, 0.96, 0.07, () => [0.42, 1]);
      rect(L, 0.04, 0.07, 0.96, 0.72, () => [frameV, 1]);
      rect(L, 0.07, 0.09, 0.66, 0.7, (u, v) => glass(u, v, 0.07, 0.09, 0.66, 0.7));
      rect(L, 0.7, 0.07, 0.93, 0.66, () => [0.16, 1]);
      rect(L, 0.73, 0.1, 0.9, 0.63, (u, v) => glass(u, v, 0.73, 0.1, 0.9, 0.63));
      rect(L, 0.0, 0.74, 1.0, 0.86, (u, v) => [0.85 + 0.15 * (Math.floor(u * 10) % 2), 0.5]);
      rect(L, 0.0, 0.72, 1.0, 0.75, () => [0.3, 0.5]);
      rect(L, 0.0, 0.88, 1.0, 0.98, () => [0.9, 1]);
    };
    // brick: a prewar walk-up
    { const L = out[LAYER.brick]; brickWall(L, true); punched(L, 0.27, 0.24, 0.73, 0.82, true); }
    { const L = out[LAYER.brickSt]; brickWall(L, true); store(L, 0.24); }
    // a fire escape over a brick bay: a landing and its railing at each floor, a ladder down
    // (painted black iron: dark enough that the brick's tint barely shows)
    {
      const L = out[LAYER.fire]; brickWall(L, true); punched(L, 0.27, 0.24, 0.73, 0.82, true);
      const iron = () => [0.07, 1];
      rect(L, 0.0, 0.08, 1.0, 0.13, iron);
      rect(L, 0.0, 0.4, 1.0, 0.43, iron);
      for (let u = 0.02; u < 1; u += 0.08) rect(L, u, 0.13, u + 0.014, 0.4, iron);
      for (let k = 0; k < 6; k++) rect(L, 0.8, 0.13 + k * 0.155, 0.92, 0.14 + k * 0.155, iron);
      rect(L, 0.8, 0.13, 0.81, 1.0, iron); rect(L, 0.91, 0.13, 0.92, 1.0, iron);
    }
    // stone: limestone with taller windows and a pediment
    { const L = out[LAYER.stone]; stoneWall(L); punched(L, 0.3, 0.2, 0.7, 0.84, true); rect(L, 0.24, 0.9, 0.76, 0.95, () => [0.98, 1]); }
    { const L = out[LAYER.stoneSt]; stoneWall(L); store(L, 0.3); }
    // brownstone: a row house
    { const L = out[LAYER.brown]; brownWall(L); punched(L, 0.25, 0.22, 0.75, 0.84, true); }
    {
      const L = out[LAYER.brownSt]; brownWall(L);
      // the stoop: steps up to a door, a window beside it
      for (let s = 0; s < 5; s++) rect(L, 0.05, s * 0.05, 0.45, s * 0.05 + 0.045, () => [0.86 - s * 0.03, 1]);
      rect(L, 0.1, 0.25, 0.4, 0.8, () => [0.14, 1]);
      rect(L, 0.08, 0.8, 0.42, 0.86, () => [0.95, 1]);
      punched(L, 0.56, 0.3, 0.9, 0.78, true);
    }
    // a glass curtain wall: two panes a bay, a spandrel at each floor slab
    {
      const L = out[LAYER.glass];
      each(L, (x, y, u, v) => {
        const mull = u < 0.025 || u > 0.975 || Math.abs(u - 0.5) < 0.012, slab = v < 0.2;
        if (slab) put(L, x, y, 0.52 + 0.05 * tileNoise(x, y, 16));
        else if (mull) put(L, x, y, 0.4);
        else { const q = glass(u, v, 0, 0.2, 1, 1); put(L, x, y, q[0], 0); }
      });
    }
    {
      const L = out[LAYER.glassSt];
      each(L, (x, y, u, v) => {
        if (v > 0.9) put(L, x, y, 0.5);
        else if (u < 0.03 || u > 0.97 || v < 0.03) put(L, x, y, 0.35);
        else { const q = glass(u, v, 0, 0, 1, 0.9); put(L, x, y, q[0] * 0.8, 0); }
      });
    }
    // a concrete grid: deep frames around a window per bay
    {
      const L = out[LAYER.grid]; concrete(L);
      rect(L, 0.12, 0.18, 0.88, 0.88, () => [0.45, 1]);
      rect(L, 0.15, 0.21, 0.85, 0.85, (u, v) => glass(u, v, 0.15, 0.21, 0.85, 0.85));
      rect(L, 0.49, 0.21, 0.51, 0.85, () => [0.35, 1]);
    }
    { const L = out[LAYER.gridSt]; concrete(L); rect(L, 0.05, 0.0, 0.95, 0.8, () => [0.3, 1]); rect(L, 0.08, 0.03, 0.92, 0.77, (u, v) => glass(u, v, 0.08, 0.03, 0.92, 0.77)); }
    // a tar and gravel roof with seams
    { const L = out[LAYER.roof]; each(L, (x, y) => { const seam = x % (S / 2) < 1.5; put(L, x, y, seam ? 0.3 : 0.45 + 0.25 * tileNoise(x, y, 32) + 0.15 * r()); }); }
    // asphalt: fine grain, patches, a crack or two
    {
      const L = out[LAYER.asphalt];
      each(L, (x, y) => put(L, x, y, 0.38 + 0.12 * tileNoise(x, y, 8) + 0.1 * r() + 0.08 * (tileNoise(x, y, 4) > 0.62 ? -1 : 0)));
      for (let k = 0; k < 3; k++) { let x = r() * S, y = r() * S; for (let i = 0; i < S * 0.6; i++) { x = (x + 1 + S) % S; y = (y + (r() - 0.5) * 2.4 + S) % S; put(L, Math.floor(x), Math.floor(y), 0.18); } }
    }
    // sidewalk slabs: one 1.6 m slab a tile, a joint around it, a stain here and there
    { const L = out[LAYER.slab]; each(L, (x, y) => { const j = x < 2 || y < 2; put(L, x, y, j ? 0.58 : 0.8 + 0.07 * tileNoise(x, y, 8) + 0.05 * r() - 0.05 * Math.max(0, tileNoise(x, y, 4) - 0.6) * 5); }); }
    // ground detail: fine (red) and broad (green) noise
    { const L = out[LAYER.detail]; each(L, (x, y) => put(L, x, y, tileNoise(x, y, 16) * 0.6 + r() * 0.4, 1, tileNoise(x, y, 4))); }
    void get;
    return out;
  }

  // ---------- geometry ----------
  // a unit capsule: hemispheres at each end (w: 0 at a, 1 at b), seg sides
  function capsuleMesh(seg, rings) {
    const v = [], idx = [];
    const rowsA = [], rowsB = [];
    for (let i = 0; i <= rings; i++) rowsA.push(-Math.PI / 2 + (i / rings) * (Math.PI / 2));
    for (let i = 0; i <= rings; i++) rowsB.push((i / rings) * (Math.PI / 2));
    const rows = [];
    for (const ph of rowsA) rows.push([ph, 0]);
    for (const ph of rowsB) rows.push([ph, 1]);
    for (const [ph, end] of rows) for (let s = 0; s <= seg; s++) {
      const th = (s / seg) * Math.PI * 2, c = Math.cos(ph);
      v.push(Math.cos(th) * c, Math.sin(th) * c, Math.sin(ph), end);
    }
    const W = seg + 1;
    for (let r0 = 0; r0 < rows.length - 1; r0++) for (let s = 0; s < seg; s++) {
      const a = r0 * W + s, b = a + 1, c = a + W, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    return { v: new Float32Array(v), i: new Uint16Array(idx) };
  }
  function cubeMesh() {
    const v = [], idx = [];
    const faces = [[[1, 0, 0], [0, 1, 0], [0, 0, 1]], [[-1, 0, 0], [0, 1, 0], [0, 0, -1]], [[0, 1, 0], [0, 0, 1], [1, 0, 0]], [[0, -1, 0], [1, 0, 0], [0, 0, 1]], [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [0, 1, 0], [1, 0, 0]]];
    for (const [n, a, b] of faces) {
      const base = v.length / 6;
      for (const [sa, sb] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) v.push(n[0] + a[0] * sa + b[0] * sb, n[1] + a[1] * sa + b[1] * sb, n[2] + a[2] * sa + b[2] * sb, n[0], n[1], n[2]);
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    return { v: new Float32Array(v), i: new Uint16Array(idx) };
  }
  // ear clipping for a simple counterclockwise polygon (x, z pairs): triangle indices
  function earcut(pts, n) {
    const idx = [], V = [];
    for (let i = 0; i < n; i++) V.push(i);
    const X = (i) => pts[i * 2], Z = (i) => pts[i * 2 + 1];
    const cross = (a, b, c) => (X(b) - X(a)) * (Z(c) - Z(a)) - (Z(b) - Z(a)) * (X(c) - X(a));
    const inside = (p, a, b, c) => cross(a, b, p) >= 0 && cross(b, c, p) >= 0 && cross(c, a, p) >= 0;
    let guard = 0;
    while (V.length > 3 && guard++ < n * n) {
      let cut = false;
      for (let i = 0; i < V.length; i++) {
        const a = V[(i + V.length - 1) % V.length], b = V[i], c = V[(i + 1) % V.length];
        if (cross(a, b, c) <= 0) continue;
        let ok = true;
        for (const p of V) if (p !== a && p !== b && p !== c && inside(p, a, b, c)) { ok = false; break; }
        if (!ok) continue;
        idx.push(a, b, c); V.splice(i, 1); cut = true; break;
      }
      if (!cut) break;
    }
    if (V.length === 3) idx.push(V[0], V[1], V[2]);
    else for (let i = 1; i < V.length - 1; i++) idx.push(V[0], V[i], V[i + 1]); // a messy footprint: a fan will do
    return idx;
  }

  MMGL.create = function (canvas, MW, opts = {}) {
    // no antialiasing (10/23, Mark's iPad lost the city past the start): 4x MSAA at an iPad's full
    // resolution is about 180 MB of GPU memory next to MediaPipe's, and GTA3 had none anyway
    const gl = canvas.getContext('webgl2', { alpha: true, antialias: false, depth: true, premultipliedAlpha: true, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
    if (!gl) return null;
    let P = {};
    try {
      P.ground = compile(gl, GROUND_VS, GROUND_FS);
      P.street = compile(gl, STREET_VS, STREET_FS);
      P.flat = compile(gl, FLAT_VS, FLAT_FS);
      P.bld = compile(gl, BLD_VS, BLD_FS);
      P.cap = compile(gl, CAP_VS, CAP_FS);
      P.box = compile(gl, BOX_VS, BOX_FS);
    } catch (e) { console.warn('MMGL', e); return null; }

    // the texture array
    const TS = opts.high ? 256 : 128;
    const arr = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, arr);
    gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA8, TS, TS, NLAYER, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    paintLayers(TS).forEach((L, i) => gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, TS, TS, 1, gl.RGBA, gl.UNSIGNED_BYTE, L));
    gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.REPEAT);
    const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
    const maxAniso = aniso ? Math.min(8, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)) : 0;
    if (aniso) gl.texParameterf(gl.TEXTURE_2D_ARRAY, aniso.TEXTURE_MAX_ANISOTROPY_EXT, maxAniso);

    // static meshes: capsules near and far, the cube
    const meshVAO = (prog, mesh, layout, inst) => {
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, mesh.v, gl.STATIC_DRAW);
      let stride = 0; for (const [, n] of layout) stride += n;
      let off = 0;
      for (const [name, n] of layout) { const loc = prog.a[name]; if (loc >= 0) { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, n, gl.FLOAT, false, stride * 4, off * 4); } off += n; }
      const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.i, gl.STATIC_DRAW);
      const ibuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, ibuf);
      let is = 0; for (const [, n] of inst) is += n;
      off = 0;
      for (const [name, n] of inst) { const loc = prog.a[name]; if (loc >= 0) { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, n, gl.FLOAT, false, is * 4, off * 4); gl.vertexAttribDivisor(loc, 1); } off += n; }
      gl.bindVertexArray(null);
      return { vao, ibuf, count: mesh.i.length, stride: is };
    };
    const CAP_INST = [['iA', 3], ['iB', 3], ['iR', 1], ['iCol', 3]];
    const capNear = meshVAO(P.cap, capsuleMesh(10, 3), [['aLocal', 4]], CAP_INST);
    const capFar = meshVAO(P.cap, capsuleMesh(6, 1), [['aLocal', 4]], CAP_INST);
    const cube = meshVAO(P.box, cubeMesh(), [['aPos', 3], ['aNrm', 3]], [['iC', 3], ['iH', 2], ['iS', 3], ['iCol', 4]]);
    const capsN = Floats(4096), capsF = Floats(4096), boxes = Floats(2048), flats = Floats(8192), shadows = Floats(4096);

    // dynamic flat triangles (route, shadows)
    const flatVAO = (() => {
      const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
      const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.enableVertexAttribArray(P.flat.a.aPos); gl.vertexAttribPointer(P.flat.a.aPos, 3, gl.FLOAT, false, 28, 0);
      gl.enableVertexAttribArray(P.flat.a.aCol); gl.vertexAttribPointer(P.flat.a.aCol, 4, gl.FLOAT, false, 28, 12);
      gl.bindVertexArray(null);
      return { vao, b };
    })();

    // ---------- ground tiles: painted once each into a texture ----------
    let TILE_PX = opts.high ? 1024 : 512;
    const tiles = new Map();
    const tileQuad = (() => {
      const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
      const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(8), gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(P.ground.a.aXZ); gl.vertexAttribPointer(P.ground.a.aXZ, 2, gl.FLOAT, false, 8, 0);
      gl.bindVertexArray(null);
      return { vao, b };
    })();
    const GROUND_ORDER = [8, 0, 6, 4, 2, 1, 3, 5, 7];
    const paintCanvas = document.createElement('canvas');
    paintCanvas.width = paintCanvas.height = TILE_PX;
    const pc = paintCanvas.getContext('2d');
    function buildTile(ti, tj) {
      const t = MW.tile(ti, tj), H = MW.H, AT = H.AT;
      if (paintCanvas.width !== TILE_PX) paintCanvas.width = paintCanvas.height = TILE_PX;
      const x0 = H.X0 + ti * AT, zs0 = H.Z0 + tj * AT, k = TILE_PX / AT;
      pc.fillStyle = `rgb(${MW.WATER_COL.join(',')})`; pc.fillRect(0, 0, TILE_PX, TILE_PX);
      if (t) for (const cls of GROUND_ORDER) {
        const col = cls === 5 ? MW.WATER_COL : MW.GROUND_COL[cls];
        if (!col) continue;
        pc.fillStyle = `rgb(${col.join(',')})`;
        for (const p of t.polys) {
          if (p.cls !== cls) continue;
          pc.beginPath();
          for (const ring of p.rings) {
            for (let q = 0; q < ring.length; q += 2) { const px = (ring[q] - x0) * k, py = (-ring[q + 1] - zs0) * k; if (q) pc.lineTo(px, py); else pc.moveTo(px, py); }
            pc.closePath();
          }
          pc.fill('evenodd');
        }
      }
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, paintCanvas);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, maxAniso);
      // canvas row 0 is the tile's north edge (z south smallest)
      return { tex, x0, zTop: -zs0, size: AT };
    }

    // ---------- streets: one mesh per chunk, drawn in layers ----------
    const ASPHALT = [66, 69, 74], WALK = [176, 172, 164], LINE_Y = [214, 178, 52], LINE_W = [226, 226, 220], CURB = [196, 192, 184], GUTTER = [46, 48, 52], ZEBRA = [232, 232, 228];
    const STREET_LAYERS = 4;
    function buildStreets(cx, cz) {
      const H = MW.H, CH = H.CH, x0 = H.X0 + cx * CH, zs0 = H.Z0 + cz * CH;
      const inChunk = (x, z) => x >= x0 && x < x0 + CH && -z >= zs0 && -z < zs0 + CH;
      const layers = []; for (let i = 0; i < STREET_LAYERS; i++) layers.push([]);
      const quad = (L, ax, az, bx, bz, nx, nz, w0, w1, y, col, mat) => {
        const c = [col[0] / 255, col[1] / 255, col[2] / 255];
        const p = [[ax + nx * w0, az + nz * w0], [bx + nx * w0, bz + nz * w0], [bx + nx * w1, bz + nz * w1], [ax + nx * w1, az + nz * w1]];
        for (const i of [0, 1, 2, 0, 2, 3]) layers[L].push(p[i][0], y, p[i][1], c[0], c[1], c[2], mat);
      };
      const edges = new Set();
      MW.edgesNear(x0 + CH / 2, -(zs0 + CH / 2), CH * 0.75 + 40, (e) => { if (MW.ECLS[e] <= 7) edges.add(e); });
      const seenNode = new Set();
      for (const e of edges) {
        const w = MW.roadW(e) / 2, walk = MW.walkEdge(e), wide = MW.ECLS[e] <= 4, two = !MW.oneway(e);
        let s0 = 0;
        for (let k = MW.EP0[e]; k < MW.EP0[e + 1] - 1; k++) {
          const ax = MW.PX[k], az = MW.PZ[k], bx = MW.PX[k + 1], bz = MW.PZ[k + 1];
          const Ls = Math.hypot(bx - ax, bz - az) || 1;
          if (!inChunk((ax + bx) / 2, (az + bz) / 2)) { s0 += Ls; continue; }
          const nx = (bz - az) / Ls, nz = -(bx - ax) / Ls, ux = (bx - ax) / Ls, uz = (bz - az) / Ls;
          // a little past each end, so the joints between segments close
          const ex = ux * 0.3, ez = uz * 0.3, ax2 = ax - ex, az2 = az - ez, bx2 = bx + ex, bz2 = bz + ez;
          if (walk) quad(0, ax2, az2, bx2, bz2, nx, nz, -w - MW.SIDEWALK, w + MW.SIDEWALK, 0.01, WALK, 2);
          quad(1, ax2, az2, bx2, bz2, nx, nz, -w, w, 0.02, ASPHALT, 1);
          if (walk) for (const sd of [-1, 1]) { quad(2, ax, az, bx, bz, nx, nz, sd * w, sd * (w + 0.3), 0.025, CURB, 0); quad(2, ax, az, bx, bz, nx, nz, sd * (w - 0.35), sd * w, 0.022, GUTTER, 0); }
          if (wide && two) { quad(3, ax, az, bx, bz, nx, nz, -0.22, -0.08, 0.03, LINE_Y, 0); quad(3, ax, az, bx, bz, nx, nz, 0.08, 0.22, 0.03, LINE_Y, 0); }
          if (wide && w > 4.5) {
            const lanes = Math.floor((2 * w) / 3.3);
            for (let li = 1; li < lanes; li++) {
              const off = -w + (li * 2 * w) / lanes;
              if (two && Math.abs(off) < 1) continue;
              for (let t = (9 - (s0 % 9)) % 9; t < Ls; t += 9) {
                const t1 = Math.min(Ls, t + 3);
                quad(3, ax + ux * t, az + uz * t, ax + ux * t1, az + uz * t1, nx, nz, off - 0.08, off + 0.08, 0.03, LINE_W, 0);
              }
            }
          }
          s0 += Ls;
        }
        // zebra crossings where three or more streets meet
        if (!walk) continue;
        for (const end of [0, 1]) {
          const n = end ? MW.EN1[e] : MW.EN0[e];
          if (n < 0 || MW.NODE_OFF[n + 1] - MW.NODE_OFF[n] < 3) continue;
          const key = n * 1e5 + e;
          if (seenNode.has(key)) continue;
          seenNode.add(key);
          const k0 = end ? MW.EP0[e + 1] - 1 : MW.EP0[e], k1 = end ? k0 - 1 : k0 + 1;
          const px = MW.PX[k0], pz = MW.PZ[k0];
          if (!inChunk(px, pz)) continue;
          const Ls = Math.hypot(MW.PX[k1] - px, MW.PZ[k1] - pz) || 1, ux = (MW.PX[k1] - px) / Ls, uz = (MW.PZ[k1] - pz) / Ls, nx = uz, nz = -ux;
          let cross = 0;
          for (let q = MW.NODE_OFF[n]; q < MW.NODE_OFF[n + 1]; q++) { const e2 = MW.NODE_EDGES[q] >> 1; if (e2 !== e) cross = Math.max(cross, MW.roadW(e2) / 2); }
          const a0 = cross + 1.2, a1 = Math.min(Ls, cross + 4.4);
          if (a1 <= a0) continue;
          for (let t = -w + 0.5; t < w - 0.4; t += 1.1) quad(3, px + ux * a0, pz + uz * a0, px + ux * a1, pz + uz * a1, nx, nz, t, t + 0.55, 0.03, ZEBRA, 0);
        }
      }
      const total = layers.reduce((n, l) => n + l.length, 0), data = new Float32Array(total), ranges = [];
      let off = 0;
      for (const l of layers) { data.set(l, off); ranges.push([off / 7, l.length / 7]); off += l.length; }
      const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
      const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      const A = P.street.a;
      gl.enableVertexAttribArray(A.aPos); gl.vertexAttribPointer(A.aPos, 3, gl.FLOAT, false, 28, 0);
      gl.enableVertexAttribArray(A.aCol); gl.vertexAttribPointer(A.aCol, 3, gl.FLOAT, false, 28, 12);
      gl.enableVertexAttribArray(A.aMat); gl.vertexAttribPointer(A.aMat, 1, gl.FLOAT, false, 28, 24);
      gl.bindVertexArray(null);
      return { vao, b, ranges };
    }

    // ---------- buildings: one mesh per chunk ----------
    // style by height and color: towers glass or a concrete grid, mid-rises brick or limestone,
    // low ones brownstone or brick
    function styleOf(b, tint) {
      const s = (b.seed * 13.7) % 1;
      if (b.h > 40) return s < 0.6 ? [LAYER.glass, LAYER.glassSt, 3.0, 3.6] : [LAYER.grid, LAYER.gridSt, 2.6, 3.6];
      const red = tint[0] - tint[2] > 30;
      if (b.h > 12) return red ? [LAYER.brick, LAYER.brickSt, 2.7, 3.4] : [LAYER.stone, LAYER.stoneSt, 2.9, 3.7];
      return red && s < 0.5 ? [LAYER.brick, LAYER.brickSt, 2.6, 3.2] : [LAYER.brown, LAYER.brownSt, 2.6, 3.2];
    }
    const BV = 17; // floats a vertex: pos 3, normal 3, wall 4, kind 4, tint 3
    function buildBuildings(cx, cz) {
      const ch = MW.chunk(cx, cz);
      const v = Floats(1 << 16);
      let minH = Infinity, maxH = 0;
      const push = (x, y, z, nx, ny, nz, w0, w1, w2, w3, k0, k1, k2, k3, t) => {
        grow(v, BV);
        const a = v.a; let i = v.n;
        a[i++] = x; a[i++] = y; a[i++] = z; a[i++] = nx; a[i++] = ny; a[i++] = nz; a[i++] = w0; a[i++] = w1; a[i++] = w2; a[i++] = w3; a[i++] = k0; a[i++] = k1; a[i++] = k2; a[i++] = k3; a[i++] = t[0]; a[i++] = t[1]; a[i++] = t[2];
        v.n = i;
      };
      // a plain solid (water tanks): a cylinder of n sides, or a cone when r1 is 0
      const solid = (x, z, y0, y1, r0, r1, n, t) => {
        for (let s = 0; s < n; s++) {
          const a0 = (s / n) * Math.PI * 2, a1 = ((s + 1) / n) * Math.PI * 2, am = (a0 + a1) / 2;
          const nx = Math.cos(am), nz = Math.sin(am), ny = (r0 - r1) / Math.max(0.1, y1 - y0);
          const q = [[x + Math.cos(a0) * r0, y0, z + Math.sin(a0) * r0], [x + Math.cos(a1) * r0, y0, z + Math.sin(a1) * r0], [x + Math.cos(a1) * r1, y1, z + Math.sin(a1) * r1], [x + Math.cos(a0) * r1, y1, z + Math.sin(a0) * r1]];
          for (const i of [0, 1, 2, 0, 2, 3]) push(q[i][0], q[i][1], q[i][2], nx, ny, nz, 0, 0, 1, 1, -1, -1, 0, 0, t);
        }
      };
      if (ch) for (const b of ch.blds) {
        const tint0 = opts.facadeOf(b), tint = [tint0[0] / 255, tint0[1] / 255, tint0[2] / 255];
        const [up, stl, bay, floorH] = styleOf(b, tint0);
        const street = b.base < 0.5 && b.h > 5 ? stl : -1;
        const pts = b.pts, n = b.n, h = b.h, base = b.base, top = h - base;
        minH = Math.min(minH, h); maxH = Math.max(maxH, h);
        for (let k = 0; k < n; k++) {
          const k2 = (k + 1) % n, ax = pts[k * 2], az = pts[k * 2 + 1], bx = pts[k2 * 2], bz = pts[k2 * 2 + 1];
          const ex = bx - ax, ez = bz - az, L = Math.hypot(ex, ez);
          if (L < 0.3) continue;
          const nx = ez / L, nz = -ex / L;
          // whole bays along the wall
          const bw = L / Math.max(1, Math.round(L / bay)), seed = (b.seed + k * 0.618) % 1;
          const q = [[ax, base, az, 0, 0], [bx, base, bz, L, 0], [bx, h, bz, L, top], [ax, h, az, 0, top]];
          for (const i of [0, 1, 2, 0, 2, 3]) push(q[i][0], q[i][1], q[i][2], nx, 0, nz, q[i][3], q[i][4], floorH, bw, up, street, seed, top, tint);
          // an overpass's underside
        }
        // the roof
        const tri = n === 4 ? [0, 1, 2, 0, 2, 3] : earcut(pts, n);
        const roofT = [tint[0] * 0.55 + 0.12, tint[1] * 0.55 + 0.12, tint[2] * 0.55 + 0.12];
        for (const i of tri) push(pts[i * 2], h, pts[i * 2 + 1], 0, 1, 0, 0, 0, 1, 1, -2, -1, 0, 0, roofT);
        if (base > 0.5) for (let i = tri.length - 1; i >= 0; i--) push(pts[tri[i] * 2], base, pts[tri[i] * 2 + 1], 0, -1, 0, 0, 0, 1, 1, -1, -1, 0, 0, [tint[0] * 0.5, tint[1] * 0.5, tint[2] * 0.5]);
        // a wooden water tank on the roof of an old mid-rise
        if (opts.high && h > 12 && h < 45 && (b.seed * 7.3) % 1 > 0.55 && b.area > 250) {
          const x = b.x + (b.seed - 0.5) * 4, z = b.z + (((b.seed * 3.7) % 1) - 0.5) * 4;
          for (const [lx, lz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) solid(x + lx * 1.1, z + lz * 1.1, h, h + 2.8, 0.12, 0.12, 4, [0.27, 0.28, 0.3]);
          solid(x, z, h + 2.8, h + 6.0, 1.5, 1.5, 10, [0.49, 0.33, 0.2]);
          solid(x, z, h + 6.0, h + 7.2, 1.55, 0, 10, [0.31, 0.23, 0.17]);
        }
      }
      const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
      const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, v.a.subarray(0, v.n), gl.STATIC_DRAW);
      const A = P.bld.a;
      let off = 0;
      for (const [name, k] of [['aPos', 3], ['aNrm', 3], ['aWall', 4], ['aKind', 4], ['aTint', 3]]) { if (A[name] >= 0) { gl.enableVertexAttribArray(A[name]); gl.vertexAttribPointer(A[name], k, gl.FLOAT, false, BV * 4, off * 4); } off += k; }
      gl.bindVertexArray(null);
      return { vao, buf, count: v.n / BV, maxH };
    }

    // chunk caches, built nearest first within a time budget each frame
    const chunks = new Map();
    // GPU memory: how long things out of view stay, how many chunks at most, the resolution cap
    const mem = { keepMs: 4000, maxChunks: 16, dprCap: opts.high ? 1.5 : 1, checkAt: 0 };
    const sizes = new WeakMap();
    const chunkKey = (cx, cz) => cz * 1000 + cx;
    function freeChunk(c) { for (const m of [c.st, c.bl]) if (m) { gl.deleteBuffer(m.b || m.buf); gl.deleteVertexArray(m.vao); } }

    // ---------- the frame ----------
    let M = new Float32Array(16), PM = new Float32Array(16), cam = null, look = null, D = 420, Wd = 1, Ht = 1;
    const st = { built: 0, tris: 0 };
    function mat(rows) { const m = new Float32Array(16); for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) m[c * 4 + r] = rows[r][c]; return m; }
    function mul(a, b) { const o = new Float32Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; }

    // f: { W, H, dpr, F, cam, roll, shk, look, drawDistance, sun: { x, z } }
    function begin(f) {
      cam = f.cam; look = f.look; D = f.drawDistance; Wd = f.W; Ht = f.H;
      // resolution capped (1.5 on high, 1 on low or after the GPU ran short), the 2D layer on top stays sharp
      const dpr = Math.min(f.dpr, mem.dprCap), cw = Math.round(f.W * dpr), chh = Math.round(f.H * dpr);
      if (canvas.width !== cw || canvas.height !== chh) { canvas.width = cw; canvas.height = chh; }
      const th = -(f.roll || 0), c = Math.cos(th), s = Math.sin(th), hw = f.W / 2, hh = f.H / 2, F = f.F;
      const n = 0.12, fa = 1500, za = (fa + n) / (fa - n), zb = (-2 * fa * n) / (fa - n);
      PM = mat([[(F * c) / hw, (F * s) / hw, (f.shk ? f.shk.x : 0) / hw, 0], [(-F * s) / hh, (F * c) / hh, -(f.shk ? f.shk.y : 0) / hh, 0], [0, 0, za, zb], [0, 0, 1, 0]]);
      const { cy, sy, cp, sp } = cam;
      const R = [[cy, 0, -sy], [sy * sp, cp, cy * sp], [sy * cp, -sp, cy * cp]];
      const V = mat([[R[0][0], R[0][1], R[0][2], -(R[0][0] * cam.x + R[0][1] * cam.y + R[0][2] * cam.z)], [R[1][0], R[1][1], R[1][2], -(R[1][0] * cam.x + R[1][1] * cam.y + R[1][2] * cam.z)], [R[2][0], R[2][1], R[2][2], -(R[2][0] * cam.x + R[2][1] * cam.y + R[2][2] * cam.z)], [0, 0, 0, 1]]);
      M = mul(PM, V);
      f.Rot = R;
      begin.f = f;
      capsN.n = capsF.n = boxes.n = flats.n = shadows.n = 0;
    }
    // queue from the game's drawing: a capsule or ball in camera space
    function cap(a, b, r, col) {
      const far = (a.z + b.z) / 2 > 35, B = far ? capsF : capsN;
      grow(B, 10);
      const x = B.a; let i = B.n;
      x[i++] = a.x; x[i++] = a.y; x[i++] = a.z; x[i++] = b.x; x[i++] = b.y; x[i++] = b.z; x[i++] = r; x[i++] = col[0] / 255; x[i++] = col[1] / 255; x[i++] = col[2] / 255;
      B.n = i;
    }
    // a box in the world: center, half length along heading (hx, hz), half width, half height;
    // taper < 1 narrows its top (a car's cabin); glow: unlit (lights)
    function box(cx, cy, cz, hl, hw, hh, hx, hz, col, taper = 1, glow = false) {
      grow(boxes, 12);
      const x = boxes.a; let i = boxes.n;
      x[i++] = cx; x[i++] = cy; x[i++] = cz; x[i++] = hx; x[i++] = hz; x[i++] = hl; x[i++] = hw; x[i++] = hh; x[i++] = col[0] / 255; x[i++] = col[1] / 255; x[i++] = col[2] / 255; x[i++] = glow ? -taper : taper;
      boxes.n = i;
    }
    // see-through polygons on the ground: pts [[x, z], ...] (a convex fan), rgba 0..255 and 0..1
    function flat(pts, y, rgb, a, into = flats) {
      for (let k = 1; k < pts.length - 1; k++) for (const q of [pts[0], pts[k], pts[k + 1]]) {
        grow(into, 7);
        const x = into.a; let i = into.n;
        x[i++] = q[0]; x[i++] = y; x[i++] = q[1]; x[i++] = rgb[0] / 255; x[i++] = rgb[1] / 255; x[i++] = rgb[2] / 255; x[i++] = a;
        into.n = i;
      }
    }
    // a soft shadow: an ellipse around (x, z) along (fx, fz) and across, dark in the middle
    function shadow(x, z, fx, fz, along, across, alpha) {
      const n = 12, rx = fz, rz = -fx;
      for (let k = 0; k < n; k++) {
        const a0 = (k / n) * Math.PI * 2, a1 = ((k + 1) / n) * Math.PI * 2;
        const p0 = [x + fx * Math.cos(a0) * along + rx * Math.sin(a0) * across, z + fz * Math.cos(a0) * along + rz * Math.sin(a0) * across];
        const p1 = [x + fx * Math.cos(a1) * along + rx * Math.sin(a1) * across, z + fz * Math.cos(a1) * along + rz * Math.sin(a1) * across];
        for (const [q, a] of [[[x, z], alpha], [p0, 0], [p1, 0]]) {
          grow(shadows, 7);
          const s = shadows.a; let i = shadows.n;
          s[i++] = q[0]; s[i++] = 0.04; s[i++] = q[1]; s[i++] = 0; s[i++] = 0; s[i++] = 0; s[i++] = a;
          shadows.n = i;
        }
      }
    }

    function setCommon(p) {
      const Lk = look;
      gl.uniform3f(p.u.uCam, cam.x, cam.y, cam.z);
      gl.uniform3f(p.u.uAmb, Lk.amb[0], Lk.amb[1], Lk.amb[2]);
      gl.uniform3f(p.u.uSun, Lk.sun[0], Lk.sun[1], Lk.sun[2]);
      gl.uniform3f(p.u.uFog, Lk.fog[0] / 255, Lk.fog[1] / 255, Lk.fog[2] / 255);
      gl.uniform1f(p.u.uD, D);
      if (p.u.uM) gl.uniformMatrix4fv(p.u.uM, false, M);
      if (p.u.uP) gl.uniformMatrix4fv(p.u.uP, false, PM);
    }
    // the chunks around the camera: { cx, cz, dist } in view, nearest first
    function chunksInView() {
      const H = MW.H, CH = H.CH, out = [];
      const [c0x, c0z] = MW.chunkOf(cam.x - D, cam.z + D), [c1x, c1z] = MW.chunkOf(cam.x + D, cam.z - D);
      for (let cz = c0z; cz <= c1z; cz++) for (let cx = c0x; cx <= c1x; cx++) {
        if (cx < 0 || cz < 0 || cx >= H.NCX || cz >= H.NCZ) continue;
        const x0 = H.X0 + cx * CH, z1 = -(H.Z0 + cz * CH), z0 = z1 - CH;
        const dx = Math.max(x0 - cam.x, 0, cam.x - (x0 + CH)), dz = Math.max(z0 - cam.z, 0, cam.z - z1), dist = Math.hypot(dx, dz);
        if (dist > D) continue;
        // behind the camera entirely
        let ahead = false;
        for (const [x, z] of [[x0, z0], [x0 + CH, z0], [x0, z1], [x0 + CH, z1]]) if ((x - cam.x) * cam.sy + (z - cam.z) * cam.cy > -30) ahead = true;
        // behind you: kept loaded (turning around would rebuild it) but not drawn
        out.push({ cx, cz, dist, ahead: ahead || dist <= 30 });
      }
      return out.sort((a, b) => (b.ahead - a.ahead) || a.dist - b.dist);
    }

    function draw() {
      const f = begin.f, Lk = look;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clearDepth(1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.disable(gl.CULL_FACE);
      const t0 = performance.now(), budget = opts.budgetMs || 6;
      // chunks: build what is missing, nearest first, within the time budget (at least one)
      const near = chunksInView(), view = near.filter((v) => v.ahead);
      let builtOne = false;
      for (const v of near) {
        const k = chunkKey(v.cx, v.cz);
        let c = chunks.get(k);
        if (!c) { c = { cx: v.cx, cz: v.cz }; chunks.set(k, c); }
        c.used = t0;
        if (!c.st || !c.bl) {
          if (builtOne && performance.now() - t0 > budget) continue;
          const b0 = performance.now();
          if (!c.st) c.st = buildStreets(v.cx, v.cz);
          else c.bl = buildBuildings(v.cx, v.cz);
          builtOne = true; st.built++;
          if (!c.bl && performance.now() - t0 < budget) c.bl = buildBuildings(v.cx, v.cz);
          st.buildMax = Math.max(st.buildMax || 0, performance.now() - b0);
        }
      }
      // free chunks unused for a while
      // free chunks out of view for a few seconds: GPU memory on a tablet is shared with the camera's tracker
      for (const [k, c] of chunks) if (t0 - c.used > mem.keepMs || (chunks.size > mem.maxChunks && c.used !== t0)) { freeChunk(c); chunks.delete(k); }

      // 1. the ground: tiles, then streets layer by layer, no depth (nothing sits under them)
      gl.disable(gl.DEPTH_TEST); gl.depthMask(false); gl.disable(gl.BLEND);
      {
        const p = P.ground; gl.useProgram(p.p); setCommon(p);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D_ARRAY, arr); gl.uniform1i(p.u.uArr, 1);
        gl.uniform1i(p.u.uTex, 0);
        const H = MW.H, [ti0, tj0] = MW.tileOf(cam.x - D, cam.z + D), [ti1, tj1] = MW.tileOf(cam.x + D, cam.z - D);
        let paintedOne = false;
        gl.bindVertexArray(tileQuad.vao);
        for (let tj = tj0; tj <= tj1; tj++) for (let ti = ti0; ti <= ti1; ti++) {
          if (ti < 0 || tj < 0 || ti >= H.NAX || tj >= H.NAZ) continue;
          const k = tj * 1000 + ti;
          let t = tiles.get(k);
          if (!t) { if (paintedOne && performance.now() - t0 > budget) continue; t = buildTile(ti, tj); tiles.set(k, t); paintedOne = true; }
          t.used = t0;
          const x1 = t.x0 + t.size, z0 = t.zTop - t.size;
          gl.bindBuffer(gl.ARRAY_BUFFER, tileQuad.b);
          gl.bufferSubData(gl.ARRAY_BUFFER, 0, new Float32Array([t.x0, t.zTop, x1, t.zTop, x1, z0, t.x0, z0]));
          gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, t.tex);
          gl.uniform4f(p.u.uTile, t.x0, t.zTop, t.size, 0);
          gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);
        }
        for (const [k, t] of tiles) if (t0 - t.used > mem.keepMs) { gl.deleteTexture(t.tex); tiles.delete(k); }
      }
      {
        const p = P.street; gl.useProgram(p.p); setCommon(p);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D_ARRAY, arr); gl.uniform1i(p.u.uArr, 1);
        for (let L = 0; L < STREET_LAYERS; L++) for (const v of view) {
          const c = chunks.get(chunkKey(v.cx, v.cz));
          if (!c || !c.st) continue;
          if (L >= 2 && v.dist > (opts.high ? 220 : 120)) continue;
          const [first, count] = c.st.ranges[L];
          if (!count) continue;
          gl.bindVertexArray(c.st.vao);
          gl.drawArrays(gl.TRIANGLES, first, count);
        }
      }
      // 2. see-through things on the ground: the route, then shadows
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      {
        const p = P.flat; gl.useProgram(p.p); setCommon(p);
        gl.bindVertexArray(flatVAO.vao); gl.bindBuffer(gl.ARRAY_BUFFER, flatVAO.b);
        for (const [B, lit] of [[flats, 0], [shadows, 0]]) {
          if (!B.n) continue;
          gl.uniform1f(p.u.uLit, lit);
          upload(B);
          gl.drawArrays(gl.TRIANGLES, 0, B.n / 7);
        }
      }
      gl.disable(gl.BLEND);
      // 3. solid things, with depth: buildings, boxes, people and props
      gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.depthFunc(gl.LEQUAL);
      st.tris = 0;
      {
        const p = P.bld; gl.useProgram(p.p); setCommon(p);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D_ARRAY, arr); gl.uniform1i(p.u.uArr, 1);
        gl.uniform2f(p.u.uSunH, f.sun.x, f.sun.z);
        const sky = Lk.top.map((v, i) => (v * 0.6 + Lk.hor[i] * 0.4) / 255);
        gl.uniform3f(p.u.uGlass, sky[0] * 0.55, sky[1] * 0.55, sky[2] * 0.55);
        gl.uniform3f(p.u.uGlassTower, sky[0] * 0.85, sky[1] * 0.85, sky[2] * 0.85);
        gl.uniform1f(p.u.uGolden, f.golden ? 1 : 0);
        gl.uniform1f(p.u.uNight, Lk.night ? 1 : 0);
        for (const v of view) {
          const c = chunks.get(chunkKey(v.cx, v.cz));
          if (!c || !c.bl || !c.bl.count) continue;
          gl.bindVertexArray(c.bl.vao);
          gl.drawArrays(gl.TRIANGLES, 0, c.bl.count);
          st.tris += c.bl.count / 3;
        }
      }
      // the sun in camera space, and up
      const R = f.Rot, sw = { x: f.sun.x * Math.cos(Lk.el || 0.3), y: Math.max(0.2, Math.sin(Lk.el || 0.3)), z: f.sun.z * Math.cos(Lk.el || 0.3) };
      const toC = (v) => [R[0][0] * v.x + R[0][1] * v.y + R[0][2] * v.z, R[1][0] * v.x + R[1][1] * v.y + R[1][2] * v.z, R[2][0] * v.x + R[2][1] * v.y + R[2][2] * v.z];
      if (boxes.n) {
        const p = P.box; gl.useProgram(p.p); setCommon(p);
        const l = Math.hypot(sw.x, sw.y, sw.z);
        gl.uniform3f(p.u.uSunW, sw.x / l, sw.y / l, sw.z / l);
        gl.bindVertexArray(cube.vao); gl.bindBuffer(gl.ARRAY_BUFFER, cube.ibuf);
        upload(boxes);
        gl.drawElementsInstanced(gl.TRIANGLES, cube.count, gl.UNSIGNED_SHORT, 0, boxes.n / 12);
      }
      if (capsN.n || capsF.n) {
        const p = P.cap; gl.useProgram(p.p); setCommon(p);
        const s = toC(sw), l = Math.hypot(...s), up = toC({ x: 0, y: 1, z: 0 });
        gl.uniform3f(p.u.uSunCam, s[0] / l, s[1] / l, s[2] / l);
        gl.uniform3f(p.u.uUpCam, up[0], up[1], up[2]);
        for (const [B, mesh] of [[capsN, capNear], [capsF, capFar]]) {
          if (!B.n) continue;
          gl.bindVertexArray(mesh.vao); gl.bindBuffer(gl.ARRAY_BUFFER, mesh.ibuf);
          upload(B);
          gl.drawElementsInstanced(gl.TRIANGLES, mesh.count, gl.UNSIGNED_SHORT, 0, B.n / 10);
        }
      }
      gl.bindVertexArray(null);
      memCheck(t0);
      st.ms = performance.now() - t0;
      st.chunks = chunks.size; st.tiles = tiles.size;
    }
    // per-frame data into the bound buffer: it keeps its size and only grows, so the driver does not
    // reallocate every frame
    function upload(B) {
      const buf = gl.getParameter(gl.ARRAY_BUFFER_BINDING);
      const cap = sizes.get(buf) || 0, need = B.n * 4;
      if (need > cap) { const n = Math.max(need, cap * 2, 65536); gl.bufferData(gl.ARRAY_BUFFER, n, gl.DYNAMIC_DRAW); sizes.set(buf, n); }
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, B.a, 0, B.n);
    }
    // once a second: did the GPU run out of memory? Then free everything out of view, halve the
    // ground textures and drop the resolution, and the next frames rebuild what is in view
    function memCheck(t0) {
      if (t0 < mem.checkAt) return;
      mem.checkAt = t0 + 1000;
      let e, oom = false;
      while ((e = gl.getError()) !== gl.NO_ERROR) { if (e === gl.OUT_OF_MEMORY) oom = true; st.glErrors = (st.glErrors || 0) + 1; }
      if (!oom) return;
      st.oom = (st.oom || 0) + 1;
      for (const [k, c] of chunks) { freeChunk(c); chunks.delete(k); }
      for (const [k, t] of tiles) { gl.deleteTexture(t.tex); tiles.delete(k); }
      TILE_PX = 512; mem.dprCap = 1; mem.maxChunks = 12;
    }
    function clear() { gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); }
    return { begin, draw, clear, cap, box, flat, shadow, stats: st, get lost() { return gl.isContextLost(); } };
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
