import { Car, CAR_COLORS } from '../entities/car.js';
import { Person } from '../entities/people.js';
import { angleDiff } from '../geo.js';

// Agente que recorre el grafo de calles nodo a nodo.
export class GraphWalker {
  constructor(graph, node, rng = Math.random) {
    this.graph = graph;
    this.rng = rng;
    this.prev = -1;
    this.cur = node;
    this.next = this.pickNext();
  }

  pickNext() {
    const edges = this.graph.adj[this.cur].filter((e) => this.graph.valid[e.to]);
    if (!edges.length) return this.cur;
    const options = edges.filter((e) => e.to !== this.prev);
    const list = options.length ? options : edges;
    return list[Math.floor(this.rng() * list.length)].to;
  }

  advance() {
    this.prev = this.cur;
    this.cur = this.next;
    this.next = this.pickNext();
  }

  turnAround() {
    const p = this.prev;
    this.prev = this.next;
    this.next = p >= 0 ? p : this.pickNext();
  }

  target() {
    return [this.graph.x[this.next], this.graph.z[this.next]];
  }
}

const WIDE = new Set(['secondary', 'tertiary', 'primary', 'residential', 'busway']);

// ---------------- Tráfico ----------------
export class Traffic {
  constructor(game, count = 14) {
    this.game = game;
    this.cars = [];
    this.count = count;
  }

  spawnAround(px, pz, rMin, rMax) {
    const g = this.game.carGraph;
    const ring = g.nodesInRing(px, pz, rMin, rMax);
    if (!ring.length) return null;
    const n = ring[Math.floor(Math.random() * ring.length)];
    const w = new GraphWalker(g, n);
    const [tx, tz] = w.target();
    const r = Math.random();
    const kind = r < 0.12 ? 'van' : r < 0.22 ? 'taxi' : 'car';
    const car = new Car(this.game.scene, {
      x: g.x[n],
      z: g.z[n],
      heading: Math.atan2(tx - g.x[n], tz - g.z[n]),
      color: kind === 'taxi' ? '#f7f7f7' : CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)],
      kind,
    });
    car.driver = 'npc';
    car.ai = { walker: w, blocked: 0, cruise: 7 + Math.random() * 4 };
    this.cars.push(car);
    this.game.allCars.push(car);
    return car;
  }

  update(dt) {
    const game = this.game;
    const p = game.playerPos();
    // mantener la población alrededor del jugador
    while (this.cars.length < this.count) {
      if (!this.spawnAround(p.x, p.z, 60, 200)) break;
    }
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const car = this.cars[i];
      if (car.driver !== 'npc') {
        // el jugador lo ha robado o está abandonado
        this.cars.splice(i, 1);
        continue;
      }
      const d = Math.hypot(car.x - p.x, car.z - p.z);
      if (d > 280) {
        game.removeCar(car);
        this.cars.splice(i, 1);
        continue;
      }
      this.drive(car, dt);
    }
  }

  drive(car, dt) {
    const ai = car.ai;
    const w = ai.walker;
    const g = this.game.carGraph;
    let [tx, tz] = w.target();
    // carril derecho en calles anchas
    const edge = g.adj[w.cur].find((e) => e.to === w.next);
    if (edge && WIDE.has(edge.type)) {
      const dx = tx - g.x[w.cur];
      const dz = tz - g.z[w.cur];
      const l = Math.hypot(dx, dz) || 1;
      tx += (-dz / l) * -1.8;
      tz += (dx / l) * -1.8;
    }
    if (Math.hypot(tx - car.x, tz - car.z) < 3.2) {
      w.advance();
      [tx, tz] = w.target();
    }
    let desired = edge && WIDE.has(edge.type) ? ai.cruise + 3 : ai.cruise;
    // ¿algo delante? (coches, jugador, peatones)
    const fx = Math.sin(car.heading);
    const fz = Math.cos(car.heading);
    const ahead = this.game.obstacleAhead(car, fx, fz, 9);
    if (ahead) desired = 0;
    const input = car.autopilot(tx, tz, desired);
    if (ahead) input.throttle = car.forwardSpeed > 0.3 ? -1 : 0;
    if (ahead || car.speed < 0.5) ai.blocked += dt;
    else ai.blocked = Math.max(0, ai.blocked - dt);
    if (ai.blocked > 5) {
      // atasco: da media vuelta
      w.turnAround();
      ai.blocked = 0;
      car.heading += Math.PI;
    }
    car.update(dt, input, this.game.grid);
  }
}

// ---------------- Peatones ----------------
export class Crowd {
  constructor(game, count = 34) {
    this.game = game;
    this.people = [];
    this.count = count;
  }

