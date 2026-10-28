import * as THREE from 'three';
import { project, signedArea, centroid, hash, pointInPolygon, segIntersect, mulberry32 } from '../geo.js';
import { SegmentGrid } from './collision.js';
import { CAR_TYPES } from './roadgraph.js';
import {
  makeFacadeAtlas,
  makeFacadeMaterial,
  makeStoneTexture,
  makeRoofTexture,
  makeCobbleTexture,
  makeSlabTexture,
  makeAsphaltTexture,
  makeGrassTexture,
  makeBrickTexture,
} from './textures.js';

const FLOOR_H = 3.1;
const CELL_W = 3; // ancho de una ventana en el atlas (m)
const CHUNK = 200;

// Colores de fachada del Casco Viejo: ocres, cremas, almagres, azulados...
const FACADES = [
  '#f2dfb8', '#e9bf7f', '#e0a072', '#f5d58f', '#fbf5e8', '#d9bd98',
  '#c9dbe2', '#e8b29a', '#d8e2bb', '#cf8a60', '#f0cdb0', '#e8dc9e',
  '#b9cfd8', '#f3e7cf', '#d9a089', '#e6c9a0',
].map((c) => new THREE.Color(c));
const ROOF_TINTS = [1, 0.92, 1.06, 0.86, 0.97, 1.1].map((k) => new THREE.Color(k, k * 0.97, k * 0.95));
const STONE = new THREE.Color('#ffffff');
const STONE_WARM = new THREE.Color('#f0e2c8');
const WOOD = new THREE.Color('#6a4329');
const WOOD_DARK = new THREE.Color('#3e2618');
const WHITE = new THREE.Color('#ffffff');

// Calles del Casco Viejo: se ensanchan apartando las fachadas hasta esta media
// anchura para que quepan bien los coches (Estafeta, Mayor, Navarrería...).
const WIDEN = { living_street: 3.4, pedestrian: 3.4, residential: 3.6, service: 3.0, unclassified: 3.4 };

export const STREET_STYLE = {
  primary: { w: 10, c: '#ffffff', y: 0.09, mat: 'asphalt' },
  secondary: { w: 10, c: '#ffffff', y: 0.09, mat: 'asphalt' },
  secondary_link: { w: 7, c: '#ffffff', y: 0.09, mat: 'asphalt' },
  tertiary: { w: 8.5, c: '#ffffff', y: 0.09, mat: 'asphalt' },
  tertiary_link: { w: 7, c: '#ffffff', y: 0.09, mat: 'asphalt' },
  unclassified: { w: 6.8, c: '#ffffff', y: 0.09, mat: 'asphalt' },
  residential: { w: 7.2, c: '#ffffff', y: 0.09, mat: 'asphalt' },
  busway: { w: 7, c: '#d9c9c9', y: 0.09, mat: 'asphalt' },
  service: { w: 5, c: '#ececec', y: 0.085, mat: 'asphalt' },
  living_street: { w: 6.8, c: '#ffffff', y: 0.08, mat: 'cobble' },
  pedestrian: { w: 6.8, c: '#f4efe6', y: 0.08, mat: 'cobble' },
  footway: { w: 2.8, c: '#efe6d6', y: 0.07, mat: 'cobble' },
  path: { w: 2.4, c: '#d9c59e', y: 0.07, mat: 'cobble' },
  steps: { w: 2.8, c: '#e6e0d6', y: 0.07, mat: 'cobble' },
  cycleway: { w: 2.2, c: '#c9776a', y: 0.075, mat: 'asphalt' },
};

