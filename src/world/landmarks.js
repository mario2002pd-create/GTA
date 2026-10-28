import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { pointInPolygon, centroid, mulberry32 } from '../geo.js';

// Hitos simplificados y decoración (árboles, banderines, kiosko, fuente...).
// Devuelve la lista de zonas con nombre para el HUD y las misiones.

const FALLBACK = {
  // [x, z] aproximados (m) respecto al origen (Plaza del Castillo)
  castillo: [0, 0],
  estafeta: [10, -95],
  mayor: [-330, -35],
  ayuntamiento: [-190, -70],
  catedral: [170, -260],
  saturnino: [-255, -60],
  mercaderes: [-140, -80],
  navarreria: [60, -205],
  taconera: [-830, -80],
  santodomingo: [-245, -200],
  plazatoros: [205, 40],
  sannicolas: [-220, 45],
};

function colored(geo, color) {
  const g = geo.toNonIndexed();
  const c = new THREE.Color(color);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  if (g.attributes.uv) g.deleteAttribute('uv');
  return g;
}

function at(geo, x, y, z, ry = 0) {
  geo.rotateY(ry);
  geo.translate(x, y, z);
  return geo;
}

export function buildLandmarks(scene, city) {
  const parts = [];
  const zones = [];
  const rng = mulberry32(42);
  const plainMat = city.materials.plainMat;
  const find = (kind, re) =>
    city.special.filter((s) => s.kind === kind && (!re || re.test((s.name || '').toLowerCase())));
  const bySquare = (re) => city.squares.find((s) => re.test((s.name || '').toLowerCase()));
  const byStreet = (re) => city.streets.filter((s) => re.test((s.name || '').toLowerCase()));
  const midOfStreets = (list) => {
    let best = null;
    let bestLen = 0;
    for (const s of list) {
      let len = 0;
      for (let i = 1; i < s.pts.length; i++) len += Math.hypot(s.pts[i][0] - s.pts[i - 1][0], s.pts[i][1] - s.pts[i - 1][1]);
      if (len > bestLen) {
        bestLen = len;
        best = s;
      }
    }
    if (!best) return null;
    return best.pts[Math.floor(best.pts.length / 2)];
  };

  // --- Plaza del Castillo: kiosko + árboles ---
  const castillo = bySquare(/castillo|gazteluko plaza/);
  const kioskData = city.special.find((s) => s.kind === 'kiosk');
  const cPos = castillo ? [castillo.cx, castillo.cz] : FALLBACK.castillo;
  const kPos = kioskData ? [kioskData.cx, kioskData.cz] : cPos;
  {
    const [x, z] = kPos;
    parts.push(colored(at(new THREE.CylinderGeometry(4.6, 4.6, 1.2, 8), x, 0.6, z), '#d9cfbd'));
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      parts.push(colored(at(new THREE.CylinderGeometry(0.18, 0.18, 4, 6), x + Math.cos(a) * 4, 3.2, z + Math.sin(a) * 4), '#3e5b45'));
    }
    parts.push(colored(at(new THREE.ConeGeometry(5.4, 2.4, 8), x, 6.4, z), '#4f7a5a'));
    parts.push(colored(at(new THREE.SphereGeometry(0.5, 8, 6), x, 7.8, z), '#e0b84a'));
    city.grid.addPolygon(octagon(x, z, 4.6), 0, 4);
    if (castillo) {
      // hilera de árboles alrededor de la plaza
      const pts = castillo.pts;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        for (let d = 6; d < len - 4; d += 11) {
          const t = d / len;
          const px = a[0] + (b[0] - a[0]) * t;
          const pz = a[1] + (b[1] - a[1]) * t;
          const tx = px + (cPos[0] - px) * 0.08;
          const tz = pz + (cPos[1] - pz) * 0.08;
          city.extraTrees = city.extraTrees || [];
          city.extraTrees.push([tx, tz]);
        }
      }
    }
  }
  zones.push({ id: 'castillo', name: 'Plaza del Castillo', x: cPos[0], z: cPos[1], r: 70 });

  // --- Catedral de Santa María: dos torres en la fachada oeste ---
  const cat = find('cathedral').sort((a, b) => b.area - a.area)[0];
  const catPos = cat ? [cat.cx, cat.cz] : FALLBACK.catedral;
  if (cat) {
    const west = cat.pts.reduce((m, p) => (p[0] < m[0] ? p : m), cat.pts[0]);
    const tx = west[0] + 6;
    const ys = cat.pts.map((p) => p[1]);
    const zMid = (Math.min(...ys) + Math.max(...ys)) / 2;
    for (const off of [-9, 9]) {
      parts.push(colored(at(new THREE.BoxGeometry(7, 34, 7), tx, 17, zMid + off), '#cdbb95'));
      parts.push(colored(at(new THREE.BoxGeometry(7.6, 1, 7.6), tx, 34.5, zMid + off), '#a8956f'));
      parts.push(colored(at(new THREE.CylinderGeometry(0.6, 2.8, 4, 4), tx, 37, zMid + off, Math.PI / 4), '#8c7c5c'));
    }
    // frontón neoclásico
    parts.push(colored(at(new THREE.BoxGeometry(3, 22, 11), tx - 2, 11, zMid), '#d6c6a2'));
  }
  zones.push({ id: 'catedral', name: 'Catedral de Santa María', x: catPos[0], z: catPos[1], r: 60 });

  // --- San Saturnino: dos torres de ladrillo ---
  const sat = find('saturnino')[0] || find('church', /saturnino/)[0];
  const satPos = sat ? [sat.cx, sat.cz] : FALLBACK.saturnino;
  if (sat) {
    const north = sat.pts.reduce((m, p) => (p[1] < m[1] ? p : m), sat.pts[0]);
    const xs = sat.pts.map((p) => p[0]);
    const xMid = (Math.min(...xs) + Math.max(...xs)) / 2;
    for (const off of [-6, 6]) {
      parts.push(colored(at(new THREE.BoxGeometry(6, 30, 6), xMid + off, 15, north[1] + 4), '#a8684a'));
      parts.push(colored(at(new THREE.ConeGeometry(3.6, 6, 4), xMid + off, 33, north[1] + 4, Math.PI / 4), '#6a4a3a'));
    }
  }
  zones.push({ id: 'saturnino', name: 'San Saturnino', x: satPos[0], z: satPos[1], r: 40 });

  // --- San Nicolás: torre ---
  const nic = find('nicolas')[0];
  if (nic) {
    parts.push(colored(at(new THREE.BoxGeometry(6, 26, 6), nic.cx, 13, nic.cz), '#bfa983'));
    parts.push(colored(at(new THREE.ConeGeometry(3.6, 5, 4), nic.cx, 28.5, nic.cz, Math.PI / 4), '#7b6a4e'));
    zones.push({ id: 'sannicolas', name: 'San Nicolás', x: nic.cx, z: nic.cz, r: 40 });
  }

  // --- Ayuntamiento: remate barroco ---
  const th = find('townhall').sort((a, b) => b.area - a.area)[0];
  const thPos = th ? [th.cx, th.cz] : FALLBACK.ayuntamiento;
  if (th) {
    parts.push(colored(at(new THREE.BoxGeometry(10, 4, 3), th.cx, 19, th.cz), '#e9d6a9'));
    parts.push(colored(at(new THREE.ConeGeometry(3.5, 3, 3), th.cx, 22.5, th.cz), '#d8b86a'));
    parts.push(colored(at(new THREE.SphereGeometry(0.9, 8, 6), th.cx, 24.5, th.cz), '#e7c34f'));
  }
  zones.push({ id: 'ayuntamiento', name: 'Ayuntamiento', x: thPos[0], z: thPos[1], r: 35 });

  // --- Navarrería: fuente de Santa Cecilia ---
  const nav = bySquare(/navarrer|nabarreria/);
  const navPos = nav ? [nav.cx, nav.cz] : FALLBACK.navarreria;
  {
    const [x, z] = navPos;
    parts.push(colored(at(new THREE.CylinderGeometry(2.6, 2.8, 0.8, 10), x, 0.4, z), '#c0b291'));
    parts.push(colored(at(new THREE.CylinderGeometry(2.2, 2.2, 0.1, 10), x, 0.82, z), '#5fa8d3'));
    parts.push(colored(at(new THREE.CylinderGeometry(0.35, 0.5, 3, 6), x, 2, z), '#c0b291'));
    parts.push(colored(at(new THREE.SphereGeometry(0.6, 8, 6), x, 3.8, z), '#9a8a6a'));
    city.grid.addPolygon(octagon(x, z, 2.8), 0, 4);
  }
  zones.push({ id: 'navarreria', name: 'Navarrería', x: navPos[0], z: navPos[1], r: 45 });

  // --- Calles con nombre: Estafeta, Calle Mayor, Mercaderes ---
  const estafeta = byStreet(/estafeta/);
  const estPos = midOfStreets(estafeta) || FALLBACK.estafeta;
  zones.push({ id: 'estafeta', name: 'Calle Estafeta', x: estPos[0], z: estPos[1], r: 30, street: /estafeta/ });
  const mayor = byStreet(/^calle mayor|kale nagusia/);
  const mayPos = midOfStreets(mayor) || FALLBACK.mayor;
  zones.push({ id: 'mayor', name: 'Calle Mayor', x: mayPos[0], z: mayPos[1], r: 30, street: /^calle mayor|kale nagusia/ });
  const merc = byStreet(/mercaderes/);
  const merPos = midOfStreets(merc) || FALLBACK.mercaderes;
  zones.push({ id: 'mercaderes', name: 'Calle Mercaderes', x: merPos[0], z: merPos[1], r: 25, street: /mercaderes/ });

  // Banderines rojos y blancos cruzando la Estafeta (ambiente festivo)
  const flags = [];
  for (const s of estafeta) {
    for (let i = 1; i < s.pts.length; i++) {
      const a = s.pts[i - 1];
      const b = s.pts[i];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      for (let d = 4; d < len; d += 9) {
        const t = d / len;
        const px = a[0] + (b[0] - a[0]) * t;
        const pz = a[1] + (b[1] - a[1]) * t;
        const nx = -(b[1] - a[1]) / len;
        const nz = (b[0] - a[0]) / len;
        for (let k = -3; k <= 3; k++) {
          flags.push({ x: px + nx * k * 0.9, z: pz + nz * k * 0.9, y: 7.6 - (9 - k * k) * 0.07, ry: Math.atan2(nx, nz), red: (k + 3) % 2 === 0 });
        }
      }
    }
  }
  if (flags.length) {
    const fgeo = new THREE.ConeGeometry(0.35, 0.8, 3);
    fgeo.rotateX(Math.PI);
    const mat = new THREE.MeshLambertMaterial({ color: '#ffffff' });
    const im = new THREE.InstancedMesh(fgeo, mat, flags.length);
    const m = new THREE.Matrix4();
    const red = new THREE.Color('#d62828');
    const white = new THREE.Color('#ffffff');
    flags.forEach((f, i) => {
      m.makeRotationY(f.ry);
      m.setPosition(f.x, f.y, f.z);
      im.setMatrixAt(i, m);
      im.setColorAt(i, f.red ? red : white);
    });
    scene.add(im);
  }

  // --- Plaza de Toros ---
  const bull = find('bullring')[0];
  const bullPos = bull ? [bull.cx, bull.cz] : FALLBACK.plazatoros;
  zones.push({ id: 'plazatoros', name: 'Plaza de Toros', x: bullPos[0], z: bullPos[1], r: 60 });

  // --- Mercado de Santo Domingo ---
  const sdPos = (() => {
    const f = city.footprints.find((p) => /mercado de santo domingo/i.test(p.name || ''));
    return f ? [f.cx, f.cz] : FALLBACK.santodomingo;
  })();
  zones.push({ id: 'santodomingo', name: 'Santo Domingo', x: sdPos[0], z: sdPos[1], r: 40 });

  // --- Taconera: parque + árboles ---
  const tacon = city.parks.filter((p) => /taconera/i.test(p.name || ''));
  let tacPos = FALLBACK.taconera;
  const tacStreet = byStreet(/parque de la taconera/);
  if (tacon.length) tacPos = centroid(tacon[0].pts);
  else if (tacStreet.length) tacPos = midOfStreets(tacStreet);
  zones.push({ id: 'taconera', name: 'Parque de la Taconera', x: tacPos[0], z: tacPos[1], r: 110 });

  // --- Murallas (zona): el tramo más cercano a la Catedral (Redín) ---
  let wallPos = null;
  let wallBest = Infinity;
  for (const line of city.walls) {
    for (const [a, b] of line) {
      const mx = (a[0] + b[0]) / 2;
      const mz = (a[1] + b[1]) / 2;
      const d = Math.hypot(mx - catPos[0], mz - catPos[1]);
      if (d < wallBest) {
        wallBest = d;
        wallPos = [mx, mz];
      }
    }
  }
  if (wallPos) zones.push({ id: 'murallas', name: 'Murallas', x: wallPos[0], z: wallPos[1], r: 50 });

  // --- Árboles en parques ---
  const trees = [...(city.extraTrees || [])];
  // La Taconera es una relación multipolígono en OSM: repartimos árboles en su zona
  const tz = zones.find((z) => z.id === 'taconera');
  if (tz) {
    for (let i = 0, n = 0; i < 1500 && n < 380; i++) {
      const a = rng() * Math.PI * 2;
      const r = Math.sqrt(rng()) * tz.r;
      const x = tz.x + Math.cos(a) * r;
      const z = tz.z + Math.sin(a) * r;
      if (city.grid.clearance(x, z, 4, 3) < 3.5) continue;
      if (nearRoad(city, x, z, 4)) continue;
      trees.push([x, z]);
      n++;
    }
  }
  for (const p of city.parks) {
    const xs = p.pts.map((q) => q[0]);
    const zs = p.pts.map((q) => q[1]);
    const x0 = Math.min(...xs);
    const x1 = Math.max(...xs);
    const z0 = Math.min(...zs);
    const z1 = Math.max(...zs);
    if ((x1 - x0) * (z1 - z0) < 150 || trees.length > 1500) continue;
    for (let x = x0 + 4; x < x1; x += 10) {
      for (let z = z0 + 4; z < z1; z += 10) {
        const tx = x + (rng() - 0.5) * 6;
        const tz = z + (rng() - 0.5) * 6;
        if (!pointInPolygon(tx, tz, p.pts)) continue;
        if (city.grid.raycast(tx - 2.5, tz, tx + 2.5, tz) < 1 || city.grid.raycast(tx, tz - 2.5, tx, tz + 2.5) < 1) continue;
        if (nearRoad(city, tx, tz, 3.5)) continue;
        trees.push([tx, tz]);
      }
    }
  }
  if (trees.length) {
    const trunkG = new THREE.CylinderGeometry(0.25, 0.35, 2.4, 6);
    trunkG.translate(0, 1.2, 0);
    const crownG = new THREE.IcosahedronGeometry(2.2, 0);
    crownG.translate(0, 4, 0);
    const trunk = new THREE.InstancedMesh(trunkG, new THREE.MeshLambertMaterial({ color: '#7a5a3c' }), trees.length);
    const crown = new THREE.InstancedMesh(crownG, new THREE.MeshLambertMaterial({ color: '#ffffff' }), trees.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const greens = ['#5e9e45', '#6aab4f', '#4f8f3d', '#78b356'].map((c) => new THREE.Color(c));
    trees.forEach(([x, z], i) => {
      const k = 0.8 + rng() * 0.5;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * 6.28);
      s.set(k, k, k);
      p.set(x, 0, z);
      m.compose(p, q, s);
      trunk.setMatrixAt(i, m);
      crown.setMatrixAt(i, m);
      crown.setColorAt(i, greens[i % greens.length]);
      city.grid.addPolygon(octagon(x, z, 0.45), 0, 4);
    });
    trunk.castShadow = crown.castShadow = true;
    scene.add(trunk, crown);
  }

  if (parts.length) {
    const merged = mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)), false);
    const mesh = new THREE.Mesh(merged, plainMat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  const byId = Object.fromEntries(zones.map((z) => [z.id, z]));
  return { zones, byId };
}

