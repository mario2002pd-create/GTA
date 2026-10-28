import * as THREE from 'three';
import { Car } from '../entities/car.js';
import { clamp } from '../geo.js';

// Misiones cortas: contrarreloj, persecución, carrera y fuga.
export const MISSIONS = [
  {
    id: 'encierro',
    name: 'El Encierro',
    type: 'Contrarreloj',
    color: '#ff4d4d',
    start: 'santodomingo',
    desc: 'Recorre el trayecto del encierro antes de que acabe el tiempo: Ayuntamiento → Mercaderes → Estafeta → Plaza de Toros.',
    checkpoints: ['ayuntamiento', 'mercaderes', 'estafeta', 'plazatoros'],
    speedRef: 8.5,
    reward: 500,
  },
  {
    id: 'txistorra',
    name: 'Reparto de txistorra',
    type: 'Contrarreloj',
    color: '#ffb703',
    start: 'mayor',
    desc: 'Lleva bocadillos de txistorra a los bares: Plaza del Castillo, Navarrería y Catedral. ¡Que no se enfríen!',
    checkpoints: ['castillo', 'navarreria', 'catedral'],
    speedRef: 8,
    reward: 400,
  },
  {
    id: 'ladron',
    name: 'El ladrón de txapelas',
    type: 'Persecución',
    color: '#4ade80',
    start: 'castillo',
    desc: 'Una furgoneta ha robado todas las txapelas de la tienda. ¡Embístela 3 veces para que se detenga!',
    reward: 600,
  },
  {
    id: 'carrera',
    name: 'Carrera de las murallas',
    type: 'Carrera',
    color: '#b388ff',
    start: 'taconera',
    desc: 'Carrera contra dos pilotos locales: Calle Mayor → Ayuntamiento → Navarrería → Catedral → Plaza del Castillo.',
    checkpoints: ['mayor', 'ayuntamiento', 'navarreria', 'catedral', 'castillo'],
    reward: 800,
  },
  {
    id: 'fuga',
    name: 'Fuga por la Navarrería',
    type: 'Despiste',
    color: '#4cc9f0',
    start: 'catedral',
    desc: 'Has aparcado en plena procesión... ¡Te buscan con 2 estrellas! Despista a la policía en menos de 2:30.',
    reward: 700,
  },
];

function makeBeacon(color, radius = 4) {
  const g = new THREE.Group();
  const col = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide });
  const cyl = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 26, 20, 1, true), col);
  cyl.position.y = 13;
  const ringMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(new THREE.RingGeometry(radius - 0.6, radius, 32), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.15;
  g.add(cyl, ring);
  g.userData = { cyl, ring, mat: col };
  return g;
}

export class Missions {
  constructor(game) {
    this.game = game;
    this.active = null;
    this.cooldown = 0;
    this.completed = new Set();
    try {
      for (const id of JSON.parse(localStorage.getItem('cvr-completed') || '[]')) this.completed.add(id);
    } catch {
      /* sin almacenamiento */
    }
    const g = game.carGraph;
    this.list = MISSIONS.map((m) => {
      const z = game.zones.byId[m.start];
      const n = g.nearest(z.x, z.z);
      const def = { ...m, sx: g.x[n], sz: g.z[n], node: n };
      def.beacon = makeBeacon(m.color, 4);
      def.beacon.position.set(def.sx, 0, def.sz);
      game.scene.add(def.beacon);
      return def;
    });
    this.cpBeacon = makeBeacon('#ffe14d', 6);
    this.cpBeacon.visible = false;
    game.scene.add(this.cpBeacon);
  }

  point(id) {
    const g = this.game.carGraph;
    const z = this.game.zones.byId[id];
    const n = g.nearest(z.x, z.z);
    return { x: g.x[n], z: g.z[n], node: n, name: z.name };
  }

  saveCompleted() {
    try {
      localStorage.setItem('cvr-completed', JSON.stringify([...this.completed]));
    } catch {
      /* sin almacenamiento */
    }
  }

  update(dt, t) {
    const game = this.game;
    const p = game.playerPos();
    for (const m of this.list) {
      m.beacon.visible = !this.active;
      m.beacon.userData.ring.rotation.z = t;
      m.beacon.userData.mat.opacity = 0.2 + Math.sin(t * 3) * 0.08;
    }
    this.cpBeacon.userData.mat.opacity = 0.25 + Math.sin(t * 4) * 0.1;
    this.cpBeacon.userData.ring.rotation.z = -t;
    this.cooldown -= dt;

    if (!this.active) {
      for (const m of this.list) {
        const d = Math.hypot(p.x - m.sx, p.z - m.sz);
        if (d < 4.5 && this.cooldown <= 0) {
          if (!game.player.car) {
            game.hud.hint(`${m.name}: necesitas un coche para empezar esta misión`);
          } else if (game.police.level > 0 && m.id !== 'fuga') {
            game.hud.hint('Despista primero a la policía para empezar una misión');
          } else {
            this.start(m);
          }
          break;
        }
      }
      return;
    }

    const a = this.active;
    a.time += dt;
    if (a.limit) {
      a.remaining = a.limit - a.time;
      if (a.remaining <= 0) return this.fail('¡Se acabó el tiempo!');
    }
    this[`update_${a.def.id}`]?.(dt, a);
    this.updateCheckpointBeacon();
  }