  spawnAround(px, pz, rMin, rMax) {
    const g = this.game.walkGraph;
    const ring = g.nodesInRing(px, pz, rMin, rMax);
    if (!ring.length) return null;
    const n = ring[Math.floor(Math.random() * ring.length)];
    const per = new Person(this.game.scene, { x: g.x[n], z: g.z[n] });
    per.walker = new GraphWalker(g, n);
    per.offset = (Math.random() - 0.5) * 2.4;
    per.speed = 1.2 + Math.random() * 0.6;
    this.people.push(per);
    return per;
  }

  // peatón que sale corriendo (p. ej. conductor expulsado del coche)
  addRunner(x, z, fromX, fromZ) {
    const g = this.game.walkGraph;
    const n = g.nearestVisible(x, z);
    const per = new Person(this.game.scene, { x, z });
    per.walker = new GraphWalker(g, n);
    per.offset = 0;
    per.speed = 1.4;
    per.state = 'flee';
    per.stateT = 6;
    per.fleeFrom = { x: fromX, z: fromZ };
    this.people.push(per);
    return per;
  }

  update(dt) {
    const game = this.game;
    const p = game.playerPos();
    while (this.people.length < this.count) {
      if (!this.spawnAround(p.x, p.z, 25, 140)) break;
    }
    const grid = game.grid;
    for (let i = this.people.length - 1; i >= 0; i--) {
      const per = this.people[i];
      const d = Math.hypot(per.x - p.x, per.z - p.z);
      if (d > 190 && per.state !== 'knocked') {
        per.remove();
        this.people.splice(i, 1);
        continue;
      }
      if (per.state === 'knocked') {
        if (per.updateKnocked(dt, grid)) {
          per.state = 'flee';
          per.stateT = 5;
          per.fleeFrom = { x: p.x, z: p.z };
        }
        continue;
      }
      // ¿me van a atropellar?
      for (const car of game.allCars) {
        const sp = car.speed;
        if (sp < 3) continue;
        const dx = per.x - car.x;
        const dz = per.z - car.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 1.9 && sp > 4) {
          per.knock(car.vx * 0.7 + (dx / dist) * 3, car.vz * 0.7 + (dz / dist) * 3);
          game.onPedestrianHit(per, car);
          break;
        }
        if (dist < 10 && per.state !== 'dodge') {
          const along = (dx * car.vx + dz * car.vz) / sp;
          if (along > 0 && along < 10) {
            const lateral = Math.abs((dx * car.vz - dz * car.vx) / sp);
            if (lateral < 1.8 && Math.random() < 0.08) {
              per.state = 'dodge';
              per.stateT = 0.6;
              const side = (dx * car.vz - dz * car.vx) / sp > 0 ? 1 : -1;
              per.dodge = { x: (car.vz / sp) * side * 6, z: (-car.vx / sp) * side * 6 };
              per.vy = 3.5;
            }
          }
        }
      }
      if (per.state === 'dodge') {
        per.stateT -= dt;
        per.vy -= 14 * dt;
        per.y = Math.max(0, per.y + per.vy * dt);
        per.move(dt, grid, per.dodge.x, per.dodge.z);
        if (per.stateT <= 0) {
          per.state = 'walk';
          per.y = 0;
        }
        continue;
      }
      if (per.state === 'flee') {
        per.stateT -= dt;
        const fx = per.x - per.fleeFrom.x;
        const fz = per.z - per.fleeFrom.z;
        const l = Math.hypot(fx, fz) || 1;
        per.move(dt, grid, (fx / l) * 5, (fz / l) * 5);
        if (per.stateT <= 0) {
          per.state = 'walk';
          per.walker = new GraphWalker(game.walkGraph, game.walkGraph.nearestVisible(per.x, per.z));
        }
        continue;
      }
      // pasear por el grafo
      const w = per.walker;
      const g = w.graph;
      let tx = g.x[w.next];
      let tz = g.z[w.next];
      const dx0 = tx - g.x[w.cur];
      const dz0 = tz - g.z[w.cur];
      const l0 = Math.hypot(dx0, dz0) || 1;
      tx += (-dz0 / l0) * per.offset;
      tz += (dx0 / l0) * per.offset;
      const dx = tx - per.x;
      const dz = tz - per.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 1.2) {
        w.advance();
      } else {
        per.move(dt, grid, (dx / dist) * per.speed, (dz / dist) * per.speed);
      }
    }
  }

  panic(x, z, r) {
    for (const per of this.people) {
      if (per.state === 'walk' && Math.hypot(per.x - x, per.z - z) < r) {
        per.state = 'flee';
        per.stateT = 3 + Math.random() * 2;
        per.fleeFrom = { x, z };
      }
    }
  }
}

export { angleDiff };
