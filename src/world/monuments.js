import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Hitos detallados del Casco Viejo construidos con primitivas low-poly:
// Ayuntamiento barroco, Catedral (fachada de Ventura Rodríguez), San Saturnino,
// San Nicolás, kiosco de la Plaza del Castillo, garitas de la muralla...

// ---------- Utilidades ----------
function prep(geo, color) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const c = new THREE.Color(color);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

// UV en metros según la orientación de cada vértice (para piedra y ladrillo)
function worldUV(g, scale) {
  const p = g.attributes.position;
  const n = g.attributes.normal;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const nx = Math.abs(n.getX(i));
    const ny = Math.abs(n.getY(i));
    const nz = Math.abs(n.getZ(i));
    if (ny > 0.7) uv.set([x / scale, z / scale], i * 2);
    else if (nx > nz) uv.set([z / scale, y / scale], i * 2);
    else uv.set([x / scale, y / scale], i * 2);
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

// Sistema de referencia ligado a una fachada: x = a lo largo, z = hacia fuera.
export function facadeFrame(mid, along, out) {
  const theta = Math.atan2(-along[1], along[0]);
  return {
    mid,
    along,
    out,
    world(lx, lz) {
      return [mid[0] + along[0] * lx + out[0] * lz, mid[1] + along[1] * lx + out[1] * lz];
    },
    theta,
  };
}

export class Kit {
  constructor(materials) {
    this.materials = materials;
    this.parts = {};
  }

  // Añade una geometría (en coordenadas locales del marco f, o del mundo si f = null)
  put(geo, color, mat = 'plain', f = null, lx = 0, ly = 0, lz = 0, extraRot = 0) {
    const g = prep(geo, color);
    if (extraRot) g.rotateY(extraRot);
    if (f) {
      g.rotateY(f.theta);
      const [wx, wz] = f.world(lx, lz);
      g.translate(wx, ly, wz);
    } else g.translate(lx, ly, lz);
    (this.parts[mat] ||= []).push(g);
    return g;
  }

  box(w, h, d, color, mat, f, lx, ly, lz, rot) {
    return this.put(new THREE.BoxGeometry(w, h, d), color, mat, f, lx, ly + h / 2, lz, rot);
  }

  cyl(rt, rb, h, seg, color, mat, f, lx, ly, lz, rot) {
    return this.put(new THREE.CylinderGeometry(rt, rb, h, seg), color, mat, f, lx, ly + h / 2, lz, rot);
  }

  // Prisma triangular (frontón) de ancho w, alto h y fondo d
  pediment(w, h, d, color, mat, f, lx, ly, lz) {
    const g = new THREE.CylinderGeometry(1, 1, d, 3);
    g.rotateX(-Math.PI / 2);
    g.translate(0, 0.5, 0);
    g.scale(w / 1.732, h / 1.5, 1);
    return this.put(g, color, mat, f, lx, ly, lz);
  }

  build(scene) {
    const UV_SCALE = { stone: 2.4, brick: 1.2 };
    for (const [mat, list] of Object.entries(this.parts)) {
      for (const g of list) {
        if (UV_SCALE[mat]) worldUV(g, UV_SCALE[mat]);
        else if (g.attributes.uv) g.deleteAttribute('uv');
      }
      const merged = mergeGeometries(list, false);
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, this.materials[mat]);
      mesh.castShadow = mat !== 'glow';
      mesh.receiveShadow = true;
      scene.add(mesh);
    }
  }
}

// Arista de un polígono (CCW) cuya normal exterior mira mejor hacia `target`
export function edgeFacing(pts, target, minLen = 6) {
  let best = null;
  let bestScore = -Infinity;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    const dx = q[0] - p[0];
    const dz = q[1] - p[1];
    const len = Math.hypot(dx, dz);
    if (len < minLen) continue;
    const out = [dz / len, -dx / len];
    const mid = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    const tx = target[0] - mid[0];
    const tz = target[1] - mid[1];
    const td = Math.hypot(tx, tz) || 1;
    const score = ((tx * out[0] + tz * out[1]) / td) * 2 - td / 60 + Math.min(len, 30) / 30;
    if (score > bestScore) {
      bestScore = score;
      best = { mid, along: [dx / len, dz / len], out, len };
    }
  }
  return best;
}

