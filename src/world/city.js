import * as THREE from 'three';
import { project, signedArea, centroid, hash, pointInPolygon, segIntersect, mulberry32 } from '../geo.js';
import { SegmentGrid } from './collision.js';
import { CAR_TYPES } from './roadgraph.js';

const FLOOR_H = 3.1;
const CHUNK = 200;

const FACADES = [
  '#f3e5c8', '#ecc890', '#e7ab83', '#f6dca3', '#fbf7ee', '#dcc5a8',
  '#cfdde3', '#ebbca2', '#dce6c4', '#d39a72', '#f1d2b8', '#e9e1b0',
].map((c) => new THREE.Color(c));
const ROOFS = ['#b5563b', '#a24a33', '#c0664a', '#9b5a43', '#b86f4d'].map((c) => new THREE.Color(c));
const STONE = new THREE.Color('#c8b48e');
const STONE_DARK = new THREE.Color('#a8956f');

export const STREET_STYLE = {
  primary: { w: 10, c: '#5b5d64', y: 0.09 },
  secondary: { w: 10, c: '#5b5d64', y: 0.09 },
  secondary_link: { w: 7, c: '#5b5d64', y: 0.09 },
  tertiary: { w: 8.5, c: '#5f6168', y: 0.09 },
  tertiary_link: { w: 7, c: '#5f6168', y: 0.09 },
  unclassified: { w: 7, c: '#64666c', y: 0.09 },
  residential: { w: 7, c: '#64666c', y: 0.09 },
  busway: { w: 7, c: '#6b5f63', y: 0.09 },
  service: { w: 4.5, c: '#77767a', y: 0.085 },
  living_street: { w: 6, c: '#b9a487', y: 0.08 },
  pedestrian: { w: 6, c: '#bfab8d', y: 0.08 },
  footway: { w: 2.6, c: '#d2c3a7', y: 0.07 },
  path: { w: 2.4, c: '#c9b48c', y: 0.07 },
  steps: { w: 2.6, c: '#ab9e8a', y: 0.07 },
  cycleway: { w: 2.2, c: '#b5715f', y: 0.075 },
};

// Textura de fachada: una celda = una ventana con contraventanas y balcón.
function makeFacadeTexture() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 64, 64);
  // zócalo / línea de forjado
  g.fillStyle = '#e4e0d8';
  g.fillRect(0, 60, 64, 4);
  // contraventanas
  g.fillStyle = '#6f8f5a';
  g.fillRect(14, 14, 8, 34);
  g.fillRect(42, 14, 8, 34);
  // ventana
  g.fillStyle = '#3d4f63';
  g.fillRect(22, 14, 20, 34);
  g.fillStyle = '#6f8aa5';
  g.fillRect(24, 16, 7, 14);
  g.fillStyle = '#f7f3e8';
  g.fillRect(31, 14, 2, 34);
  // balcón de forja
  g.fillStyle = '#2b2b2b';
  g.fillRect(18, 44, 28, 2);
  for (let x = 19; x < 46; x += 4) g.fillRect(x, 44, 1, 8);
  g.fillRect(18, 51, 28, 2);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

