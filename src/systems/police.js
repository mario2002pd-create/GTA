import { Car } from '../entities/car.js';
import { clamp } from '../geo.js';

// Nivel de búsqueda (0–3 estrellas), patrullas que persiguen al jugador por el
// grafo de calles y mecánica para despistarlas (salir de su campo de visión).
const COPS_PER_LEVEL = [0, 2, 3, 5];

export class Police {
  constructor(game) {
    this.game = game;
    this.level = 0;
    this.cars = [];
    this.evadeT = 0;
    this.bustT = 0;
    this.seen = false;
    this.lastSeen = null;
    this.spawnCooldown = 0;
  }

  get evadeNeeded() {
    return 7 + this.level * 4;
  }

  get evading() {
    return this.level > 0 && !this.seen;
  }

  add(n, reason) {
    const before = this.level;
    this.level = clamp(Math.max(this.level, 0) + n, 1, 3);
    this.evadeT = 0;
    if (this.level !== before) {
      this.game.hud.flash(`${'★'.repeat(this.level)} ¡Te busca la policía! (${reason})`);
      this.game.sfx.beep(660, 0.1);
    }
    const p = this.game.playerPos();
    this.lastSeen = { x: p.x, z: p.z };
  }

  clear() {
    this.level = 0;
    this.evadeT = 0;
    this.bustT = 0;
    for (const c of this.cars) {
      c.sirenOn = false;
      c.updateSiren(0);
      c.ai.mode = 'leave';
    }
  }

  spawn() {
    const g = this.game.carGraph;
    const p = this.game.playerPos();
    let ring = g.nodesInRing(p.x, p.z, 80, 150);
    // preferimos aparecer fuera de la vista del jugador
    const hidden = ring.filter((n) => this.game.grid.raycast(p.x, p.z, g.x[n], g.z[n], 1) < 1);
    if (hidden.length) ring = hidden;
    if (!ring.length) return;
    const n = ring[Math.floor(Math.random() * ring.length)];
    const car = new Car(this.game.scene, { x: g.x[n], z: g.z[n], heading: Math.atan2(p.x - g.x[n], p.z - g.z[n]), kind: 'police' });
    car.driver = 'police';
    car.ai = { mode: 'chase', path: null, pathI: 0, repath: 0, stuck: 0, reverse: 0 };
    car.sirenOn = true;
    this.cars.push(car);
    this.game.allCars.push(car);
  }

  update(dt) {
    const game = this.game;
    const p = game.playerPos();
    const grid = game.grid;
    this.spawnCooldown -= dt;
    const want = COPS_PER_LEVEL[this.level];
    const active = this.cars.filter((c) => c.ai.mode === 'chase' && c.driver === 'police');
    if (active.length < want && this.spawnCooldown <= 0) {
      this.spawn();
      this.spawnCooldown = 2.5;
    }

    // ¿Algún agente ve al jugador?
    this.seen = false;
    let closest = Infinity;
    for (const c of this.cars) {
      if (c.driver !== 'police') continue;
      const d = Math.hypot(c.x - p.x, c.z - p.z);
      closest = Math.min(closest, d);
      if (this.level > 0 && (d < 14 || (d < 75 && grid.raycast(c.x, c.z, p.x, p.z, 1 | 2) >= 1))) {
        this.seen = true;
      }
    }
    if (this.level > 0) {
      if (this.seen) {
        this.evadeT = Math.max(0, this.evadeT - dt * 2);
        this.lastSeen = { x: p.x, z: p.z };
      } else {
        this.evadeT += dt;
        if (this.evadeT >= this.evadeNeeded) {
          this.level--;
          this.evadeT = 0;
          if (this.level === 0) {
            game.hud.flash('¡Has despistado a la policía!');
            game.sfx.success();
            this.clear();
          } else {
            game.hud.flash(`Bajas a ${this.level} ${this.level === 1 ? 'estrella' : 'estrellas'}`);
          }
        }
      }
      // Detención: policía muy cerca y jugador casi parado
      const sp = game.playerSpeed();
      if (closest < 6 && sp < 2.5) this.bustT += dt;
      else this.bustT = Math.max(0, this.bustT - dt);
      if (this.bustT > 2.2) {
        this.bustT = 0;
        game.busted();
      }
    }

    for (let i = this.cars.length - 1; i >= 0; i--) {
      const car = this.cars[i];
      if (car.driver !== 'police') {
        // el jugador se ha llevado el coche patrulla
        this.cars.splice(i, 1);
        continue;
      }
      const d = Math.hypot(car.x - p.x, car.z - p.z);
      if (car.ai.mode === 'leave' || this.level === 0) {
        car.ai.mode = 'leave';
        car.sirenOn = false;
        if (d > 70 || grid.raycast(car.x, car.z, p.x, p.z, 1) < 1) {
          game.removeCar(car);
          this.cars.splice(i, 1);
          continue;
        }
        car.update(dt, { throttle: 0, steer: 0, handbrake: true }, grid);
        car.updateSiren(dt);
        continue;
      }
      // Patrulla demasiado lejos o sobrante: se retira
      if (d > 320 || active.indexOf(car) >= want) {
        game.removeCar(car);
        this.cars.splice(i, 1);
        continue;
      }
      this.chase(car, dt, d);
      car.updateSiren(dt);
    }
  }

  chase(car, dt, d) {
    const game = this.game;
    const g = game.carGraph;
    const p = game.playerPos();
    const ai = car.ai;
    const grid = game.grid;
    const los = d < 45 && grid.raycast(car.x, car.z, p.x, p.z, 1 | 2) >= 1;
    let tx;
    let tz;
    if (los) {
      // persecución directa con un poco de anticipación
      const pv = game.player.car ? { x: game.player.car.vx, z: game.player.car.vz } : { x: 0, z: 0 };
      tx = p.x + pv.x * 0.4;
      tz = p.z + pv.z * 0.4;
      ai.path = null;
    } else {
      ai.repath -= dt;
      if (!ai.path || ai.repath <= 0) {
        ai.repath = 1.3;
        ai.path = g.path(g.nearestVisible(car.x, car.z), g.nearestVisible(p.x, p.z), 6000);
        ai.pathI = ai.path ? g.trimStart(ai.path, car.x, car.z) : 0;
      }
      if (ai.path && ai.pathI < ai.path.length) {
        let n = ai.path[ai.pathI];
        while (ai.pathI < ai.path.length - 1 && Math.hypot(g.x[n] - car.x, g.z[n] - car.z) < 5) {
          ai.pathI++;
          n = ai.path[ai.pathI];
        }
        tx = g.x[n];
        tz = g.z[n];
      } else {
        tx = p.x;
        tz = p.z;
      }
    }
    const desired = clamp(12 + this.level * 4 + (d > 120 ? 6 : 0), 10, car.maxSpeed);
    let input = car.autopilot(tx, tz, d < 8 ? 6 : desired);
    // atascado contra una pared: marcha atrás un momento
    if (ai.reverse > 0) {
      ai.reverse -= dt;
      input = { throttle: -1, steer: -input.steer, handbrake: false };
    } else if (car.speed < 1.2 && d > 7) {
      ai.stuck += dt;
      if (ai.stuck > 1.4) {
        ai.stuck = 0;
        ai.reverse = 1.1;
        ai.path = null;
      }
    } else ai.stuck = 0;
    car.update(dt, input, grid);
  }

  removeAll() {
    for (const c of this.cars) this.game.removeCar(c);
    this.cars = [];
  }
}