// Arista exterior más extrema en la dirección `dir` (p. ej. la fachada oeste)
export function edgeToward(pts, dir, minLen = 10) {
  let best = null;
  let bestScore = -Infinity;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    const dx = q[0] - p[0];
    const dz = q[1] - p[1];
    const len = Math.hypot(dx, dz);
    if (len < minLen) continue;
    const out = [dz / len, -dx / len];
    const facing = out[0] * dir[0] + out[1] * dir[1];
    if (facing < 0.6) continue;
    const mid = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    const score = mid[0] * dir[0] + mid[1] * dir[1] + facing * 5 + Math.min(len, 30) * 0.2;
    if (score > bestScore) {
      bestScore = score;
      best = { mid, along: [dx / len, dz / len], out, len };
    }
  }
  return best;
}

// ---------- Estatua estilizada ----------
function statue(kit, f, lx, ly, lz, color = '#e8d6a8', s = 1) {
  kit.cyl(0.45 * s, 0.6 * s, 0.4 * s, 8, color, 'plain', f, lx, ly, lz);
  kit.cyl(0.32 * s, 0.45 * s, 1.5 * s, 8, color, 'plain', f, lx, ly + 0.4 * s, lz);
  kit.put(new THREE.SphereGeometry(0.28 * s, 8, 6), color, 'plain', f, lx, ly + 2.15 * s, lz);
}