// ---------------------------------------------------------------------------
class GeoBuilder {
  constructor({ uv = false, variant = false } = {}) {
    this.pos = [];
    this.nor = [];
    this.col = [];
    this.uv = uv ? [] : null;
    this.variant = variant ? [] : null;
  }
  // color: THREE.Color; ao: [a0, a1, a2] (canal alfa)
  tri(a, b, c, n, color, uvs, ao, variant = 0) {
    this.pos.push(...a, ...b, ...c);
    for (let i = 0; i < 3; i++) {
      this.nor.push(n[0], n[1], n[2]);
      this.col.push(color.r, color.g, color.b, ao ? ao[i] : 1);
    }
    if (this.uv) this.uv.push(...(uvs || [0, 0, 0, 0, 0, 0]));
    if (this.variant) this.variant.push(variant, variant, variant);
  }
  // triángulo con normal calculada y orientado hacia `hint` (normal aproximada)
  triAuto(a, b, c, color, uvs, hint) {
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    if (nx * hint[0] + ny * hint[1] + nz * hint[2] < 0) {
      this.tri(a, c, b, [-nx, -ny, -nz], color, uvs ? [uvs[0], uvs[1], uvs[4], uvs[5], uvs[2], uvs[3]] : null);
    } else this.tri(a, b, c, [nx, ny, nz], color, uvs);
  }
  get empty() {
    return this.pos.length === 0;
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 4));
    if (this.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (this.variant) g.setAttribute('aVariant', new THREE.Float32BufferAttribute(this.variant, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

// Pared vertical de p a q (polígono CCW → normal hacia fuera).
// mode 'facade': UV en celdas de ventana enteras; 'stone': UV métricas.
function addWall(b, p, q, y0, y1, color, mode = 'stone', variant = 0, aoBottom = 1, aoTop = 1, uvScale = 2.4) {
  const dx = q[0] - p[0];
  const dz = q[1] - p[1];
  const len = Math.hypot(dx, dz);
  if (len < 0.05 || y1 <= y0) return;
  const n = [dz / len, 0, -dx / len];
  const p0 = [p[0], y0, p[1]];
  const p1 = [q[0], y0, q[1]];
  const p2 = [q[0], y1, q[1]];
  const p3 = [p[0], y1, p[1]];
  let u0;
  let u1;
  let v0;
  let v1;
  if (mode === 'facade') {
    // visto desde fuera, p queda a la derecha: u decrece de p a q
    u0 = Math.max(1, Math.round(len / CELL_W));
    u1 = 0;
    v0 = y0 / FLOOR_H;
    v1 = y1 / FLOOR_H;
  } else {
    u0 = 0;
    u1 = len / uvScale;
    v0 = y0 / uvScale;
    v1 = y1 / uvScale;
  }
  const aoB = aoBottom;
  const aoT = aoTop;
  b.tri(p1, p0, p3, n, color, [u1, v0, u0, v0, u0, v1], [aoB, aoB, aoT], variant);
  b.tri(p1, p3, p2, n, color, [u1, v0, u0, v1, u1, v1], [aoB, aoT, aoT], variant);
}

// Polígono horizontal (tapa) a altura y, con normal ±y y UV del mundo.
function addCap(b, pts, y, color, dir = 1, uvScale = 2) {
  const contour = pts.map((p) => new THREE.Vector2(p[0], p[1]));
  let tris;
  try {
    tris = THREE.ShapeUtils.triangulateShape(contour, []);
  } catch {
    return;
  }
  const up = [0, dir, 0];
  const uv = (p) => [p[0] / uvScale, -p[1] / uvScale];
  for (const t of tris) {
    const a = pts[t[0]];
    const c1 = pts[t[1]];
    const c2 = pts[t[2]];
    const cy = (c1[1] - a[1]) * (c2[0] - a[0]) - (c1[0] - a[0]) * (c2[1] - a[1]);
    const [A, B, C] = cy * dir >= 0 ? [a, c1, c2] : [a, c2, c1];
    b.tri([A[0], y, A[1]], [B[0], y, B[1]], [C[0], y, C[1]], up, color, [...uv(A), ...uv(B), ...uv(C)]);
  }
}

// Desplaza el anillo hacia fuera `e` metros (inglete limitado).
function offsetRing(pts, e) {
  const n = pts.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const a = pts[(i - 1 + n) % n];
    const c = pts[(i + 1) % n];
    let l1 = Math.hypot(p[0] - a[0], p[1] - a[1]) || 1;
    let l2 = Math.hypot(c[0] - p[0], c[1] - p[1]) || 1;
    const n1 = [(p[1] - a[1]) / l1, -(p[0] - a[0]) / l1];
    const n2 = [(c[1] - p[1]) / l2, -(c[0] - p[0]) / l2];
    let mx = n1[0] + n2[0];
    let mz = n1[1] + n2[1];
    const ml = Math.hypot(mx, mz) || 1;
    mx /= ml;
    mz /= ml;
    const k = Math.min(e * 2.5, e / Math.max(0.35, mx * n1[0] + mz * n1[1]));
    out.push([p[0] + mx * k, p[1] + mz * k]);
  }
  return out;
}

// Tejado de teja a cuatro aguas aproximado + alero de madera.
function addRoof(roofB, woodB, pts, h, tint, area, steep = false) {
  const perim = pts.reduce((s, p, i) => s + Math.hypot(pts[(i + 1) % pts.length][0] - p[0], pts[(i + 1) % pts.length][1] - p[1]), 0);
  const width = (2 * area) / Math.max(perim, 1); // ≈ media anchura
  const eave = 0.55;
  const outer = offsetRing(pts, eave);
  const [cx, cz] = centroid(pts);
  const k = 0.18;
  const inner = pts.map((p) => [cx + (p[0] - cx) * k, cz + (p[1] - cz) * k]);
  const rh = steep ? Math.min(9, Math.max(3, width * 0.9)) : Math.min(3.8, Math.max(1.3, width * 0.62));
  const n = pts.length;
  // faldones
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const o0 = outer[i];
    const o1 = outer[j];
    const i0 = inner[i];
    const i1 = inner[j];
    const ex = o1[0] - o0[0];
    const ez = o1[1] - o0[1];
    const el = Math.hypot(ex, ez) || 1;
    const dx = ex / el;
    const dz = ez / el;
    const nx = dz;
    const nz = -dx;
    const proj = (p) => (p[0] - o0[0]) * dx + (p[1] - o0[1]) * dz;
    const depth = (p) => -((p[0] - o0[0]) * nx + (p[1] - o0[1]) * nz);
    const slope = Math.hypot(rh, Math.max(depth(i0), 0.1)) / Math.max(depth(i0), 0.1);
    const uv = (p) => [proj(p) / 2, (depth(p) * slope) / 2];
    const A = [o0[0], h, o0[1]];
    const B = [o1[0], h, o1[1]];
    const C = [i1[0], h + rh, i1[1]];
    const D = [i0[0], h + rh, i0[1]];
    const hint = [nx, 1, nz];
    roofB.triAuto(A, B, C, tint, [...uv(o0), ...uv(o1), ...uv(i1)], hint);
    roofB.triAuto(A, C, D, tint, [...uv(o0), ...uv(i1), ...uv(i0)], hint);
    // canto del alero (madera)
    woodB.triAuto([o0[0], h - 0.28, o0[1]], [o1[0], h - 0.28, o1[1]], B, WOOD, null, [nx, 0, nz]);
    woodB.triAuto([o0[0], h - 0.28, o0[1]], B, A, WOOD, null, [nx, 0, nz]);
    // parte inferior del alero
    const p0 = pts[i];
    const p1 = pts[j];
    const hb = h - 0.28;
    woodB.triAuto([p0[0], hb, p0[1]], [o1[0], hb, o1[1]], [o0[0], hb, o0[1]], WOOD_DARK, null, [0, -1, 0]);
    woodB.triAuto([p0[0], hb, p0[1]], [p1[0], hb, p1[1]], [o1[0], hb, o1[1]], WOOD_DARK, null, [0, -1, 0]);
  }
  addCap(roofB, inner, h + rh, tint, 1, 2);
}

function cleanRing(lonlats) {
  const pts = lonlats.map(project);
  if (pts.length > 1) {
    const f = pts[0];
    const l = pts[pts.length - 1];
    if (Math.abs(f[0] - l[0]) < 1e-6 && Math.abs(f[1] - l[1]) < 1e-6) pts.pop();
  }
  const out = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.05) out.push(p);
  }
  if (out.length > 2 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) < 0.05) out.pop();
  if (signedArea(out) < 0) out.reverse();
  return out;
}