  start(def) {
    const game = this.game;
    this.active = { def, time: 0, cp: 0, limit: 0, remaining: 0 };
    const a = this.active;
    game.hud.toast(def.name, def.type + ' — ' + def.desc, 4.5);
    game.sfx.beep(880, 0.15, 'triangle');
    if (def.checkpoints) {
      a.points = def.checkpoints.map((id) => this.point(id));
    }
    if (def.id === 'encierro' || def.id === 'txistorra') {
      let len = 0;
      let prev = def.node;
      for (const q of a.points) {
        len += this.pathLength(prev, q.node);
        prev = q.node;
      }
      a.limit = Math.round(len / def.speedRef + 10);
    }
    if (def.id === 'ladron') this.setupThief(a);
    if (def.id === 'carrera') this.setupRace(a);
    if (def.id === 'fuga') {
      game.police.add(2, 'fuga');
      a.limit = 150;
    }
  }

  pathLength(a, b) {
    const g = this.game.carGraph;
    const path = g.path(a, b);
    if (!path) return Math.hypot(g.x[a] - g.x[b], g.z[a] - g.z[b]) * 1.4;
    let len = 0;
    for (let i = 1; i < path.length; i++) len += Math.hypot(g.x[path[i]] - g.x[path[i - 1]], g.z[path[i]] - g.z[path[i - 1]]);
    return len;
  }

  updateCheckpointBeacon() {
    const o = this.objective();
    if (o && this.active?.points) {
      this.cpBeacon.visible = true;
      this.cpBeacon.position.set(o.x, 0, o.z);
    } else this.cpBeacon.visible = false;
  }

  // Objetivo actual para la flecha del HUD y el minimapa
  objective() {
    const a = this.active;
    if (!a) return null;
    if (a.points && a.cp < a.points.length) return { ...a.points[a.cp], color: '#ffe14d' };
    if (a.thief) return { x: a.thief.x, z: a.thief.z, name: 'Furgoneta del ladrón', color: '#4ade80' };
    return null;
  }

  missionText() {
    const a = this.active;
    if (!a) return null;
    const d = a.def;
    let text = '';
    if (d.id === 'encierro' || d.id === 'txistorra') {
      text = `Punto ${a.cp + 1}/${a.points.length}: ${a.points[a.cp]?.name ?? ''}`;
    } else if (d.id === 'ladron') {
      text = `Embiste la furgoneta: ${a.hits}/3 golpes`;
    } else if (d.id === 'carrera') {
      text = a.countdown > 0 ? `Salida en ${Math.ceil(a.countdown)}...` : `Control ${Math.min(a.cp + 1, a.points.length)}/${a.points.length} · Posición ${this.racePosition(a)}º`;
    } else if (d.id === 'fuga') {
      text = 'Despista a la policía (sal de su vista)';
    }
    return { title: d.name, text, time: a.limit ? Math.max(0, a.remaining) : null };
  }

  checkpointReached(a, x, z, r = 7) {
    const q = a.points[a.cp];
    if (q && Math.hypot(x - q.x, z - q.z) < r) {
      a.cp++;
      this.game.sfx.beep(1046, 0.1, 'triangle');
      return true;
    }
    return false;
  }

  // ---- Contrarreloj ----
  update_encierro(dt, a) {
    const p = this.game.playerPos();
    if (this.checkpointReached(a, p.x, p.z)) {
      if (a.cp >= a.points.length) return this.succeed(`¡Llegaste a la Plaza de Toros con ${Math.ceil(a.remaining)} s de sobra!`);
      this.game.hud.hint(`¡Bien! Siguiente: ${a.points[a.cp].name}`);
    }
  }

  update_txistorra(dt, a) {
    const p = this.game.playerPos();
    if (this.checkpointReached(a, p.x, p.z)) {
      if (a.cp >= a.points.length) return this.succeed('¡Todas las txistorras entregadas calentitas!');
      this.game.hud.hint(`Entregado. Siguiente bar: ${a.points[a.cp].name}`);
    }
  }