// ---------- Ayuntamiento de Pamplona (fachada barroca, 1760) ----------
export function buildTownHall(kit, e) {
  const f = facadeFrame(e.mid, e.along, e.out);
  const W = Math.min(e.len - 1, 18);
  const OCHRE = '#e8c47e';
  const LIGHT = '#f6e9c9';
  const CORN = '#d7ae64';
  const IRON = '#202022';
  const WOODC = '#5a3520';
  const z0 = 0.25;
  // paño de fachada
  kit.box(W, 19, 0.5, OCHRE, 'plain', f, 0, 0, z0);
  // tres cuerpos con columnas (dórico, jónico, corintio) y balcones corridos
  const levels = [
    { y: 0, h: 6 },
    { y: 6, h: 5.5 },
    { y: 11.5, h: 5 },
  ];
  const bays = 3;
  for (let L = 0; L < levels.length; L++) {
    const { y, h } = levels[L];
    // columnas pareadas
    for (const cx of [-W / 2 + 1, -W / 6, W / 6, W / 2 - 1]) {
      for (const dx of [-0.55, 0.55]) kit.cyl(0.32, 0.36, h - 0.9, 10, LIGHT, 'plain', f, cx + dx, y + 0.3, z0 + 0.6);
      kit.box(1.9, 0.3, 1.1, LIGHT, 'plain', f, cx, y, z0 + 0.6);
      kit.box(1.9, 0.4, 1.1, LIGHT, 'plain', f, cx, y + h - 0.6, z0 + 0.6);
    }
    // vanos (puertas-balcón) en cada calle
    for (let b = 0; b < bays; b++) {
      const bx = -W / 3 + (b * W) / 3;
      const vh = L === 0 ? 4.2 : 3.4;
      const vy = y + (L === 0 ? 0.2 : 0.9);
      kit.box(2.4, vh + 0.5, 0.3, LIGHT, 'plain', f, bx, vy - 0.1, z0 + 0.3);
      kit.box(1.9, vh, 0.3, L === 0 ? WOODC : '#2f4256', 'plain', f, bx, vy, z0 + 0.42);
      // frontoncillo sobre el vano
      kit.pediment(2.6, 0.8, 0.4, LIGHT, 'plain', f, bx, vy + vh + 0.35, z0 + 0.5);
    }
    // cornisa y balcón corrido de forja
    kit.box(W + 0.8, 0.5, 1.3, CORN, 'plain', f, 0, y + h - 0.2, z0 + 0.4);
    if (L > 0) {
      kit.box(W - 0.6, 0.18, 1.5, '#cdb48a', 'plain', f, 0, y + 0.75, z0 + 0.9);
      kit.box(W - 0.6, 0.08, 0.08, IRON, 'plain', f, 0, y + 1.85, z0 + 1.6);
      for (let k = -W / 2 + 0.6; k < W / 2 - 0.4; k += 0.35) kit.box(0.05, 1.05, 0.05, IRON, 'plain', f, k, y + 0.85, z0 + 1.6);
    }
  }
  // balaustrada superior
  kit.box(W + 0.8, 0.25, 1.2, CORN, 'plain', f, 0, 16.5, z0 + 0.4);
  for (let k = -W / 2 + 0.3; k <= W / 2 - 0.3; k += 0.55) kit.cyl(0.13, 0.16, 0.8, 6, LIGHT, 'plain', f, k, 16.75, z0 + 0.6);
  kit.box(W + 0.8, 0.22, 1.0, CORN, 'plain', f, 0, 17.55, z0 + 0.5);
  // remate central: frontón con escudo, reloj y estatuas
  kit.box(7, 4.5, 0.8, OCHRE, 'plain', f, 0, 17.8, z0 + 0.2);
  kit.pediment(8.5, 2.6, 1.0, CORN, 'plain', f, 0, 22.3, z0 + 0.3);
  kit.cyl(1.05, 1.05, 0.2, 18, '#fbf6e9', 'plain', f, 0, 19.6, z0 + 0.7, 0);
  kit.box(1.6, 1.8, 0.35, '#c0392b', 'plain', f, 0, 18.1, z0 + 0.65); // escudo
  kit.box(1.0, 0.4, 0.4, '#e0b84a', 'plain', f, 0, 19.95, z0 + 0.85);
  statue(kit, f, -2.6, 22.3, z0 + 0.4, '#efe0b8', 1.1);
  statue(kit, f, 2.6, 22.3, z0 + 0.4, '#efe0b8', 1.1);
  statue(kit, f, 0, 24.8, z0 + 0.4, '#e9c45a', 1.2); // la Fama
  for (const sx of [-W / 2 + 0.6, W / 2 - 0.6]) {
    statue(kit, f, sx, 17.8, z0 + 0.6, '#efe0b8', 0.95);
    kit.put(new THREE.SphereGeometry(0.4, 8, 6), '#e0b84a', 'plain', f, sx, 20.4, z0 + 0.6);
  }
  // reposteros rojos colgados del balcón principal
  for (const sx of [-W / 3, W / 3]) {
    kit.box(1.5, 2.4, 0.06, '#c8102e', 'plain', f, sx, 9.0, z0 + 1.62);
    kit.box(0.9, 0.9, 0.07, '#e0b84a', 'plain', f, sx, 10.1, z0 + 1.63);
  }
}