// Clasificación de edificios singulares por nombre.
function classify(b) {
  const n = (b.name || '').toLowerCase();
  if (/kiosco|kiosko/.test(n)) return 'kiosk';
  if (/catedral/.test(n) && !/archivo|librer/.test(n)) return 'cathedral';
  if (/san saturnino/.test(n)) return 'saturnino';
  if (/iglesia de san nicol/.test(n)) return 'nicolas';
  if (/^ayuntamiento/.test(n)) return 'townhall';
  if (/plaza de toros/.test(n)) return 'bullring';
  if (/^portal /.test(n)) return 'portal';
  if (n === 'baluarte') return 'auditorium';
  if (/monumento a los fueros/.test(n)) return 'monument';
  if (/^baluarte |^revell[ií]n|^mirador/.test(n)) return 'bastion';
  if (/palacio de navarra/.test(n)) return 'palace';
  if (/iglesia|parroquia|convento|capilla|ermita/.test(n) || ['church', 'cathedral', 'chapel'].includes(b.kind)) return 'church';
  return 'house';
}

// ---------------------------------------------------------------------------
// Ensanche de calles: aparta los vértices de las fachadas que invaden la calle.
function buildStreetIndex(streets) {
  const g = new SegmentGrid(10);
  for (const s of streets) {
    const hw = WIDEN[s.type];
    if (!hw) continue;
    for (let i = 1; i < s.pts.length; i++) g.add(s.pts[i - 1][0], s.pts[i - 1][1], s.pts[i][0], s.pts[i][1], hw, 1);
  }
  return g;
}