class GeoBuilder {
  constructor(uv = false) {
    this.pos = [];
    this.nor = [];
    this.col = [];
    this.uv = uv ? [] : null;
  }
  tri(a, b, c, n, color, uvs) {
    this.pos.push(...a, ...b, ...c);
    for (let i = 0; i < 3; i++) {
      this.nor.push(n[0], n[1], n[2]);
      this.col.push(color.r, color.g, color.b);
    }
    if (this.uv) this.uv.push(...(uvs || [0, 0, 0, 0, 0, 0]));
  }
  get empty() {
    return this.pos.length === 0;
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    if (this.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

// Pared vertical de p a q (polígono CCW → normal hacia fuera).
function addWall(b, p, q, y0, y1, color, uOffset, withUV) {
  const dx = q[0] - p[0];
  const dz = q[1] - p[1];
  const len = Math.hypot(dx, dz);
  if (len < 0.05) return 0;
  const n = [dz / len, 0, -dx / len];
  const p0 = [p[0], y0, p[1]];
  const p1 = [q[0], y0, q[1]];
  const p2 = [q[0], y1, q[1]];
  const p3 = [p[0], y1, p[1]];
  if (withUV) {
    const u0 = uOffset / 3;
    const u1 = (uOffset + len) / 3;
    const v0 = y0 / FLOOR_H;
    const v1 = y1 / FLOOR_H;
    b.tri(p1, p0, p3, n, color, [u1, v0, u0, v0, u0, v1]);
    b.tri(p1, p3, p2, n, color, [u1, v0, u0, v1, u1, v1]);
  } else {
    b.tri(p1, p0, p3, n, color);
    b.tri(p1, p3, p2, n, color);
  }
  return len;
}

// Polígono horizontal (tapa) a altura y, con normal +y.
function addCap(b, pts, y, color, dir = 1) {
  const contour = pts.map((p) => new THREE.Vector2(p[0], p[1]));
  let tris;
  try {
    tris = THREE.ShapeUtils.triangulateShape(contour, []);
  } catch {
    return;
  }
  const up = [0, dir, 0];
  for (const t of tris) {
    const a = pts[t[0]];
    const c1 = pts[t[1]];
    const c2 = pts[t[2]];
    // y del producto vectorial: debe ser > 0
    const cy = (c1[1] - a[1]) * (c2[0] - a[0]) - (c1[0] - a[0]) * (c2[1] - a[1]);
    if (cy * dir >= 0) b.tri([a[0], y, a[1]], [c1[0], y, c1[1]], [c2[0], y, c2[1]], up, color);
    else b.tri([a[0], y, a[1]], [c2[0], y, c2[1]], [c1[0], y, c1[1]], up, color);
  }
}

function cleanRing(lonlats) {
  const pts = lonlats.map(project);
  if (pts.length > 1) {
    const f = pts[0];
    const l = pts[pts.length - 1];
    if (Math.abs(f[0] - l[0]) < 1e-6 && Math.abs(f[1] - l[1]) < 1e-6) pts.pop();
  }
  // quita vértices duplicados
  const out = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.05) out.push(p);
  }
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
  if (/^baluarte |^revell[ií]n|^mirador/.test(n)) return 'bastion';
  if (/iglesia|parroquia|convento|capilla|ermita/.test(n) || ['church', 'cathedral', 'chapel'].includes(b.kind)) return 'church';
  return 'house';
}

export function buildCity(scene, data) {
  const grid = new SegmentGrid(8);
  const rng = mulberry32(1234);
  const facadeTex = makeFacadeTexture();
  const wallMat = new THREE.MeshLambertMaterial({ map: facadeTex, vertexColors: true });
  const plainMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const chunks = new Map();
  const getChunk = (x, z) => {
    const k = Math.floor(x / CHUNK) + ',' + Math.floor(z / CHUNK);
    let c = chunks.get(k);
    if (!c) chunks.set(k, (c = { walls: new GeoBuilder(true), plain: new GeoBuilder(false) }));
    return c;
  };

  const special = []; // edificios singulares para hitos
  const footprints = [];
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  for (const b of data.buildings) {
    if (['roof', 'canopy', 'carport', 'bridge', 'ruins', 'construction', 'collapsed'].includes(b.kind)) continue;
    const pts = cleanRing(b.pts);
    if (pts.length < 3) continue;
    const area = signedArea(pts);
    if (area < 8) continue;
    const kind = classify(b);
    const [cx, cz] = centroid(pts);
    minX = Math.min(minX, cx);
    maxX = Math.max(maxX, cx);
    minZ = Math.min(minZ, cz);
    maxZ = Math.max(maxZ, cz);
    const r = hash(b.id);
    if (kind === 'kiosk') {
      special.push({ kind, name: b.name, pts, cx, cz, area });
      continue;
    }

    let levels = b.levels ?? (r < 0.25 ? 3 : r < 0.7 ? 4 : 5);
    levels = Math.min(5, Math.max(3, levels));
    if (['garage', 'garages', 'shed', 'kiosk', 'hut', 'service', 'toilets'].includes(b.kind) || area < 25) levels = 1;
    let h = levels * FLOOR_H + 0.6 + hash(b.id + 7) * 0.8;
    let color = FACADES[Math.floor(hash(b.id + 3) * FACADES.length)];
    let roof = ROOFS[Math.floor(hash(b.id + 11) * ROOFS.length)];
    let textured = true;
    let y0 = 0;
    let solid = true;

    switch (kind) {
      case 'cathedral':
        h = 15;
        color = STONE;
        textured = false;
        roof = STONE_DARK;
        break;
      case 'church':
      case 'saturnino':
      case 'nicolas':
        h = area > 600 ? 16 : 12;
        color = kind === 'saturnino' ? new THREE.Color('#b9876a') : STONE;
        textured = false;
        roof = STONE_DARK;
        break;
      case 'townhall':
        h = 17;
        color = new THREE.Color('#e9d6a9');
        break;
      case 'bullring':
        h = 13;
        color = new THREE.Color('#d98b5f');
        roof = new THREE.Color('#c96f45');
        break;
      case 'bastion':
        h = 5.5;
        color = STONE;
        roof = new THREE.Color('#8fa46a');
        textured = false;
        break;
      case 'portal':
        // Puertas de la muralla: arco elevado por el que se pasa por debajo
        y0 = 4.6;
        h = 9;
        color = STONE;
        roof = STONE_DARK;
        textured = false;
        solid = false;
        break;
      case 'auditorium':
        h = 16;
        color = new THREE.Color('#5a5650');
        roof = new THREE.Color('#47443f');
        textured = false;
        break;
      default:
        break;
    }
    if (kind !== 'house') special.push({ kind, name: b.name, pts, cx, cz, area, h });

    const ch = getChunk(cx, cz);
    const target = textured ? ch.walls : ch.plain;
    let u = 0;
    for (let i = 0; i < pts.length; i++) {
      u += addWall(target, pts[i], pts[(i + 1) % pts.length], y0, h, color, u, textured);
    }
    addCap(ch.plain, pts, h, roof);
    if (y0 > 0) addCap(ch.plain, [...pts].reverse(), y0, STONE_DARK, -1);
    if (solid) grid.addPolygon(pts, 0, 1);
    footprints.push({ pts, cx, cz, h, kind, name: b.name });
  }

  const cityGroup = new THREE.Group();
  cityGroup.name = 'ciudad';
  for (const c of chunks.values()) {
    if (!c.walls.empty) {
      const m = new THREE.Mesh(c.walls.build(), wallMat);
      m.castShadow = true;
      m.receiveShadow = true;
      cityGroup.add(m);
    }
    if (!c.plain.empty) {
      const m = new THREE.Mesh(c.plain.build(), plainMat);
      m.castShadow = true;
      m.receiveShadow = true;
      cityGroup.add(m);
    }
  }
  scene.add(cityGroup);

  // ---- Suelo, calles, plazas y parques ----
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(4000, 4000),
    new THREE.MeshLambertMaterial({ color: '#a9b48f' }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const flat = new GeoBuilder(false);
  const parks = [];
  for (const p of data.parks) {
    const pts = cleanRing(p.pts);
    if (pts.length < 3) continue;
    addCap(flat, pts, 0.03, new THREE.Color('#7fae5b'));
    parks.push({ pts, name: p.name });
  }
  const squares = [];
  for (const s of data.squares) {
    const pts = cleanRing(s.pts);
    if (pts.length < 3) continue;
    addCap(flat, pts, 0.05, new THREE.Color('#d6c6a5'));
    const [cx, cz] = centroid(pts);
    squares.push({ pts, name: s.name, cx, cz });
  }

  const streets = [];
  const carSegs = [];
  for (const s of data.streets) {
    const st = STREET_STYLE[s.type];
    if (!st) continue;
    const pts = s.pts.map(project);
    streets.push({ name: s.name, type: s.type, pts });
    addRibbon(flat, pts, st.w, st.y, new THREE.Color(st.c));
    if (CAR_TYPES.has(s.type)) {
      for (let i = 1; i < pts.length; i++) carSegs.push([pts[i - 1], pts[i]]);
    }
  }
  const flatMesh = new THREE.Mesh(flat.build(), new THREE.MeshLambertMaterial({ vertexColors: true }));
  flatMesh.receiveShadow = true;
  scene.add(flatMesh);

  // ---- Murallas ----
  const wallB = new GeoBuilder(false);
  const wallsOut = [];
  for (const w of data.walls) {
    const pts = w.pts.map(project);
    const line = [];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      // Deja huecos (puertas) donde la muralla corta una calle con coches
      let blocked = false;
      for (const sgm of carSegs) {
        if (segIntersect(a[0], a[1], b[0], b[1], sgm[0][0], sgm[0][1], sgm[1][0], sgm[1][1]) >= 0) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;
      addBox(wallB, a, b, 2.6, 0, 7.5, STONE);
      grid.add(a[0], a[1], b[0], b[1], 1.3, 2);
      line.push([a, b]);
    }
    wallsOut.push(line);
  }
  if (!wallB.empty) {
    const m = new THREE.Mesh(wallB.build(), plainMat);
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
    materials: { wallMat, plainMat },
  };
}

// Cinta plana para una calle (tramos + discos en las uniones).
function addRibbon(b, pts, w, y, color) {
  const hw = w / 2;
  const up = [0, 1, 0];
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
    pushQuadUp(b, p0, p1, p2, p3, up, color);
  }
  // discos en las uniones para tapar huecos (no hacen falta en sendas estrechas)
  if (w < 4) return;
  const seg = 6;
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
      b.tri(
        [p[0], y, p[1]],
        [p[0] + Math.cos(a1) * hw, y, p[1] + Math.sin(a1) * hw],
        [p[0] + Math.cos(a0) * hw, y, p[1] + Math.sin(a0) * hw],
        up,
        color,
      );
    }
  }
}

function pushQuadUp(b, p0, p1, p2, p3, up, color) {
  const t = (a, c, d) => {
    const cy = (c[2] - a[2]) * (d[0] - a[0]) - (c[0] - a[0]) * (d[2] - a[2]);
    if (cy >= 0) b.tri(a, c, d, up, color);
    else b.tri(a, d, c, up, color);
  };
  t(p0, p1, p2);
  t(p0, p2, p3);
}

// Caja alargada entre a y b (para murallas).
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
  for (let i = 0; i < 4; i++) addWall(b, ring[i], ring[(i + 1) % 4], y0, y1, color, 0, false);
  addCap(b, ring, y1, STONE_DARK);
}

export { GeoBuilder, addWall, addCap, cleanRing, pointInPolygon };