// ---------- Catedral de Santa María la Real ----------
export function buildCathedral(kit, e) {
  const f = facadeFrame(e.mid, e.along, e.out);
  const STONEC = '#f2e3c4';
  const DARK = '#2b2722';
  const towerW = 8;
  const span = Math.min(Math.max(e.len - 2, 26), 34);
  const tx = span / 2 - towerW / 2;
  const z = 3.5; // las torres sobresalen de la fachada
  // paño central y pórtico
  kit.box(span - towerW * 2 + 0.2, 24, 3, STONEC, 'stone', f, 0, 0, 1.5);
  for (const cx of [-4.5, -1.5, 1.5, 4.5]) {
    kit.cyl(0.7, 0.8, 12.5, 14, '#fbf2dd', 'stone', f, cx, 1.2, z + 3.5);
    kit.box(1.9, 0.6, 1.9, '#e6d6b4', 'stone', f, cx, 0, z + 3.5);
    kit.box(1.9, 0.8, 1.9, '#e6d6b4', 'stone', f, cx, 13.6, z + 3.5);
  }
  kit.box(12.5, 1.6, 5.5, '#ecdcba', 'stone', f, 0, 14.4, z + 2.2); // entablamento
  kit.pediment(13.5, 4, 5.5, '#ecdcba', 'stone', f, 0, 16, z + 2.2);
  kit.box(12, 1.2, 4.5, '#e2d1ad', 'stone', f, 0, 0, z + 2.6); // gradas
  kit.box(3.2, 6.5, 0.3, DARK, 'plain', f, 0, 1.2, z + 0.1); // puerta
  // torres campanario con remate en forma de campana
  for (const s of [-1, 1]) {
    const cx = s * tx;
    kit.box(towerW, 26, towerW, STONEC, 'stone', f, cx, 0, z);
    kit.box(towerW + 0.8, 0.9, towerW + 0.8, '#e0cfab', 'stone', f, cx, 26, z);
    // cuerpo de campanas con huecos oscuros
    kit.box(towerW - 1, 9, towerW - 1, STONEC, 'stone', f, cx, 26.9, z);
    for (const [ox, oz, rot] of [
      [0, towerW / 2 - 0.45, 0],
      [0, -(towerW / 2 - 0.45), 0],
      [towerW / 2 - 0.45, 0, Math.PI / 2],
      [-(towerW / 2 - 0.45), 0, Math.PI / 2],
    ]) {
      kit.box(2.4, 5, 0.3, DARK, 'plain', f, cx + ox, 28.6, z + oz, rot);
      kit.put(new THREE.SphereGeometry(0.7, 8, 6), '#b08a3e', 'plain', f, cx + ox * 0.7, 30, z + oz * 0.7);
    }
    for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      kit.put(new THREE.SphereGeometry(0.55, 8, 6), '#e0cfab', 'stone', f, cx + ox * (towerW / 2 - 0.2), 36.6, z + oz * (towerW / 2 - 0.2));
    }
    kit.box(towerW, 0.8, towerW, '#e0cfab', 'stone', f, cx, 35.9, z);
    const bell = new THREE.LatheGeometry(
      [
        [3.6, 0],
        [3.5, 0.8],
        [3.0, 2.2],
        [2.0, 3.6],
        [1.0, 4.6],
        [0.6, 5.2],
        [0.7, 5.6],
        [0.0, 5.7],
      ].map(([r, y]) => new THREE.Vector2(r, y)),
      8,
    );
    bell.rotateY(Math.PI / 8);
    kit.put(bell, '#cdb991', 'stone', f, cx, 36.7, z);
    kit.cyl(0.5, 0.5, 2, 8, '#e0cfab', 'stone', f, cx, 42.3, z);
    kit.put(new THREE.SphereGeometry(0.55, 8, 6), '#c9a24a', 'plain', f, cx, 44.8, z);
    kit.box(0.15, 1.6, 0.15, '#3a3a3a', 'plain', f, cx, 45.2, z);
    kit.box(0.9, 0.15, 0.15, '#3a3a3a', 'plain', f, cx, 45.9, z);
  }
}