function pushFromStreets(pts, sg) {
  const [cx, cz] = centroid(pts);
  return pts.map((p0) => {
    const p = [p0[0], p0[1]];
    for (let iter = 0; iter < 3; iter++) {
      let worst = 0;
      let px = 0;
      let pz = 0;
      sg.forEachIn(p[0] - 6, p[1] - 6, p[0] + 6, p[1] + 6, (id) => {
        const ax = sg.ax[id];
        const az = sg.az[id];
        const dx = sg.bx[id] - ax;
        const dz = sg.bz[id] - az;
        const l2 = dx * dx + dz * dz || 1e-9;
        let t = ((p[0] - ax) * dx + (p[1] - az) * dz) / l2;
        t = Math.max(0, Math.min(1, t));
        const qx = ax + dx * t;
        const qz = az + dz * t;
        let ex = p[0] - qx;
        let ez = p[1] - qz;
        let d = Math.hypot(ex, ez);
        const need = sg.pad[id] - d;
        if (need > worst) {
          if (d < 0.05) {
            // vértice sobre el eje: hacia el lado del centro del edificio
            const l = Math.sqrt(l2);
            ex = -dz / l;
            ez = dx / l;
            if ((cx - qx) * ex + (cz - qz) * ez < 0) {
              ex = -ex;
              ez = -ez;
            }
            d = 1;
          }
          worst = need;
          px = (ex / d) * need;
          pz = (ez / d) * need;
        }
      });
      if (worst <= 0.01) break;
      p[0] += px;
      p[1] += pz;
    }
    return p;
  });
}

