import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp, angleDiff } from '../geo.js';

// ---------- Modelos low-poly ----------
function part(geo, color, x, y, z) {
  const g = geo.toNonIndexed();
  g.translate(x, y, z);
  const c = new THREE.Color(color);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  g.deleteAttribute('uv');
  return g;
}

const geoCache = new Map();
const carMat = new THREE.MeshLambertMaterial({ vertexColors: true });

export const CAR_COLORS = ['#e63946', '#f4a261', '#2a9d8f', '#457b9d', '#e9c46a', '#8d6cab', '#f1faee', '#ff7aa2', '#5fb85b', '#3b3b44'];

function carGeometry(color, kind) {
  const key = color + kind;
  if (geoCache.has(key)) return geoCache.get(key);
  const parts = [];
  const body = kind === 'police' ? '#f5f7fa' : color;
  const L = kind === 'van' ? 4.6 : 4.1;
  parts.push(part(new THREE.BoxGeometry(1.9, 0.7, L), body, 0, 0.65, 0));
  if (kind === 'van') {
    parts.push(part(new THREE.BoxGeometry(1.84, 1.25, 3.2), body, 0, 1.6, -0.5));
    parts.push(part(new THREE.BoxGeometry(1.7, 0.5, 0.1), '#33475b', 0, 1.75, 1.12));
  } else {
    parts.push(part(new THREE.BoxGeometry(1.66, 0.62, 2.1), '#33475b', 0, 1.3, -0.25));
    parts.push(part(new THREE.BoxGeometry(1.72, 0.12, 2.0), body, 0, 1.66, -0.25));
  }
  if (kind === 'police') {
    parts.push(part(new THREE.BoxGeometry(1.94, 0.3, 2.2), '#1d4ed8', 0, 0.72, 0));
    parts.push(part(new THREE.BoxGeometry(1.0, 0.12, 0.5), '#1d4ed8', 0, 1.76, -0.25));
  }
  if (kind === 'taxi') {
    parts.push(part(new THREE.BoxGeometry(0.7, 0.25, 0.3), '#fff6a5', 0, 1.85, -0.25));
  }
  // faros y pilotos
  parts.push(part(new THREE.BoxGeometry(0.4, 0.2, 0.08), '#fff7cc', 0.6, 0.75, L / 2));
  parts.push(part(new THREE.BoxGeometry(0.4, 0.2, 0.08), '#fff7cc', -0.6, 0.75, L / 2));
  parts.push(part(new THREE.BoxGeometry(0.4, 0.2, 0.08), '#c1121f', 0.6, 0.75, -L / 2));
  parts.push(part(new THREE.BoxGeometry(0.4, 0.2, 0.08), '#c1121f', -0.6, 0.75, -L / 2));
  // parachoques
  parts.push(part(new THREE.BoxGeometry(1.95, 0.22, 0.2), '#444', 0, 0.38, L / 2));
  parts.push(part(new THREE.BoxGeometry(1.95, 0.22, 0.2), '#444', 0, 0.38, -L / 2));
  // ruedas
  const wheel = new THREE.CylinderGeometry(0.36, 0.36, 0.3, 10);
  wheel.rotateZ(Math.PI / 2);
  for (const [wx, wz] of [[0.92, L / 2 - 0.8], [-0.92, L / 2 - 0.8], [0.92, -L / 2 + 0.8], [-0.92, -L / 2 + 0.8]]) {
    parts.push(part(wheel, '#1f1f24', wx, 0.36, wz));
  }
  const g = mergeGeometries(parts, false);
  geoCache.set(key, g);
  return g;
}

const sirenRed = new THREE.MeshBasicMaterial({ color: '#ff2a2a' });
const sirenBlue = new THREE.MeshBasicMaterial({ color: '#2a6bff' });
const sirenOff = new THREE.MeshBasicMaterial({ color: '#555a66' });
const sirenGeo = new THREE.BoxGeometry(0.45, 0.2, 0.35);

// ---------- Coche con física arcade ----------
export class Car {
  constructor(scene, { x = 0, z = 0, heading = 0, color = '#e63946', kind = 'car' } = {}) {
    this.kind = kind;
    this.color = color;
    this.mesh = new THREE.Group();
    this.body = new THREE.Mesh(carGeometry(color, kind), carMat);
    this.body.castShadow = true;
    this.mesh.add(this.body);
    if (kind === 'police') {
      this.sirenL = new THREE.Mesh(sirenGeo, sirenOff);
      this.sirenR = new THREE.Mesh(sirenGeo, sirenOff);
      this.sirenL.position.set(0.3, 1.84, -0.25);
      this.sirenR.position.set(-0.3, 1.84, -0.25);
      this.mesh.add(this.sirenL, this.sirenR);
    }
    scene.add(this.mesh);
    this.scene = scene;
    this.x = x;
    this.z = z;
    this.heading = heading;
    this.vx = 0;
    this.vz = 0;
    this.steerVis = 0;
    this.driver = null; // 'player' | 'npc' | null
    this.maxSpeed = kind === 'police' ? 30 : kind === 'van' ? 22 : 28;
    this.accel = kind === 'police' ? 15 : 13;
    this.radius = 0.95;
    this.half = kind === 'van' ? 1.35 : 1.15;
    this.lastImpact = 0;
    this.sirenOn = false;
    this.sirenT = 0;
    this.tilt = 0;
    this.sync();
  }

  get speed() {
    return Math.hypot(this.vx, this.vz);
  }