// ---------- San Saturnino: torres de ladrillo ----------
export function buildSaturnino(kit, e) {
  const f = facadeFrame(e.mid, e.along, e.out);
  const B = '#ffffff';
  const span = Math.min(e.len, 18);
  const towers = [
    { x: -span / 2 + 3, h: 30, spire: true },
    { x: span / 2 - 3, h: 27, spire: false },
  ];
  for (const t of towers) {
    kit.box(6, t.h, 6, B, 'brick', f, t.x, 0, 2.5);
    kit.box(6.6, 0.6, 6.6, '#d8c4a0', 'stone', f, t.x, t.h - 6.5, 2.5);
    // huecos de campanas (arcos apuntados simplificados)
    for (const [ox, oz, rot] of [[0, 3.05, 0], [0, -3.05, 0], [3.05, 0, Math.PI / 2], [-3.05, 0, Math.PI / 2]]) {
      kit.box(1.5, 3.6, 0.2, '#2b2420', 'plain', f, t.x + ox, t.h - 5.2, 2.5 + oz, rot);
    }
    kit.box(6.6, 0.6, 6.6, '#d8c4a0', 'stone', f, t.x, t.h, 2.5);
    if (t.spire) {
      kit.put(new THREE.ConeGeometry(3.4, 10, 8).translate(0, 5, 0), '#8f5a3e', 'brick', f, t.x, t.h + 0.6, 2.5, Math.PI / 8);
      for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        kit.put(new THREE.ConeGeometry(0.5, 2.6, 6).translate(0, 1.3, 0), '#c9a77e', 'stone', f, t.x + ox * 2.9, t.h + 0.6, 2.5 + oz * 2.9);
      }
      kit.box(0.12, 1.4, 0.12, '#333', 'plain', f, t.x, t.h + 10.5, 2.5);
      kit.box(0.8, 0.12, 0.12, '#333', 'plain', f, t.x, t.h + 11.3, 2.5);
    } else {
      // almenas y tejadillo
      for (let k = -2.5; k <= 2.5; k += 1.25) {
        for (const oz of [-2.9, 2.9]) kit.box(0.6, 0.9, 0.6, B, 'brick', f, t.x + k, t.h + 0.6, 2.5 + oz);
        for (const ox of [-2.9, 2.9]) kit.box(0.6, 0.9, 0.6, B, 'brick', f, t.x + ox, t.h + 0.6, 2.5 + k);
      }
      kit.put(new THREE.ConeGeometry(2.6, 3, 4).translate(0, 1.5, 0), '#a8583a', 'plain', f, t.x, t.h + 0.6, 2.5, Math.PI / 4);
    }
  }
  // relojes en la cara exterior (discos girados hacia fuera)
  for (const t of towers) {
    const g = new THREE.CylinderGeometry(1.1, 1.1, 0.15, 16);
    g.rotateX(Math.PI / 2);
    kit.put(g, '#fbf6e9', 'plain', f, t.x, t.h - 9, 5.6);
    kit.put(new THREE.BoxGeometry(0.12, 0.8, 0.1), '#222', 'plain', f, t.x, t.h - 8.7, 5.7);
  }
  // pórtico gótico entre torres
  kit.box(span - 12, 9, 2.5, '#e8d6b6', 'stone', f, 0, 0, 1.3);
  kit.pediment(span - 12, 3, 2.5, '#e8d6b6', 'stone', f, 0, 9, 1.3);
  kit.box(2.6, 5, 0.3, '#3a2618', 'plain', f, 0, 0, 2.6);
}

// ---------- San Nicolás: torre-fortaleza almenada ----------
export function buildNicolas(kit, x, z) {
  const S = '#f0e0c0';
  kit.box(7, 27, 7, S, 'stone', null, x, 0, z);
  kit.box(7.8, 0.7, 7.8, '#ddc9a2', 'stone', null, x, 27, z);
  for (let k = -3.3; k <= 3.3; k += 1.1) {
    for (const o of [-3.6, 3.6]) {
      kit.box(0.7, 1.1, 0.7, S, 'stone', null, x + k, 27.7, z + o);
      kit.box(0.7, 1.1, 0.7, S, 'stone', null, x + o, 27.7, z + k);
    }
  }
  for (const [ox, oz, rot] of [[0, 3.55, 0], [0, -3.55, 0], [3.55, 0, Math.PI / 2], [-3.55, 0, Math.PI / 2]]) {
    kit.box(1.3, 3.2, 0.2, '#2b2420', 'plain', null, x + ox, 21, z + oz, rot);
  }
  kit.put(new THREE.ConeGeometry(3.2, 5, 4).translate(0, 2.5, 0), '#9d6b4c', 'plain', null, x, 27.7, z, Math.PI / 4);
}

