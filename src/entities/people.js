import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { angleDiff, clamp } from '../geo.js';

// Personajes low-poly estilo muñeco: cuerpo+cabeza en una malla, piernas aparte
// para animar el paso. Sin violencia: los atropellos son "volteretas" cómicas.

const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
const cache = new Map();

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

const SHIRTS = ['#e63946', '#f1faee', '#2a9d8f', '#e9c46a', '#f4a261', '#8d6cab', '#457b9d', '#ffffff', '#ff7aa2'];
const PANTS = ['#264653', '#3d405b', '#5c4d3c', '#1d3557', '#6b705c'];
const SKIN = ['#f1c27d', '#e0ac69', '#c68642', '#ffdbac', '#8d5524'];
const HAIR = ['#2b1d14', '#5a3825', '#d9b25f', '#1a1a1a', '#a0522d', '#cccccc'];

function bodyGeo(shirt, skin, hair, scarf) {
  const key = [shirt, skin, hair, scarf].join();
  if (cache.has(key)) return cache.get(key);
  const parts = [
    part(new THREE.BoxGeometry(0.62, 0.72, 0.36), shirt, 0, 1.25, 0),
    part(new THREE.BoxGeometry(0.18, 0.62, 0.2), shirt, 0.41, 1.28, 0),
    part(new THREE.BoxGeometry(0.18, 0.62, 0.2), shirt, -0.41, 1.28, 0),
    part(new THREE.BoxGeometry(0.16, 0.14, 0.16), skin, 0.41, 0.92, 0),
    part(new THREE.BoxGeometry(0.16, 0.14, 0.16), skin, -0.41, 0.92, 0),
    part(new THREE.BoxGeometry(0.46, 0.46, 0.44), skin, 0, 1.86, 0),
    part(new THREE.BoxGeometry(0.5, 0.14, 0.48), hair, 0, 2.12, 0),
    part(new THREE.BoxGeometry(0.08, 0.08, 0.02), '#222', 0.11, 1.9, 0.225),
    part(new THREE.BoxGeometry(0.08, 0.08, 0.02), '#222', -0.11, 1.9, 0.225),
  ];
  if (scarf) parts.push(part(new THREE.BoxGeometry(0.5, 0.12, 0.4), scarf, 0, 1.6, 0.02));
  const g = mergeGeometries(parts, false);
  cache.set(key, g);
  return g;
}

function legGeo(color) {
  const key = 'leg' + color;
  if (cache.has(key)) return cache.get(key);
  const g = mergeGeometries([part(new THREE.BoxGeometry(0.24, 0.85, 0.26), color, 0, -0.42, 0), part(new THREE.BoxGeometry(0.26, 0.12, 0.34), '#2a2a2a', 0, -0.84, 0.04)], false);
  cache.set(key, g);
  return g;
}

export class Person {
  constructor(scene, opts = {}) {
    const r = Math.random;
    const pick = (a) => a[Math.floor(r() * a.length)];
    this.group = new THREE.Group();
    const shirt = opts.shirt || pick(SHIRTS);
    const pants = opts.pants || pick(PANTS);
    // Algunos peatones van "de blanco y rojo" (pañuelo rojo)
    const scarf = opts.scarf ?? (r() < 0.3 ? '#d62828' : null);
    this.body = new THREE.Mesh(bodyGeo(shirt, opts.skin || pick(SKIN), opts.hair || pick(HAIR), scarf), mat);
    this.legL = new THREE.Mesh(legGeo(pants), mat);
    this.legR = new THREE.Mesh(legGeo(pants), mat);
    this.legL.position.set(0.15, 0.9, 0);
    this.legR.position.set(-0.15, 0.9, 0);
    this.body.castShadow = true;
    this.inner = new THREE.Group();
    this.inner.add(this.body, this.legL, this.legR);
    this.group.add(this.inner);
    const s = opts.scale ?? 0.92 + r() * 0.14;
    this.inner.scale.setScalar(s);
    scene.add(this.group);
    this.scene = scene;
    this.x = opts.x || 0;
    this.z = opts.z || 0;
    this.y = 0;
    this.heading = opts.heading || 0;
    this.vx = 0;
    this.vz = 0;
    this.vy = 0;
    this.walkT = r() * 10;
    this.radius = 0.4;
    this.state = 'walk';
    this.stateT = 0;
    this.spin = 0;
  }

  // Movimiento con velocidad deseada (vx, vz) y colisión
  move(dt, grid, dvx, dvz) {
    this.vx += (dvx - this.vx) * Math.min(1, dt * 10);
    this.vz += (dvz - this.vz) * Math.min(1, dt * 10);
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    const p = { x: this.x, z: this.z };
    grid.resolveCircle(p, this.radius);
    this.x = p.x;
    this.z = p.z;
    const sp = Math.hypot(this.vx, this.vz);
    if (sp > 0.3) {
      const target = Math.atan2(this.vx, this.vz);
      this.heading += angleDiff(this.heading, target) * Math.min(1, dt * 12);
    }
    this.animate(dt, sp);
  }

  animate(dt, sp) {
    this.walkT += dt * (2 + sp * 1.7);
    const amp = clamp(sp / 4, 0, 1) * 0.7;
    this.legL.rotation.x = Math.sin(this.walkT) * amp;
    this.legR.rotation.x = -Math.sin(this.walkT) * amp;
    this.body.position.y = Math.abs(Math.sin(this.walkT)) * 0.05 * amp;
    this.sync();
  }

  // Volteretas cómicas al ser golpeado por un coche
  knock(vx, vz) {
    this.state = 'knocked';
    this.stateT = 0;
    this.vx = vx;
    this.vz = vz;
    this.vy = 5 + Math.random() * 2;
    this.spin = (Math.random() < 0.5 ? -1 : 1) * (8 + Math.random() * 6);
  }

  updateKnocked(dt, grid) {
    this.stateT += dt;
    if (this.y > 0 || this.vy > 0) {
      this.vy -= 18 * dt;
      this.y = Math.max(0, this.y + this.vy * dt);
      this.x += this.vx * dt;
      this.z += this.vz * dt;
      const p = { x: this.x, z: this.z };
      if (grid.resolveCircle(p, this.radius)) {
        this.vx *= -0.3;
        this.vz *= -0.3;
      }
      this.x = p.x;
      this.z = p.z;
      this.inner.rotation.x += this.spin * dt;
      if (this.y === 0 && this.vy < 0) {
        this.vy = 0;
        this.vx *= 0.3;
        this.vz *= 0.3;
      }
    } else {
      // tumbado un momento y se levanta
      this.inner.rotation.x += (-Math.PI / 2 - this.inner.rotation.x) * Math.min(1, dt * 10);
      this.x += this.vx * dt;
      this.z += this.vz * dt;
      this.vx *= 0.9;
      this.vz *= 0.9;
    }
    this.sync();
    if (this.stateT > 2.4) {
      this.inner.rotation.x = 0;
      this.y = 0;
      return true;
    }
    return false;
  }

  sync() {
    this.group.position.set(this.x, this.y, this.z);
    this.group.rotation.y = this.heading;
  }

  setVisible(v) {
    this.group.visible = v;
  }

  remove() {
    this.scene.remove(this.group);
  }
}