  get forwardSpeed() {
    return this.vx * Math.sin(this.heading) + this.vz * Math.cos(this.heading);
  }

  // input: { throttle: -1..1, steer: -1..1 (+ = derecha), handbrake: bool }
  update(dt, input, grid) {
    const fx = Math.sin(this.heading);
    const fz = Math.cos(this.heading);
    const sx = fz;
    const sz = -fx;
    let vF = this.vx * fx + this.vz * fz;
    let vR = this.vx * sx + this.vz * sz;
    const th = input.throttle || 0;
    if (th > 0) {
      if (vF < -0.5) vF += 22 * dt * th;
      else vF += this.accel * th * dt * (1 - clamp(vF / this.maxSpeed, 0, 1) ** 2);
    } else if (th < 0) {
      if (vF > 0.5) vF += 24 * dt * th;
      else if (vF > -9) vF += 8 * dt * th;
    } else {
      vF -= vF * 0.6 * dt;
      if (Math.abs(vF) < 0.15) vF = 0;
    }
    const grip = input.handbrake ? 1.3 : 9;
    vR *= Math.exp(-grip * dt);
    if (input.handbrake) vF -= Math.sign(vF) * Math.min(Math.abs(vF), 9 * dt);
    this.vx = fx * vF + sx * vR;
    this.vz = fz * vF + sz * vR;

    const steer = clamp(input.steer || 0, -1, 1);
    this.steerVis += (steer - this.steerVis) * Math.min(1, dt * 8);
    const speedFactor = clamp(Math.abs(vF) / 5, 0, 1) * (1 - 0.45 * clamp(Math.abs(vF) / this.maxSpeed, 0, 1));
    const yaw = this.steerVis * 2.1 * speedFactor * Math.sign(vF) * (input.handbrake ? 1.45 : 1);
    this.heading -= yaw * dt;
    this.tilt += (-this.steerVis * clamp(Math.abs(vF) / 20, 0, 1) * 0.06 - this.tilt) * Math.min(1, dt * 6);

    // Integración con subpasos para no atravesar paredes
    const steps = Math.max(1, Math.ceil((this.speed * dt) / 0.4));
    const h = dt / steps;
    let impact = 0;
    for (let i = 0; i < steps; i++) {
      this.x += this.vx * h;
      this.z += this.vz * h;
      impact = Math.max(impact, this.collideWorld(grid));
    }
    this.lastImpact = impact;
    this.sync();
    return impact;
  }

  collideWorld(grid) {
    const fx = Math.sin(this.heading);
    const fz = Math.cos(this.heading);
    let impact = 0;
    for (const k of [this.half, -this.half, 0]) {
      const p = { x: this.x + fx * k, z: this.z + fz * k };
      const ox = p.x;
      const oz = p.z;
      const n = grid.resolveCircle(p, this.radius);
      if (n) {
        this.x += p.x - ox;
        this.z += p.z - oz;
        const vn = this.vx * n.x + this.vz * n.z;
        if (vn < 0) {
          this.vx -= 1.25 * vn * n.x;
          this.vz -= 1.25 * vn * n.z;
          // pérdida de velocidad por el golpe
          this.vx *= 0.82;
          this.vz *= 0.82;
          impact = Math.max(impact, -vn);
        }
      }
    }
    return impact;
  }

  sync() {
    this.mesh.position.set(this.x, 0, this.z);
    this.mesh.rotation.set(0, this.heading, 0);
    this.body.rotation.z = this.tilt;
  }

  updateSiren(dt) {
    if (!this.sirenL) return;
    if (!this.sirenOn) {
      this.sirenL.material = this.sirenR.material = sirenOff;
      return;
    }
    this.sirenT += dt;
    const on = Math.floor(this.sirenT * 6) % 2 === 0;
    this.sirenL.material = on ? sirenRed : sirenOff;
    this.sirenR.material = on ? sirenOff : sirenBlue;
  }

  // Conducción automática hacia un punto.
  autopilot(tx, tz, desired) {
    const dx = tx - this.x;
    const dz = tz - this.z;
    const target = Math.atan2(dx, dz);
    const d = angleDiff(this.heading, target);
    const steer = clamp(-d * 2.2, -1, 1);
    const fwd = this.forwardSpeed;
    // frena en curvas cerradas
    const want = desired * (1 - Math.min(0.75, Math.abs(d) / 1.6));
    const throttle = fwd < want ? 1 : fwd > want + 2 ? -0.6 : 0.1;
    return { steer, throttle, handbrake: false };
  }

  remove() {
    this.scene.remove(this.mesh);
  }
}

// Choques coche-coche (empuje + intercambio de velocidad)
export function collideCars(cars) {
  let hits = [];
  for (let i = 0; i < cars.length; i++) {
    const a = cars[i];
    for (let j = i + 1; j < cars.length; j++) {
      const b = cars[j];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const d2 = dx * dx + dz * dz;
      const R = 2.3;
      if (d2 > R * R || d2 < 1e-6) continue;
      const d = Math.sqrt(d2);
      const nx = dx / d;
      const nz = dz / d;
      const push = (R - d) / 2;
      a.x -= nx * push;
      a.z -= nz * push;
      b.x += nx * push;
      b.z += nz * push;
      const rv = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
      if (rv < 0) {
        const imp = -rv * 0.8;
        a.vx -= nx * imp;
        a.vz -= nz * imp;
        b.vx += nx * imp;
        b.vz += nz * imp;
        hits.push({ a, b, force: -rv });
      }
      a.sync();
      b.sync();
    }
  }
  return hits;
}