// ---------- Kiosco de la Plaza del Castillo ----------
export function buildKiosk(kit, x, z) {
  kit.cyl(5.2, 5.4, 0.5, 8, '#d9d0bf', 'stone', null, x, 0, z, Math.PI / 8);
  kit.cyl(4.8, 5.0, 1.2, 8, '#e8dfcd', 'stone', null, x, 0.5, z, Math.PI / 8);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const cx = x + Math.cos(a) * 4.3;
    const cz = z + Math.sin(a) * 4.3;
    kit.cyl(0.14, 0.18, 4.2, 8, '#2f4a3a', 'plain', null, cx, 1.7, cz);
    kit.cyl(0.3, 0.14, 0.4, 8, '#2f4a3a', 'plain', null, cx, 5.6, cz);
    // barandilla entre columnas
    const a2 = ((i + 1) / 8) * Math.PI * 2;
    const mx = x + Math.cos((a + a2) / 2) * 4.0;
    const mz = z + Math.sin((a + a2) / 2) * 4.0;
    kit.box(3.2, 0.08, 0.08, '#2f4a3a', 'plain', null, mx, 2.6, mz, -(a + a2) / 2 + Math.PI / 2);
    kit.box(3.2, 0.05, 0.05, '#2f4a3a', 'plain', null, mx, 2.0, mz, -(a + a2) / 2 + Math.PI / 2);
  }
  kit.cyl(5.6, 5.6, 0.35, 8, '#e8e2d2', 'plain', null, x, 5.9, z, Math.PI / 8);
  const roof = new THREE.LatheGeometry(
    [
      [5.6, 0],
      [5.0, 0.6],
      [3.6, 1.4],
      [1.6, 2.3],
      [0.8, 2.7],
      [0, 2.8],
    ].map(([r, y]) => new THREE.Vector2(r, y)),
    8,
  );
  roof.rotateY(Math.PI / 8);
  kit.put(roof, '#4f7f63', 'plain', null, x, 6.2, z);
  kit.cyl(0.7, 0.7, 0.9, 8, '#e8e2d2', 'plain', null, x, 8.9, z);
  kit.put(new THREE.ConeGeometry(0.9, 1.0, 8).translate(0, 0.5, 0), '#4f7f63', 'plain', null, x, 9.8, z);
  kit.put(new THREE.SphereGeometry(0.35, 8, 6), '#e0b84a', 'plain', null, x, 11.0, z);
}

// ---------- Garita de la muralla ----------
export function buildGarita(kit, x, z, h) {
  kit.cyl(1.1, 0.6, 1.2, 10, '#e9d9b8', 'stone', null, x, h - 1.2, z);
  kit.cyl(1.1, 1.1, 2.2, 10, '#f0e2c4', 'stone', null, x, h, z);
  kit.box(0.4, 1.0, 2.3, '#2b2420', 'plain', null, x, h + 0.6, z);
  kit.put(new THREE.ConeGeometry(1.35, 1.6, 10).translate(0, 0.8, 0), '#d6c4a0', 'stone', null, x, h + 2.2, z);
  kit.put(new THREE.SphereGeometry(0.25, 6, 4), '#d6c4a0', 'stone', null, x, h + 3.9, z);
}

// ---------- Monumento a los Fueros ----------
export function buildFueros(kit, x, z) {
  kit.cyl(3.4, 3.8, 1.2, 8, '#d8ccb4', 'stone', null, x, 0, z);
  kit.cyl(2.2, 2.6, 4, 8, '#e6dcc6', 'stone', null, x, 1.2, z);
  kit.cyl(0.9, 1.1, 14, 14, '#ece3cf', 'stone', null, x, 5.2, z);
  kit.cyl(1.3, 1.0, 0.8, 10, '#d8ccb4', 'stone', null, x, 19.2, z);
  statue(kit, null, x, 20, z, '#6f7f6a', 1.5);
}