  // ---- Persecución del ladrón ----
  setupThief(a) {
    const game = this.game;
    const g = game.carGraph;
    const p = game.playerPos();
    let ring = g.nodesInRing(p.x, p.z, 25, 50);
    if (!ring.length) ring = g.nodesInRing(p.x, p.z, 10, 120);
    const n = ring.length ? ring[Math.floor(Math.random() * ring.length)] : g.nearest(p.x, p.z);
    const thief = new Car(game.scene, { x: g.x[n], z: g.z[n], kind: 'van', color: '#2d2d34' });
    thief.driver = 'mission';
    thief.maxSpeed = 19;
    thief.ai = { path: null, pathI: 0, stuck: 0, reverse: 0, hitCooldown: 0 };
    game.allCars.push(thief);
    a.thief = thief;
    a.hits = 0;
    a.limit = 110;
  }

  update_ladron(dt, a) {
    const game = this.game;
    const thief = a.thief;
    const g = game.carGraph;
    const p = game.playerPos();
    const ai = thief.ai;
    const d = Math.hypot(thief.x - p.x, thief.z - p.z);
    if (d > 260) return this.fail('El ladrón se ha escapado...');
    ai.hitCooldown -= dt;
    if (!ai.path || ai.pathI >= ai.path.length) {
      // huye a un nodo lejano en dirección opuesta al jugador
      const ring = g.nodesInRing(thief.x, thief.z, 120, 220);
      let best = -1;
      let bestScore = -Infinity;
      for (let i = 0; i < 25 && ring.length; i++) {
        const n = ring[Math.floor(Math.random() * ring.length)];
        const score = Math.hypot(g.x[n] - p.x, g.z[n] - p.z) + Math.random() * 40;
        if (score > bestScore) {
          bestScore = score;
          best = n;
        }
      }
      ai.path = best >= 0 ? g.path(g.nearestVisible(thief.x, thief.z), best) : null;
      ai.pathI = ai.path ? g.trimStart(ai.path, thief.x, thief.z) : 0;
    }
    const speed = a.hits >= 3 ? 0 : 12 + (d > 60 ? -3 : 1);
    driveAlongPath(thief, ai, dt, game, speed);
  }

  onCarHit(a, b, force) {
    const act = this.active;
    if (!act || act.def.id !== 'ladron') return;
    const pc = this.game.player.car;
    const thief = act.thief;
    if (!pc || !((a === pc && b === thief) || (b === pc && a === thief))) return;
    if (force < 3 || thief.ai.hitCooldown > 0) return;
    thief.ai.hitCooldown = 0.8;
    act.hits++;
    this.game.camera.shake = 1;
    if (act.hits >= 3) {
      thief.vx *= 0.2;
      thief.vz *= 0.2;
      this.succeed('¡Furgoneta detenida! Las txapelas vuelven a la tienda.');
    } else {
      this.game.hud.hint(`¡Golpe! ${act.hits}/3`);
    }
  }

  // ---- Carrera ----
  setupRace(a) {
    const game = this.game;
    const g = game.carGraph;
    const p = game.playerPos();
    a.countdown = 3.5;
    a.rivals = [];
    // ruta completa (para los rivales)
    const route = [];
    let prev = g.nearestVisible(p.x, p.z);
    for (const q of a.points) {
      const seg = g.path(prev, q.node) || [q.node];
      route.push(...(route.length ? seg.slice(1) : seg));
      prev = q.node;
    }
    const near = g.nodesInRing(p.x, p.z, 6, 22);
    const colors = ['#ff006e', '#3a86ff'];
    for (let i = 0; i < 2; i++) {
      const n = near.length ? near[(i * 7) % near.length] : g.nearest(p.x, p.z);
      const car = new Car(game.scene, { x: g.x[n], z: g.z[n], kind: 'car', color: colors[i] });
      car.driver = 'mission';
      car.maxSpeed = 24;
      car.ai = { path: route.slice(), pathI: 0, stuck: 0, reverse: 0, cp: 0, skill: 0.9 + i * 0.08 };
      game.allCars.push(car);
      a.rivals.push(car);
    }
    a.finished = [];
  }

