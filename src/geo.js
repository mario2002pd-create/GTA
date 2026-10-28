// Proyección local lon/lat → metros (equirectangular centrada en la Plaza del Castillo).
// Ejes del mundo: x = este, z = sur (el norte es -z), y = altura.
export const ORIGIN = { lat: 42.8176, lon: -1.642 };

const R = 6378137;
const KX = Math.cos((ORIGIN.lat * Math.PI) / 180) * (Math.PI / 180) * R;
const KZ = (Math.PI / 180) * R;

export function project(p) {
  return [(p[0] - ORIGIN.lon) * KX, -(p[1] - ORIGIN.lat) * KZ];
}

export function unproject(x, z) {
  return [x / KX + ORIGIN.lon, -z / KZ + ORIGIN.lat];
}

// Utilidades de polígonos 2D ([x, z][])
export function signedArea(pts) {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % n];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

export function centroid(pts) {
  let x = 0;
  let z = 0;
  for (const p of pts) {
    x += p[0];
    z += p[1];
  }
  return [x / pts.length, z / pts.length];
}

export function pointInPolygon(x, z, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0];
    const zi = pts[i][1];
    const xj = pts[j][0];
    const zj = pts[j][1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export function segIntersect(ax, az, bx, bz, cx, cz, dx, dz) {
  // Devuelve t ∈ [0,1] sobre AB si AB corta CD, o -1.
  const rX = bx - ax;
  const rZ = bz - az;
  const sX = dx - cx;
  const sZ = dz - cz;
  const den = rX * sZ - rZ * sX;
  if (Math.abs(den) < 1e-9) return -1;
  const t = ((cx - ax) * sZ - (cz - az) * sX) / den;
  const u = ((cx - ax) * rZ - (cz - az) * rX) / den;
  if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return t;
  return -1;
}

// Pseudoaleatorio determinista
export function hash(n) {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export function angleDiff(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