function nearRoad(city, x, z, d) {
  if (!city._roadGrid) {
    city._roadGrid = new Map();
    for (const s of city.streets) {
      const narrow = ['footway', 'path', 'cycleway', 'steps'].includes(s.type);
      // muestreamos cada 3 m para detectar también tramos largos
      for (let i = 1; i < s.pts.length; i++) {
        const a = s.pts[i - 1];
        const b = s.pts[i];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        for (let d = 0; d <= len; d += 3) {
          const x = a[0] + ((b[0] - a[0]) * d) / (len || 1);
          const z = a[1] + ((b[1] - a[1]) * d) / (len || 1);
          const k = Math.floor(x / 10) + ',' + Math.floor(z / 10);
          if (!city._roadGrid.has(k)) city._roadGrid.set(k, []);
          city._roadGrid.get(k).push([x, z, narrow ? -2 : 0]);
        }
      }
    }
  }
  const i = Math.floor(x / 10);
  const j = Math.floor(z / 10);
  for (let a = i - 1; a <= i + 1; a++) {
    for (let b = j - 1; b <= j + 1; b++) {
      const arr = city._roadGrid.get(a + ',' + b);
      if (!arr) continue;
      for (const p of arr) if (Math.hypot(p[0] - x, p[1] - z) < d + p[2]) return true;
    }
  }
  return false;
}

function octagon(x, z, r) {
  const pts = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    pts.push([x + Math.cos(a) * r, z + Math.sin(a) * r]);
  }
  return pts;
}
