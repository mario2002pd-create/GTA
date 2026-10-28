import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { pointInPolygon, centroid, mulberry32 } from '../geo.js';
import { Kit, edgeFacing, edgeToward, buildTownHall, buildCathedral, buildSaturnino, buildNicolas, buildKiosk, buildGarita, buildFueros } from './monuments.js';

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
  const kit = new Kit({
    plain: plainMat,
    stone: city.materials.stoneMat,
    brick: city.materials.brickMat,
    glow: new THREE.MeshBasicMaterial({ vertexColors: true }),
  });
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
    buildKiosk(kit, x, z);
    city.grid.addPolygon(octagon(x, z, 5.2), 0, 4);
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
  let catView = null;
  const cat = find('cathedral').sort((a, b) => b.area - a.area)[0];
  const catPos = cat ? [cat.cx, cat.cz] : FALLBACK.catedral;
  if (cat) {
    // fachada neoclásica hacia el oeste (calle Curia)
    const e = edgeToward(cat.pts, [-1, 0], 14);
    if (e) {
      buildCathedral(kit, e);
      catView = viewOf(e, 75, 30, 24);
    }
  }
  zones.push({ id: 'catedral', name: 'Catedral de Santa María', x: catPos[0], z: catPos[1], r: 60, view: catView });

  // --- San Saturnino: dos torres de ladrillo ---
  let satView = null;
  const sat = find('saturnino')[0] || find('church', /saturnino/)[0];
  const satPos = sat ? [sat.cx, sat.cz] : FALLBACK.saturnino;
  if (sat) {
    // torres hacia la calle San Saturnino / Ansoleaga (norte-oeste)
    const e = edgeToward(sat.pts, [-0.6, -0.8], 8);
    if (e) {
      buildSaturnino(kit, e);
      satView = viewOf(e, 55, 30, 20);
    }
  }
  zones.push({ id: 'saturnino', name: 'San Saturnino', x: satPos[0], z: satPos[1], r: 40, view: satView });

  // --- San Nicolás: torre ---
  const nic = find('nicolas')[0];
  if (nic) {
    buildNicolas(kit, nic.cx, nic.cz);
    zones.push({ id: 'sannicolas', name: 'San Nicolás', x: nic.cx, z: nic.cz, r: 40 });
  }

  // --- Ayuntamiento: remate barroco ---
  let thView = null;
  const th = find('townhall').sort((a, b) => b.area - a.area)[0];
  const thPos = th ? [th.cx, th.cz] : FALLBACK.ayuntamiento;
  if (th) {
    const consistorial = bySquare(/consistorial/);
    const target = consistorial ? [consistorial.cx, consistorial.cz] : [th.cx, th.cz - 30];
    const e = edgeFacing(th.pts, target, 8);
    if (e) {
      buildTownHall(kit, e);
      thView = viewOf(e, 28, 8, 12);
    }
  }
  zones.push({ id: 'ayuntamiento', name: 'Ayuntamiento', x: thPos[0], z: thPos[1], r: 35, view: thView });

  // --- Navarrería: fuente de Santa Cecilia ---
  const nav = bySquare(/navarrer|nabarreria/);
  const navPos = nav ? [nav.cx, nav.cz] : FALLBACK.navarreria;
  {
    const [x, z] = navPos;
    // fuente de Santa Cecilia: pilón octogonal, columna y figura
    kit.cyl(3.0, 3.2, 0.9, 8, '#e3d8c0', 'stone', null, x, 0, z, Math.PI / 8);
    kit.cyl(2.6, 2.6, 0.1, 8, '#4f9fd0', 'plain', null, x, 0.82, z, Math.PI / 8);
    kit.cyl(0.9, 1.1, 1.2, 8, '#e3d8c0', 'stone', null, x, 0.9, z);
    kit.cyl(0.35, 0.45, 2.4, 10, '#e9dfca', 'stone', null, x, 2.1, z);
    kit.cyl(1.0, 0.5, 0.4, 10, '#e3d8c0', 'stone', null, x, 4.5, z);
    kit.cyl(0.25, 0.32, 1.2, 8, '#6f7f6a', 'plain', null, x, 4.9, z);
    kit.put(new THREE.SphereGeometry(0.25, 8, 6), '#6f7f6a', 'plain', null, x, 6.3, z);
    city.grid.addPolygon(octagon(x, z, 3.2), 0, 4);
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

  // Banderines rojos y blancos cruzando las calles del encierro y alrededores
  const festive = [
    ...estafeta,
    ...merc,
    ...mayor,
    ...byStreet(/de san nicol|chapitela|zapater|de santo domingo|calder|navarrer/),
  ];
  const flags = [];
  const strings = [];
  for (const s of festive) {
    if (!['living_street', 'pedestrian', 'residential'].includes(s.type)) continue;
    for (let i = 1; i < s.pts.length; i++) {
      const a = s.pts[i - 1];
      const b = s.pts[i];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      for (let d = 3; d < len; d += 7) {
        const t = d / len;
        const px = a[0] + (b[0] - a[0]) * t;
        const pz = a[1] + (b[1] - a[1]) * t;
        const nx = -(b[1] - a[1]) / len;
        const nz = (b[0] - a[0]) / len;
        // ancho real hasta las fachadas
        const w = Math.min(city.grid.clearance(px, pz, 7, 1), 6) - 0.2;
        if (w < 2) continue;
        const n = Math.max(3, Math.floor((w * 2) / 0.55));
        const y0 = 7.4 + rng() * 1.5;
        for (let k = 0; k <= n; k++) {
          const u = k / n - 0.5;
          const sag = (0.25 - u * u) * 1.6;
          flags.push({ x: px + nx * u * w * 2, z: pz + nz * u * w * 2, y: y0 - sag, ry: Math.atan2(nx, nz), red: k % 2 === 0 });
        }
        strings.push({ x: px, z: pz, y: y0 - 0.2, len: w * 2, ry: Math.atan2(nx, nz) });
      }
    }
  }
  if (flags.length) {
    const fgeo = new THREE.ConeGeometry(0.28, 0.65, 3);
    fgeo.rotateX(Math.PI);
    fgeo.translate(0, -0.3, 0);
    const mat = new THREE.MeshLambertMaterial({ color: '#ffffff', side: THREE.DoubleSide });
    const im = new THREE.InstancedMesh(fgeo, mat, flags.length);
    const m = new THREE.Matrix4();
    const red = new THREE.Color('#d62828');
    const white = new THREE.Color('#ffffff');
    flags.forEach((f, i) => {
      m.makeRotationY(f.ry + Math.PI / 2);
      m.setPosition(f.x, f.y, f.z);
      im.setMatrixAt(i, m);
      im.setColorAt(i, f.red ? red : white);
    });
    scene.add(im);
    const sg = new THREE.BoxGeometry(1, 0.03, 0.03);
    const sm = new THREE.InstancedMesh(sg, new THREE.MeshLambertMaterial({ color: '#333' }), strings.length);
    const sc = new THREE.Vector3();
    const q = new THREE.Quaternion();
    strings.forEach((st, i) => {
      // ry = atan2(nx, nz): el cordel va en la dirección (nx, nz)
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(-Math.cos(st.ry), Math.sin(st.ry)));
      sc.set(st.len, 1, 1);
      m.compose(new THREE.Vector3(st.x, st.y, st.z), q, sc);
      sm.setMatrixAt(i, m);
    });
    scene.add(sm);
  }

  // --- Farolas fernandinas junto a las fachadas del Casco Viejo ---
  const lamps = [];
  for (const s of city.streets) {
    if (!['living_street', 'pedestrian'].includes(s.type)) continue;
    let side = 1;
    for (let i = 1; i < s.pts.length; i++) {
      const a = s.pts[i - 1];
      const b = s.pts[i];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      for (let d = 6; d < len - 2; d += 17) {
        const t = d / len;
        const px = a[0] + (b[0] - a[0]) * t;
        const pz = a[1] + (b[1] - a[1]) * t;
        const nx = (-(b[1] - a[1]) / len) * side;
        const nz = ((b[0] - a[0]) / len) * side;
        side = -side;
        // distancia a la fachada en esa dirección
        const reach = city.grid.raycast(px, pz, px + nx * 8, pz + nz * 8, 1);
        if (reach >= 1) continue;
        const off = reach * 8 - 0.45;
        if (off < 2.2) continue;
        lamps.push([px + nx * off, pz + nz * off]);
        if (lamps.length > 700) break;
      }
    }
  }
  if (city.squares) {
    for (const sq of city.squares) {
      if (!/castillo|consistorial|san francisco|navarr/i.test(sq.name || '')) continue;
      for (let i = 0; i < sq.pts.length; i++) {
        const a = sq.pts[i];
        const b = sq.pts[(i + 1) % sq.pts.length];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        for (let d = 5; d < len - 3; d += 14) {
          const t = d / len;
          const px = a[0] + (b[0] - a[0]) * t;
          const pz = a[1] + (b[1] - a[1]) * t;
          lamps.push([px + (sq.cx - px) * 0.06, pz + (sq.cz - pz) * 0.06]);
        }
      }
    }
  }
  if (lamps.length) {
    const post = new THREE.CylinderGeometry(0.07, 0.13, 3.6, 6).translate(0, 1.8, 0);
    const base = new THREE.CylinderGeometry(0.22, 0.26, 0.5, 6).translate(0, 0.25, 0);
    const postG = mergeGeometries([post, base], false);
    const lantern = new THREE.CylinderGeometry(0.32, 0.2, 0.7, 6).translate(0, 4.0, 0);
    const cap = new THREE.ConeGeometry(0.38, 0.35, 6).translate(0, 4.5, 0);
    const posts = new THREE.InstancedMesh(postG, new THREE.MeshLambertMaterial({ color: '#1e2124' }), lamps.length);
    const caps = new THREE.InstancedMesh(cap, new THREE.MeshLambertMaterial({ color: '#1e2124' }), lamps.length);
    const lights = new THREE.InstancedMesh(lantern, new THREE.MeshLambertMaterial({ color: '#fff3c4', emissive: '#ffcf6a', emissiveIntensity: 0.9 }), lamps.length);
    const m = new THREE.Matrix4();
    lamps.forEach(([x, z], i) => {
      m.makeTranslation(x, 0, z);
      posts.setMatrixAt(i, m);
      caps.setMatrixAt(i, m);
      lights.setMatrixAt(i, m);
      city.grid.addPolygon(octagon(x, z, 0.2), 0, 4);
    });
    posts.castShadow = true;
    scene.add(posts, caps, lights);
  }

  // --- Terrazas de los cafés de la Plaza del Castillo ---
  if (castillo) {
    const tables = [];
    const pts = castillo.pts;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 25) continue;
      for (let d = 8; d < len - 8; d += 4.5) {
        const t = d / len;
        const px = a[0] + (b[0] - a[0]) * t;
        const pz = a[1] + (b[1] - a[1]) * t;
        const dx = cPos[0] - px;
        const dz = cPos[1] - pz;
        const dl = Math.hypot(dx, dz) || 1;
        const x = px + (dx / dl) * 5.5;
        const z = pz + (dz / dl) * 5.5;
        if (Math.hypot(x - kPos[0], z - kPos[1]) < 12) continue;
        if (city.grid.clearance(x, z, 3, 1) < 2.5) continue;
        tables.push([x, z, rng() < 0.5]);
      }
    }
    if (tables.length) {
      const tableG = mergeGeometries([
        new THREE.CylinderGeometry(0.45, 0.45, 0.05, 10).translate(0, 0.75, 0),
        new THREE.CylinderGeometry(0.05, 0.08, 0.75, 6).translate(0, 0.37, 0),
        new THREE.BoxGeometry(0.4, 0.5, 0.4).translate(0.75, 0.25, 0),
        new THREE.BoxGeometry(0.4, 0.5, 0.4).translate(-0.75, 0.25, 0),
      ], false);
      const umbG = mergeGeometries([new THREE.ConeGeometry(1.5, 0.55, 8).translate(0, 2.55, 0), new THREE.CylinderGeometry(0.04, 0.04, 2.3, 4).translate(0, 1.15, 0)], false);
      const tm = new THREE.InstancedMesh(tableG, new THREE.MeshLambertMaterial({ color: '#c9c3b6' }), tables.length);
      const um = new THREE.InstancedMesh(umbG, new THREE.MeshLambertMaterial({ color: '#ffffff' }), tables.length);
      const m = new THREE.Matrix4();
      const cols = [new THREE.Color('#f4f1ea'), new THREE.Color('#c8102e'), new THREE.Color('#f4f1ea')];
      tables.forEach(([x, z], i) => {
        m.makeRotationY(rng() * 6.28);
        m.setPosition(x, 0, z);
        tm.setMatrixAt(i, m);
        um.setMatrixAt(i, m);
        um.setColorAt(i, cols[i % 3]);
        city.grid.addPolygon(octagon(x, z, 0.9), 0, 4);
      });
      tm.castShadow = um.castShadow = true;
      scene.add(tm, um);
    }
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
    const crownG = mergeGeometries([
      new THREE.IcosahedronGeometry(2.2, 0).translate(0, 4, 0),
      new THREE.IcosahedronGeometry(1.6, 0).translate(0.9, 5.2, 0.4),
      new THREE.IcosahedronGeometry(1.5, 0).translate(-0.9, 4.9, -0.5),
    ], false);
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

  // --- Garitas en las puntas de los baluartes ---
  let garitas = 0;
  for (const line of city.walls) {
    for (let i = 1; i < line.length && garitas < 30; i++) {
      const [a, b] = line[i - 1];
      const [, c] = line[i];
      if (Math.hypot(b[0] - line[i][0][0], b[1] - line[i][0][1]) > 0.5) continue;
      const a1 = Math.atan2(b[1] - a[1], b[0] - a[0]);
      const a2 = Math.atan2(c[1] - b[1], c[0] - b[0]);
      let da = Math.abs(a2 - a1);
      if (da > Math.PI) da = Math.PI * 2 - da;
      if (da > 0.9) {
        buildGarita(kit, b[0], b[1], 8);
        garitas++;
      }
    }
  }
  const fueros = city.special.find((s) => s.kind === 'monument');
  if (fueros) {
    buildFueros(kit, fueros.cx, fueros.cz);
    city.grid.addPolygon(octagon(fueros.cx, fueros.cz, 3.6), 0, 4);
  }

  kit.build(scene);

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

// Punto de vista frente a una fachada (para la cámara de presentación)
function viewOf(e, dist, camY, lookY) {
  return {
    cam: [e.mid[0] + e.out[0] * dist, camY, e.mid[1] + e.out[1] * dist],
    look: [e.mid[0], lookY, e.mid[1]],
  };
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