  update_carrera(dt, a) {
    const game = this.game;
    const p = game.playerPos();
    if (a.countdown > 0) {
      const before = Math.ceil(a.countdown);
      a.countdown -= dt;
      if (Math.ceil(a.countdown) !== before) game.sfx.beep(a.countdown <= 0 ? 1200 : 600, 0.15);
      game.freezeInput = a.countdown > 0;
      for (const r of a.rivals) r.update(dt, { throttle: 0, steer: 0, handbrake: true }, game.grid);
      return;
    }
    game.freezeInput = false;
    for (const r of a.rivals) {
      const q = a.points[r.ai.cp];
      if (q && Math.hypot(r.x - q.x, r.z - q.z) < 9) r.ai.cp++;
      if (r.ai.cp >= a.points.length) {
        if (!a.finished.includes(r)) a.finished.push(r);
        r.update(dt, { throttle: 0, steer: 0, handbrake: true }, game.grid);
        continue;
      }
      // goma elástica suave
      const lead = r.ai.cp - a.cp;
      const sp = (15 + (lead > 0 ? -3 : lead < 0 ? 3 : 0)) * r.ai.skill;
      driveAlongPath(r, r.ai, dt, game, sp);
    }
    if (this.checkpointReached(a, p.x, p.z, 8)) {
      if (a.cp >= a.points.length) {
        const pos = a.finished.length + 1;
        if (pos === 1) return this.succeed('¡Primero en la meta! Eres el rey de las murallas.');
        return this.fail(`Has llegado ${pos}º. ¡Inténtalo otra vez!`);
      }
      game.hud.hint(`Control superado. Siguiente: ${a.points[a.cp].name}`);
    }
    if (a.finished.length >= 2) return this.fail('Los dos rivales han llegado antes que tú.');
  }

  racePosition(a) {
    let pos = 1;
    const p = this.game.playerPos();
    const q = a.points[Math.min(a.cp, a.points.length - 1)];
    const myD = Math.hypot(p.x - q.x, p.z - q.z);
    for (const r of a.rivals) {
      if (r.ai.cp > a.cp) pos++;
      else if (r.ai.cp === a.cp && Math.hypot(r.x - q.x, r.z - q.z) < myD) pos++;
    }
    return pos;
  }

  // ---- Fuga ----
  update_fuga(dt, a) {
    if (a.time > 1 && this.game.police.level === 0) this.succeed('¡Libre! La procesión sigue sin ti.');
  }

  // ---- Fin de misión ----
  cleanup() {
    const a = this.active;
    if (!a) return;
    const game = this.game;
    if (a.thief) game.removeCar(a.thief);
    if (a.rivals) for (const r of a.rivals) game.removeCar(r);
    game.freezeInput = false;
    this.active = null;
    this.cpBeacon.visible = false;
    this.cooldown = 4;
  }

  succeed(msg) {
    const def = this.active.def;
    this.game.score += def.reward;
    this.completed.add(def.id);
    this.saveCompleted();
    this.game.hud.toast('¡MISIÓN SUPERADA!', `${msg}  +${def.reward} puntos`, 4);
    this.game.sfx.success();
    this.cleanup();
  }

  fail(msg) {
    if (!this.active) return;
    this.game.hud.toast('MISIÓN FALLIDA', msg, 3.5);
    this.game.sfx.fail();
    this.cleanup();
  }

  cancel() {
    if (this.active) this.fail('Misión cancelada.');
  }

  markers() {
    const out = [];
    if (!this.active) {
      for (const m of this.list) out.push({ x: m.sx, z: m.sz, color: m.color, label: m.name, done: this.completed.has(m.id), kind: 'mission' });
    }
    const o = this.objective();
    if (o) out.push({ x: o.x, z: o.z, color: o.color, label: o.name, kind: 'objective' });
    if (this.active?.rivals) for (const r of this.active.rivals) out.push({ x: r.x, z: r.z, color: r.color, kind: 'rival' });
    return out;
  }
}

// Conductor IA genérico que sigue una lista de nodos del grafo.
export function driveAlongPath(car, ai, dt, game, desired) {
  const g = game.carGraph;
  let tx = car.x;
  let tz = car.z;
  if (ai.path && ai.pathI < ai.path.length) {
    let n = ai.path[ai.pathI];
    while (ai.pathI < ai.path.length && Math.hypot(g.x[n] - car.x, g.z[n] - car.z) < 5) {
      ai.pathI++;
      n = ai.path[Math.min(ai.pathI, ai.path.length - 1)];
    }
    tx = g.x[n];
    tz = g.z[n];
  }
  let input = car.autopilot(tx, tz, desired);
  if (desired <= 0) input = { throttle: car.forwardSpeed > 0.5 ? -1 : 0, steer: 0, handbrake: true };
  if (ai.reverse > 0) {
    ai.reverse -= dt;
    input = { throttle: -1, steer: -input.steer, handbrake: false };
  } else if (desired > 0 && car.speed < 1.2) {
    ai.stuck += dt;
    if (ai.stuck > 1.3) {
      ai.stuck = 0;
      ai.reverse = 1;
    }
  } else ai.stuck = 0;
  input.steer = clamp(input.steer, -1, 1);
  car.update(dt, input, game.grid);
}