// ---------------------------------------------------------------------------
export function buildCity(scene, data) {
  const grid = new SegmentGrid(8);
  const rng = mulberry32(1234);

  const atlas = makeFacadeAtlas();
  const stoneTex = makeStoneTexture();
  const roofTex = makeRoofTexture();
  const facadeMat = makeFacadeMaterial(atlas);
  const stoneMat = new THREE.MeshLambertMaterial({ map: stoneTex, vertexColors: true });
  const roofMat = new THREE.MeshLambertMaterial({ map: roofTex, vertexColors: true });
  const woodMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const plainMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const brickMat = new THREE.MeshLambertMaterial({ map: makeBrickTexture(), vertexColors: true });

  const chunks = new Map();
  const getChunk = (x, z) => {
    const k = Math.floor(x / CHUNK) + ',' + Math.floor(z / CHUNK);
    let c = chunks.get(k);
    if (!c) {
      chunks.set(
        k,
        (c = {
          facade: new GeoBuilder({ uv: true, variant: true }),
          stone: new GeoBuilder({ uv: true }),
          roof: new GeoBuilder({ uv: true }),
          wood: new GeoBuilder(),
        }),
      );
    }
    return c;
  };

  const streets = [];
  for (const s of data.streets) {
    if (!STREET_STYLE[s.type]) continue;
    streets.push({ name: s.name, type: s.type, pts: s.pts.map(project) });
  }
  const streetIndex = buildStreetIndex(streets);
  // vértices interiores de calles con coche: si un edificio los contiene, sobra
  const streetNodes = [];
  for (const s of streets) {
    if (!WIDEN[s.type]) continue;
    for (let i = 1; i < s.pts.length - 1; i++) streetNodes.push(s.pts[i]);
  }
  const nodeGrid = new Map();
  for (const p of streetNodes) {
    const k = Math.floor(p[0] / 20) + ',' + Math.floor(p[1] / 20);
    if (!nodeGrid.has(k)) nodeGrid.set(k, []);
    nodeGrid.get(k).push(p);
  }
  const containsStreetNode = (pts) => {
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (const p of pts) {
      x0 = Math.min(x0, p[0]);
      x1 = Math.max(x1, p[0]);
      z0 = Math.min(z0, p[1]);
      z1 = Math.max(z1, p[1]);
    }
    for (let i = Math.floor(x0 / 20); i <= Math.floor(x1 / 20); i++) {
      for (let j = Math.floor(z0 / 20); j <= Math.floor(z1 / 20); j++) {
        for (const p of nodeGrid.get(i + ',' + j) || []) if (pointInPolygon(p[0], p[1], pts)) return true;
      }
    }
    return false;
  };

  // plazas (se usan también para rebajar construcciones pequeñas dentro de ellas)
  const squares = [];
  for (const sq of data.squares) {
    const pts = cleanRing(sq.pts);
    if (pts.length < 3) continue;
    const [qx, qz] = centroid(pts);
    squares.push({ pts, name: sq.name, cx: qx, cz: qz });
  }
  const inSquare = (x, z) => squares.some((q) => pointInPolygon(x, z, q.pts));

  const special = [];
  const footprints = [];
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  for (const b of data.buildings) {
    if (['roof', 'canopy', 'carport', 'bridge', 'ruins', 'construction', 'collapsed'].includes(b.kind)) continue;
    const raw = cleanRing(b.pts);
    if (raw.length < 3) continue;
    const rawArea = signedArea(raw);
    if (rawArea < 8) continue;
    const kind = classify(b);
    let pts = raw;
    if (kind === 'house' || kind === 'church') {
      pts = pushFromStreets(raw, streetIndex);
      const a = signedArea(pts);
      if (a < Math.max(10, rawArea * 0.35)) continue; // estaba en mitad de la calle
      if (containsStreetNode(pts)) continue;
    }
    const area = signedArea(pts);
    const [cx, cz] = centroid(pts);
    minX = Math.min(minX, cx);
    maxX = Math.max(maxX, cx);
    minZ = Math.min(minZ, cz);
    maxZ = Math.max(maxZ, cz);
    const r = hash(b.id);
    if (kind === 'kiosk' || kind === 'monument') {
      special.push({ kind, name: b.name, pts, cx, cz, area });
      continue;
    }

    let levels = b.levels ?? (r < 0.2 ? 3 : r < 0.65 ? 4 : 5);
    levels = Math.min(5, Math.max(3, levels));
    const small =
      ['garage', 'garages', 'shed', 'kiosk', 'hut', 'service', 'toilets'].includes(b.kind) ||
      area < 25 ||
      /parking|aseo|taquilla|entrada/i.test(b.name || '') ||
      (area < 300 && inSquare(cx, cz));
    if (small) levels = 1;
    let h = levels * FLOOR_H + 0.45;
    let color = FACADES[Math.floor(hash(b.id + 3) * FACADES.length)];
    const roofTint = ROOF_TINTS[Math.floor(hash(b.id + 11) * ROOF_TINTS.length)];
    let mode = 'facade';
    let roof = area > 3500 ? 'flat' : 'hip';
    let y0 = 0;
    let solid = true;
    let stoneColor = STONE;

    switch (kind) {
      case 'cathedral':
        h = 17;
        mode = 'stone';
        stoneColor = STONE_WARM;
        roof = 'hip';
        break;
      case 'church':
      case 'saturnino':
      case 'nicolas':
        h = area > 600 ? 16 : 12;
        mode = 'stone';
        stoneColor = kind === 'saturnino' ? new THREE.Color('#e6c2a6') : STONE_WARM;
        roof = 'hip';
        break;
      case 'townhall':
        h = 17.5;
        color = new THREE.Color('#efd9a6');
        break;
      case 'palace':
        h = 16;
        color = new THREE.Color('#e9dcc0');
        roof = 'flat';
        break;
      case 'bullring':
        h = 12;
        color = new THREE.Color('#e7a26e');
        roof = 'bullring';
        break;
      case 'bastion':
        h = 6;
        mode = 'stone';
        roof = 'grass';
        break;
      case 'portal':
        y0 = 4.6;
        h = 9.5;
        mode = 'stone';
        roof = 'flatstone';
        solid = false;
        break;
      case 'auditorium':
        h = 16;
        mode = 'stone';
        stoneColor = new THREE.Color('#77736c');
        roof = 'flatstone';
        break;
      default:
        break;
    }
    if (small) roof = 'flat';
    if (kind !== 'house') special.push({ kind, name: b.name, pts, cx, cz, area, h });

    const ch = getChunk(cx, cz);
    // variante de fachada (planta alta + 4 × planta baja); el Ayuntamiento y los
    // palacios llevan balcones de forja
    const upperVar = kind === 'townhall' || kind === 'palace' || kind === 'bullring' ? 0 : Math.floor(hash(b.id + 5) * 4);
    const groundVar = kind === 'bullring' ? 1 : Math.floor(hash(b.id + 9) * 4);
    const variant = upperVar + groundVar * 4;
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const p = pts[i];
      const q = pts[(i + 1) % n];
      if (mode === 'facade') {
        const gH = Math.min(FLOOR_H, h);
        addWall(ch.facade, p, q, y0, gH, color, 'facade', variant, 0.62, 0.95);
        addWall(ch.facade, p, q, gH, h, color, 'facade', variant, 0.95, 1.04);
      } else {
        // zócalo algo más oscuro (suciedad / oclusión junto al suelo)
        const dark = stoneColor.clone().multiplyScalar(0.78);
        const yb = y0 > 0 ? y0 : Math.min(h, 1.2);
        if (y0 === 0) addWall(ch.stone, p, q, 0, yb, dark, 'stone');
        addWall(ch.stone, p, q, yb, h, stoneColor, 'stone');
      }
    }
    switch (roof) {
      case 'hip':
        addRoof(ch.roof, ch.wood, pts, h, mode === 'stone' ? new THREE.Color('#c9a593') : roofTint, area, mode === 'stone');
        break;
      case 'bullring': {
        // anillo de tejado + gradas interiores + ruedo de arena
        const [bx, bz] = [cx, cz];
        const inner = pts.map((p) => [bx + (p[0] - bx) * 0.7, bz + (p[1] - bz) * 0.7]);
        for (let i = 0; i < n; i++) {
          const j = (i + 1) % n;
          addWall(ch.facade, inner[j], inner[i], 0, h - 1, color, 'facade', 4, 0.7, 1);
          const A = [pts[i][0], h, pts[i][1]];
          const B = [pts[j][0], h, pts[j][1]];
          const C = [inner[j][0], h - 1, inner[j][1]];
          const D = [inner[i][0], h - 1, inner[i][1]];
          ch.roof.triAuto(A, B, C, roofTint, [0, 0, 2, 0, 2, 1], [0, 1, 0]);
          ch.roof.triAuto(A, C, D, roofTint, [0, 0, 2, 1, 0, 1], [0, 1, 0]);
        }
        addCap(ch.stone, inner, 0.12, new THREE.Color('#e8c98a'), 1, 6);
        break;
      }
      case 'grass':
        addCap(ch.stone, pts, h, new THREE.Color('#9fbf6a'), 1, 8);
        break;
      case 'flatstone':
        addCap(ch.stone, pts, h, stoneColor.clone().multiplyScalar(0.85), 1, 2.4);
        break;
      default:
        addCap(ch.stone, pts, h, new THREE.Color('#a29a8e'), 1, 2.4);
        // pretil
        for (let i = 0; i < n; i++) addWall(ch.stone, pts[i], pts[(i + 1) % n], h, h + 0.7, new THREE.Color('#d8cdb8'), 'stone');
    }
    if (y0 > 0) addCap(ch.stone, [...pts].reverse(), y0, STONE.clone().multiplyScalar(0.7), -1, 2.4);
    if (solid) grid.addPolygon(pts, 0, 1);
    footprints.push({ pts, cx, cz, h, kind, name: b.name });
  }

  const cityGroup = new THREE.Group();
  cityGroup.name = 'ciudad';
  const add = (builder, mat) => {
    if (builder.empty) return;
    const m = new THREE.Mesh(builder.build(), mat);
    m.castShadow = true;
    m.receiveShadow = true;
    cityGroup.add(m);
  };
  for (const c of chunks.values()) {
    add(c.facade, facadeMat);
    add(c.stone, stoneMat);
    add(c.roof, roofMat);
    add(c.wood, woodMat);
  }
  scene.add(cityGroup);

  // ---- Suelo, calles, plazas y parques ----
  const slabTex = makeSlabTexture('#c9bea8');
  const groundTex = slabTex.clone();
  groundTex.repeat.set(4000 / 3, 4000 / 3);
  groundTex.needsUpdate = true;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshLambertMaterial({ map: groundTex, color: '#b8ae9a' }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const flats = {
    grass: new GeoBuilder({ uv: true }),
    slab: new GeoBuilder({ uv: true }),
    cobble: new GeoBuilder({ uv: true }),
    asphalt: new GeoBuilder({ uv: true }),
  };
  const parks = [];
  for (const p of data.parks) {
    const pts = cleanRing(p.pts);
    if (pts.length < 3) continue;
    addCap(flats.grass, pts, 0.03, WHITE, 1, 4);
    parks.push({ pts, name: p.name });
  }
  for (const sq of squares) addCap(flats.slab, sq.pts, 0.05, WHITE, 1, 3);
  const carSegs = [];
  for (const s of streets) {
    const st = STREET_STYLE[s.type];
    addRibbon(flats[st.mat], s.pts, st.w, st.y, new THREE.Color(st.c), st.mat === 'cobble' ? 2 : 4);
    if (CAR_TYPES.has(s.type)) for (let i = 1; i < s.pts.length; i++) carSegs.push([s.pts[i - 1], s.pts[i]]);
  }
  const flatMats = {
    grass: new THREE.MeshLambertMaterial({ map: makeGrassTexture(), vertexColors: true }),
    slab: new THREE.MeshLambertMaterial({ map: slabTex, vertexColors: true }),
    cobble: new THREE.MeshLambertMaterial({ map: makeCobbleTexture(), vertexColors: true }),
    asphalt: new THREE.MeshLambertMaterial({ map: makeAsphaltTexture(), vertexColors: true }),
  };
  for (const [k, b] of Object.entries(flats)) {
    if (b.empty) continue;
    const m = new THREE.Mesh(b.build(), flatMats[k]);
    m.receiveShadow = true;
    scene.add(m);
  }

  // ---- Murallas ----
  const wallB = new GeoBuilder({ uv: true });
  const wallsOut = [];
  for (const w of data.walls) {
    const pts = w.pts.map(project);
    const line = [];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      let blocked = false;
      for (const sgm of carSegs) {
        if (segIntersect(a[0], a[1], b[0], b[1], sgm[0][0], sgm[0][1], sgm[1][0], sgm[1][1]) >= 0) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;
      addBox(wallB, a, b, 2.8, 0, 8, STONE_WARM);
      grid.add(a[0], a[1], b[0], b[1], 1.4, 2);
      line.push([a, b]);
    }
    wallsOut.push(line);
  }
  if (!wallB.empty) {
    const m = new THREE.Mesh(wallB.build(), stoneMat);
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
  }

  return {
    grid,
    streets,
    parks,
    squares,
    footprints,
    special,
    walls: wallsOut,
    bounds: { minX, maxX, minZ, maxZ },
    rng,
    materials: { plainMat, stoneMat, brickMat, roofMat, facadeMat },
  };
}

