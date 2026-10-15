// The Manhattan map (src/world.js over data/): decodes, routes, and answers
// where you can walk, in the game's coordinates (x east, z north, meters,
// origin at Times Square).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ctx = vm.createContext({ console, TextDecoder });
ctx.globalThis = ctx;
vm.runInContext(readFileSync(join(ROOT, 'src/world.js'), 'utf8'), ctx, { filename: 'world.js' });
const W = ctx.MMWorld;
W.load(
  new Uint8Array(gunzipSync(Buffer.from(readFileSync(join(ROOT, 'data/world.b64'), 'utf8').trim(), 'base64'))),
  JSON.parse(readFileSync(join(ROOT, 'data/biz.json'), 'utf8')),
  JSON.parse(readFileSync(join(ROOT, 'data/subway.json'), 'utf8')),
);
const at = (a, b) => { const p = W.intersection(a, b); assert.ok(p, `${a} and ${b} meet`); return p; };

test('the map decodes: streets, nodes, businesses, stations', () => {
  assert.ok(W.NE > 8000 && W.NN > 5000, `${W.NE} edges, ${W.NN} nodes`);
  assert.ok(W.biz.p.length > 10000);
  assert.ok(W.stations.length > 100);
  const ts = W.stations.find((s) => s.name === 'Times Sq-42 St');
  for (const l of ['1', '2', '3', '7', 'N', 'Q', 'R', 'W', 'S']) assert.ok(ts.lines.includes(l), `Times Sq has the ${l}`);
});

test('north is +z: 59th Street is north of 34th, and Harlem north of both', () => {
  const s34 = at('8th Avenue', 'West 34th Street'), s59 = at('8th Avenue', 'West 57th Street');
  assert.ok(s59.z > s34.z + 1500, `57th ${s59.z} vs 34th ${s34.z}`);
  const harlem = W.places.find((p) => p.name === 'Harlem');
  assert.ok(harlem.z > s59.z + 3000);
  // and the grid runs about 29 degrees east of north
  const ang = (Math.atan2(s59.x - s34.x, s59.z - s34.z) * 180) / Math.PI;
  assert.ok(ang > 20 && ang < 38, `8th Ave runs ${ang.toFixed(1)} degrees off north`);
});

test('walkable: streets and sidewalks and parks yes; buildings and the river no', () => {
  const c = at('8th Avenue', 'West 34th Street');
  assert.ok(W.walkable(c.x, c.z), 'the intersection');
  // the middle of the block between 8th and 7th, north of 34th, is buildings
  const s35 = at('7th Avenue', 'West 35th Street');
  const mid = { x: (c.x + s35.x) / 2, z: (c.z + s35.z) / 2 };
  assert.ok(!W.walkable(mid.x, mid.z), 'inside the block');
  assert.ok(W.groundAt(-1700, 0) === -1 && !W.walkable(-1700, 0), 'the Hudson');
  const cp = W.places.find((p) => p.name === 'Central Park');
  assert.equal(W.groundAt(cp.x, cp.z), 1, 'Central Park is park');
});

test('a building that reaches over a street is an overpass you walk under', () => {
  // the Port Authority Bus Terminal reaches over 8th Avenue at 41st Street
  const p = at('8th Avenue', 'West 41st Street');
  let blocked = 0;
  for (let t = -40; t <= 40; t += 4) {
    const n = W.nearestEdge(p.x, p.z, 30, (e) => W.edgeName(e) === '8th Avenue');
    const d = W.edgeDir(n.e, n.k);
    if (!W.walkable(p.x + d.x * t, p.z + d.z * t)) blocked++;
  }
  assert.equal(blocked, 0, '8th Avenue is open along the terminal');
});

test('routing: Penn Station to Times Square on the streets', () => {
  const a = at('8th Avenue', 'West 34th Street'), b = at('7th Avenue', 'West 42nd Street');
  const r = W.route(a.x, a.z, b.x, b.z);
  assert.ok(r, 'a route');
  const straight = Math.hypot(a.x - b.x, a.z - b.z);
  assert.ok(r.len >= straight && r.len < straight * 1.6, `route ${r.len.toFixed(0)} m for ${straight.toFixed(0)} m straight`);
  const names = new Set(r.edges.map((ee) => W.edgeName(ee >> 1)));
  assert.ok(names.has('8th Avenue') || names.has('7th Avenue'), [...names].join(', '));
});

test('every landmark stop resolves to a real corner', () => {
  for (const [a, b] of [['6th Avenue', 'West 34th Street'], ['5th Avenue', 'East 82nd Street'], ['Central Park West', 'West 81st Street'], ['Wall Street', 'William Street'], ['Canal Street', 'Mott Street'], ['West 125th Street', 'Frederick Douglass Boulevard']]) at(a, b);
});

test('businesses near Penn Station include real ones', () => {
  const c = at('8th Avenue', 'West 34th Street');
  const names = [];
  W.bizNear(c.x, c.z, 120, (i) => names.push(W.biz.n[i]));
  assert.ok(names.length > 10);
  assert.ok(names.some((n) => /Tick Tock|Starbucks|Duane Reade|CVS/.test(n)), names.slice(0, 10).join(', '));
});