// Cinta plana para una calle (tramos + discos en las uniones), UV del mundo.
function addRibbon(b, pts, w, y, color, uvScale) {
  const hw = w / 2;
  const up = [0, 1, 0];
  const tri = (A, B, C) => {
    const cy = (B[2] - A[2]) * (C[0] - A[0]) - (B[0] - A[0]) * (C[2] - A[2]);
    const [p, q, r] = cy >= 0 ? [A, B, C] : [A, C, B];
    b.tri(p, q, r, up, color, [p[0] / uvScale, -p[2] / uvScale, q[0] / uvScale, -q[2] / uvScale, r[0] / uvScale, -r[2] / uvScale]);
  };
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const c = pts[i];
    const dx = c[0] - a[0];
    const dz = c[1] - a[1];
    const len = Math.hypot(dx, dz);
    if (len < 0.01) continue;
    const nx = (-dz / len) * hw;
    const nz = (dx / len) * hw;
    const p0 = [a[0] + nx, y, a[1] + nz];
    const p1 = [a[0] - nx, y, a[1] - nz];
    const p2 = [c[0] - nx, y, c[1] - nz];
    const p3 = [c[0] + nx, y, c[1] + nz];
    tri(p0, p1, p2);
    tri(p0, p2, p3);
  }
  if (w < 4) return;
  const seg = 8;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (i > 0 && i < pts.length - 1) {
      const a = pts[i - 1];
      const c = pts[i + 1];
      const a1 = Math.atan2(p[1] - a[1], p[0] - a[0]);
      const a2 = Math.atan2(c[1] - p[1], c[0] - p[0]);
      let da = Math.abs(a2 - a1);
      if (da > Math.PI) da = Math.PI * 2 - da;
      if (da < 0.15) continue;
    }
    for (let k = 0; k < seg; k++) {
      const a0 = (k / seg) * Math.PI * 2;
      const a1 = ((k + 1) / seg) * Math.PI * 2;
      tri([p[0], y, p[1]], [p[0] + Math.cos(a1) * hw, y, p[1] + Math.sin(a1) * hw], [p[0] + Math.cos(a0) * hw, y, p[1] + Math.sin(a0) * hw]);
    }
  }
}

// Caja alargada entre a y b (murallas), con sillería.
export function addBox(b, a, c, thick, y0, y1, color) {
  const dx = c[0] - a[0];
  const dz = c[1] - a[1];
  const len = Math.hypot(dx, dz);
  if (len < 0.1) return;
  const nx = (-dz / len) * (thick / 2);
  const nz = (dx / len) * (thick / 2);
  const ex = (dx / len) * (thick / 2);
  const ez = (dz / len) * (thick / 2);
  const ring = [
    [a[0] - ex + nx, a[1] - ez + nz],
    [a[0] - ex - nx, a[1] - ez - nz],
    [c[0] + ex - nx, c[1] + ez - nz],
    [c[0] + ex + nx, c[1] + ez + nz],
  ];
  if (signedArea(ring) < 0) ring.reverse();
  for (let i = 0; i < 4; i++) addWall(b, ring[i], ring[(i + 1) % 4], y0, y1, color, 'stone');
  addCap(b, ring, y1, color.clone().multiplyScalar(0.85), 1, 2.4);
}

export { GeoBuilder, addWall, addCap, cleanRing, pointInPolygon, FLOOR_H };
