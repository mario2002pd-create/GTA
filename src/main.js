import './style.css';
import * as THREE from 'three';
import data from '../data/casco-viejo.json';
import { buildCity } from './world/city.js';
import { buildLandmarks } from './world/landmarks.js';
import { RoadGraph, CAR_TYPES, WALK_TYPES } from './world/roadgraph.js';
import { Car, CAR_COLORS, collideCars } from './entities/car.js';
import { Person } from './entities/people.js';
import { Traffic, Crowd } from './systems/traffic.js';
import { Police } from './systems/police.js';
import { Missions } from './systems/missions.js';
import { Hud } from './ui/hud.js';
import { Input } from './input.js';
import { CameraRig } from './camera.js';
import { Sfx } from './audio.js';
import { clamp } from './geo.js';

// Cúpula de cielo con degradado, halo del sol y nubes suaves (shader propio).
function makeSky() {
  const geo = new THREE.SphereGeometry(800, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color('#4f8fd6') },
      horizon: { value: new THREE.Color('#f6dcb6') },
      sunDir: { value: new THREE.Vector3(-70, 85, 55).normalize() },
    },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position.z = gl_Position.w; }`,
    fragmentShader: `
      uniform vec3 top; uniform vec3 horizon; uniform vec3 sunDir; varying vec3 vDir;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
        return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
      void main(){
        vec3 d = normalize(vDir);
        float t = clamp(d.y * 1.6, 0.0, 1.0);
        vec3 col = mix(horizon, top, pow(t, 0.7));
        float s = max(dot(d, sunDir), 0.0);
        col += vec3(1.0, 0.8, 0.55) * (pow(s, 8.0) * 0.35 + pow(s, 400.0) * 3.0);
        if (d.y > 0.02) {
          vec2 p = d.xz / (d.y + 0.15) * 2.2;
          float c = n(p) * 0.6 + n(p * 2.3) * 0.3 + n(p * 5.1) * 0.1;
          c = smoothstep(0.55, 0.85, c) * smoothstep(0.02, 0.25, d.y);
          col = mix(col, vec3(1.0, 0.97, 0.93), c * 0.75);
        }
        if (d.y < 0.0) col = horizon * 0.95;
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const m = new THREE.Mesh(geo, mat);
  m.frustumCulled = false;
  m.renderOrder = -1;
  return m;
}

class Game {
  constructor() {
    const canvas = document.getElementById('game');
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog('#f3d9b8', 170, 560);
    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.3, 900);
    this.sky = makeSky();
    this.scene.add(this.sky);

    // Luz de tarde dorada: cielo azul claro + sol bajo y cálido
    const hemi = new THREE.HemisphereLight('#cfe3ff', '#a08a68', 1.5);
    this.scene.add(hemi);
    this.sunOffset = new THREE.Vector3(-70, 85, 55);
    this.sun = new THREE.DirectionalLight('#ffd9a8', 3.1);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -85;
    sc.right = 85;
    sc.top = 85;
    sc.bottom = -85;
    sc.near = 1;
    sc.far = 260;
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.35;
    this.sun.shadow.radius = 2.5;
    this.scene.add(this.sun, this.sun.target);

    // ---- Mundo ----
    this.city = buildCity(this.scene, data);
    this.grid = this.city.grid;
    this.zones = buildLandmarks(this.scene, this.city);
    // Los coches solo usan tramos con hueco suficiente entre fachadas
    this.carGraph = new RoadGraph(data.streets, CAR_TYPES, this.grid, 1.2);
    this.walkGraph = new RoadGraph(data.streets, WALK_TYPES, this.grid, 0.5);
    this.buildNameIndex();

    // ---- Entidades ----
    this.allCars = [];
    this.score = 0;
    this.freezeInput = false;
    const castillo = this.zones.byId.castillo;
    // Punto de inicio: junto a un coche aparcado al lado de la Plaza del Castillo
    const cn = this.carGraph.nearest(castillo.x + 14, castillo.z + 10);
    this.spawnNode = cn;
    const sp = { x: this.carGraph.x[cn] + 2.6, z: this.carGraph.z[cn] + 1.5 };
    this.grid.resolveCircle(sp, 0.5);
    this.spawnPoint = sp;
    this.player = {
      person: new Person(this.scene, { x: this.spawnPoint.x, z: this.spawnPoint.z, shirt: '#ffffff', pants: '#ffffff', scarf: '#d62828', skin: '#f1c27d', hair: '#3b2416', scale: 1 }),
      car: null,
    };
    this.spawnParkedCars();

    this.input = new Input(canvas);
    this.cameraRig = new CameraRig(this.camera);
    this.sfx = new Sfx();
    this.traffic = new Traffic(this, 14);
    this.crowd = new Crowd(this, 36);
    this.police = new Police(this);
    this.hud = new Hud(this);
    this.missions = new Missions(this);

    this.timer = new THREE.Timer();
    this.time = 0;
    this.fpsAcc = { t: 0, n: 0, low: 0 };
    this.running = false;
    window.addEventListener('resize', () => this.onResize());
  }

  // ---------- utilidades ----------
  playerPos() {
    return this.player.car || this.player.person;
  }

  playerSpeed() {
    return this.player.car ? this.player.car.speed : Math.hypot(this.player.person.vx, this.player.person.vz);
  }

  spawnParkedCars() {
    const g = this.carGraph;
    const place = (n, color, kind = 'car') => {
      const e = g.adj[n].find((ed) => g.valid[ed.to]);
      const h = e ? Math.atan2(g.x[e.to] - g.x[n], g.z[e.to] - g.z[n]) : 0;
      const car = new Car(this.scene, { x: g.x[n], z: g.z[n], heading: h, color, kind });
      this.allCars.push(car);
      return car;
    };
    // un coche junto al punto de inicio
    place(this.spawnNode, '#e63946');
    // Solo aparcamos donde hay sitio (plazas y calles anchas) para no taponar callejuelas
    const roomy = (n) => this.grid.clearance(g.x[n], g.z[n], 5, 3) >= 4.5;
    // uno junto a cada inicio de misión y algunos repartidos
    for (const id of ['santodomingo', 'mayor', 'taconera', 'catedral']) {
      const z = this.zones.byId[id];
      const ring = g.nodesInRing(z.x, z.z, 12, 60).filter(roomy);
      if (ring.length) place(ring[0], CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)]);
    }
    for (let i = 0, tries = 0; i < 10 && tries < 400; tries++) {
      const n = g.randomNode();
      if (!roomy(n)) continue;
      place(n, CAR_COLORS[i % CAR_COLORS.length], i % 4 === 0 ? 'van' : 'car');
      i++;
    }
  }

  buildNameIndex() {
    this.names = new Map();
    for (const s of this.city.streets) {
      if (!s.name) continue;
      for (let i = 1; i < s.pts.length; i++) {
        const a = s.pts[i - 1];
        const b = s.pts[i];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        for (let d = 0; d <= len; d += 5) {
          const x = a[0] + ((b[0] - a[0]) * d) / (len || 1);
          const z = a[1] + ((b[1] - a[1]) * d) / (len || 1);
          const k = Math.floor(x / 20) + ',' + Math.floor(z / 20);
          if (!this.names.has(k)) this.names.set(k, []);
          this.names.get(k).push([x, z, s.name, s.type]);
        }
      }
    }
  }

  locationName() {
    const p = this.playerPos();
    let best = null;
    let bestD = 22;
    const i = Math.floor(p.x / 20);
    const j = Math.floor(p.z / 20);
    for (let a = i - 1; a <= i + 1; a++) {
      for (let b = j - 1; b <= j + 1; b++) {
        for (const q of this.names.get(a + ',' + b) || []) {
          // preferimos calles a sendas
          const d = Math.hypot(q[0] - p.x, q[1] - p.z) + (q[3] === 'footway' ? 4 : 0);
          if (d < bestD) {
            bestD = d;
            best = q[2];
          }
        }
      }
    }
    let zone = null;
    for (const z of this.zones.zones) {
      if (z.street) continue;
      if (Math.hypot(z.x - p.x, z.z - p.z) < z.r) {
        zone = z.name;
        break;
      }
    }
    if (best && zone && best !== zone) return `${best} · ${zone}`;
    return best || zone || 'Casco Viejo de Pamplona';
  }

  removeCar(car) {
    car.remove();
    const i = this.allCars.indexOf(car);
    if (i >= 0) this.allCars.splice(i, 1);
  }

  // ¿Hay algo justo delante de un coche IA?
  obstacleAhead(car, fx, fz, dist) {
    const test = (x, z, w) => {
      const dx = x - car.x;
      const dz = z - car.z;
      const along = dx * fx + dz * fz;
      if (along <= 0.5 || along > dist) return false;
      const lat = Math.abs(dx * fz - dz * fx);
      return lat < w;
    };
    for (const c of this.allCars) if (c !== car && test(c.x, c.z, 2.2)) return true;
    if (!this.player.car && test(this.player.person.x, this.player.person.z, 1.6)) return true;
    for (const p of this.crowd.people) if (p.state === 'walk' && test(p.x, p.z, 1.4)) return true;
    return false;
  }

  onPedestrianHit(per, car) {
    this.sfx.boing();
    this.crowd.panic(per.x, per.z, 18);
    if (car === this.player.car) {
      this.score = Math.max(0, this.score - 10);
      this.hitCount = (this.hitCount || 0) + 1;
      if (this.police.level === 0 || this.hitCount >= 3) {
        this.hitCount = 0;
        this.police.add(1, 'atropellar a un peatón');
      }
      this.hud.hint('¡Uy! ¡Cuidado con los peatones!');
    }
  }

  busted() {
    this.hud.toast('¡DETENIDO!', 'La policía te ha pillado. Vuelves a la Plaza del Castillo (−100 pts).', 3.5);
    this.sfx.fail();
    if (this.missions.active) this.missions.cleanup();
    this.police.clear();
    this.police.removeAll();
    this.score = Math.max(0, this.score - 100);
    if (this.player.car) this.exitCar(true);
    const pp = this.player.person;
    pp.x = this.spawnPoint.x;
    pp.z = this.spawnPoint.z;
    pp.vx = pp.vz = 0;
    pp.sync();
    this.cameraRig.first = true;
  }

  // ---------- entrar / salir del coche ----------
  tryEnterCar() {
    const pp = this.player.person;
    let best = null;
    let bestD = 4;
    for (const c of this.allCars) {
      if (c.driver === 'mission') continue;
      const d = Math.hypot(c.x - pp.x, c.z - pp.z);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    if (!best) return false;
    if (best.driver === 'npc') {
      this.crowd.addRunner(best.x + Math.cos(best.heading) * 1.5, best.z - Math.sin(best.heading) * 1.5, pp.x, pp.z);
      this.police.add(1, 'robar un coche');
      this.hud.hint('¡Coche "tomado prestado"!');
    } else if (best.driver === 'police') {
      this.police.add(2, 'robar un coche patrulla');
      best.sirenOn = false;
      best.updateSiren(0);
    }
    best.driver = 'player';
    best.ai = null;
    this.player.car = best;
    pp.setVisible(false);
    this.sfx.beep(440, 0.08, 'triangle');
    return true;
  }

  exitCar(force = false) {
    const car = this.player.car;
    if (!car) return;
    if (!force && car.speed > 6) {
      this.hud.hint('Frena antes de bajarte');
      return;
    }
    const pp = this.player.person;
    // sale por el lado izquierdo (o el derecho si no cabe)
    const lx = Math.cos(car.heading);
    const lz = -Math.sin(car.heading);
    let ok = false;
    for (const side of [-1, 1]) {
      const x = car.x + lx * 1.8 * side;
      const z = car.z + lz * 1.8 * side;
      if (this.grid.raycast(car.x, car.z, x, z, 1 | 2) >= 1) {
        pp.x = x;
        pp.z = z;
        ok = true;
        break;
      }
    }
    if (!ok) {
      pp.x = car.x;
      pp.z = car.z;
    }
    pp.vx = pp.vz = 0;
    pp.heading = car.heading;
    pp.setVisible(true);
    pp.sync();
    car.driver = null;
    this.player.car = null;
  }

  resetCar() {
    const car = this.player.car;
    if (!car) return;
    const g = this.carGraph;
    const n = g.nearest(car.x, car.z);
    const e = g.adj[n].find((ed) => g.valid[ed.to]);
    car.x = g.x[n];
    car.z = g.z[n];
    car.vx = car.vz = 0;
    if (e) car.heading = Math.atan2(g.x[e.to] - car.x, g.z[e.to] - car.z);
    car.sync();
    this.hud.hint('Coche recolocado en la calle');
  }

  // ---------- bucle ----------
  update(dt) {
    const input = this.input;
    this.time += dt;
    if (input.hit('KeyM')) this.hud.toggleBigMap();
    if (input.hit('KeyH', 'Escape')) this.setPaused(true);
    if (input.hit('KeyN')) this.sfx.setMuted(!this.sfx.muted);
    if (input.hit('KeyF')) document.getElementById('fps').hidden = !document.getElementById('fps').hidden;
    if (input.hit('KeyQ')) this.toggleQuality();
    if (input.hit('KeyX')) this.missions.cancel();
    if (input.hit('KeyR')) this.resetCar();
    if (input.hit('KeyE', 'Enter')) {
      if (this.player.car) this.exitCar();
      else this.tryEnterCar();
    }

    const ax = this.freezeInput ? { x: 0, y: 0 } : input.axis();
    const pc = this.player.car;
    if (pc) {
      const impact = pc.update(dt, { throttle: ax.y, steer: ax.x, handbrake: input.down('Space') }, this.grid);
      if (impact > 3) {
        this.sfx.bump(impact);
        this.cameraRig.shake = Math.min(1, impact / 15);
      }
    } else {
      const pp = this.player.person;
      const f = this.cameraRig.forward();
      const rx = -f.z;
      const rz = f.x;
      const run = input.down('ShiftLeft', 'ShiftRight') ? 8 : 4.2;
      let mx = (f.x * ax.y + rx * ax.x) * run;
      let mz = (f.z * ax.y + rz * ax.x) * run;
      const l = Math.hypot(mx, mz);
      if (l > run) {
        mx *= run / l;
        mz *= run / l;
      }
      pp.move(dt, this.grid, mx, mz);
      // que no nos atraviesen los coches
      for (const c of this.allCars) {
        const dx = pp.x - c.x;
        const dz = pp.z - c.z;
        const d = Math.hypot(dx, dz);
        if (d < 1.7 && d > 1e-3) {
          pp.x = c.x + (dx / d) * 1.7;
          pp.z = c.z + (dz / d) * 1.7;
        }
      }
      // indicador para entrar en un coche
      const near = this.allCars.some((c) => c.driver !== 'mission' && Math.hypot(c.x - pp.x, c.z - pp.z) < 4);
      this.setPrompt(near ? 'Pulsa E para subir al coche' : '');
    }
    if (pc) this.setPrompt('');

    // coches aparcados / abandonados que aún se deslizan
    for (const c of this.allCars) {
      if (c.driver === null && c.speed > 0.05) c.update(dt, { throttle: 0, steer: 0, handbrake: true }, this.grid);
    }
    this.traffic.update(dt);
    this.crowd.update(dt);
    this.police.update(dt);
    this.missions.update(dt, this.time);

    for (const h of collideCars(this.allCars)) {
      this.missions.onCarHit(h.a, h.b, h.force);
      const pcar = this.player.car;
      if (pcar && (h.a === pcar || h.b === pcar)) {
        this.sfx.bump(h.force * 2);
        this.cameraRig.shake = Math.min(1, h.force / 10);
        const other = h.a === pcar ? h.b : h.a;
        // solo cuenta si eres tú quien embiste
        if (other.driver === 'police' && h.force > 6 && pcar.speed > other.speed + 2 && ax.y > 0.3) this.police.add(1, 'embestir a la policía');
      }
    }

    // cámara, sol y HUD
    const target = this.playerPos();
    this.cameraRig.update(dt, target, input, this.grid, !!this.player.car);
    this.sun.position.set(target.x + this.sunOffset.x, this.sunOffset.y, target.z + this.sunOffset.z);
    this.sky.position.set(target.x, 0, target.z);
    this.sun.target.position.set(target.x, 0, target.z);
    this.hud.update(dt, this.time);
    const siren = this.police.cars.reduce((m, c) => (c.sirenOn ? Math.max(m, 1 - Math.hypot(c.x - target.x, c.z - target.z) / 120) : m), 0);
    this.sfx.update(this.time, { engineOn: !!this.player.car, speed: this.player.car ? Math.abs(this.player.car.forwardSpeed) : 0, sirenLevel: clamp(siren, 0, 1) });
    input.endFrame();
  }

  setPaused(p) {
    this.paused = p;
    document.getElementById('menu').hidden = !p;
    if (p && document.pointerLockElement) document.exitPointerLock();
    this.input.keys.clear();
  }

  setPrompt(text) {
    if (text === this._prompt) return;
    this._prompt = text;
    const el = document.getElementById('prompt');
    el.textContent = text;
    el.hidden = !text;
  }

  toggleQuality(low) {
    this.lowQuality = low ?? !this.lowQuality;
    this.renderer.setPixelRatio(this.lowQuality ? 1 : this.pixelRatio);
    this.renderer.shadowMap.enabled = !this.lowQuality;
    this.scene.traverse((o) => {
      if (o.material) o.material.needsUpdate = true;
    });
    this.hud.hint(this.lowQuality ? 'Calidad: rendimiento' : 'Calidad: alta');
  }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  frame = () => {
    requestAnimationFrame(this.frame);
    this.timer.update();
    const dt = Math.min(this.timer.getDelta(), 0.05);
    if (this.running && !this.paused) this.update(dt);
    else if (!this.running) {
      // presentación: recorrido de cámara por los hitos del Casco Viejo
      this.time += dt;
      this.introShot(this.time);
    }
    this.renderer.render(this.scene, this.camera);
    this.measureFps(dt);
  };

  measureFps(dt) {
    const f = this.fpsAcc;
    f.t += dt;
    f.n++;
    if (f.t >= 1) {
      const fps = Math.round(f.n / f.t);
      document.getElementById('fps').textContent = `${fps} fps · ${this.renderer.info.render.calls} draw calls`;
      // si va justo, bajamos la calidad automáticamente una vez
      if (this.running && !this.autoLowered && fps < 40) {
        f.low++;
        if (f.low >= 4) {
          this.autoLowered = true;
          this.toggleQuality(true);
        }
      } else f.low = 0;
      f.t = 0;
      f.n = 0;
    }
  }

  // Planos de presentación (menú): cada uno dura unos segundos con un travelling suave
  introShot(t) {
    if (!this.shots) {
      const z = this.zones.byId;
      this.shots = [];
      for (const id of ['ayuntamiento', 'catedral', 'saturnino']) {
        const v = z[id]?.view;
        if (v) this.shots.push({ cam: v.cam, look: v.look, drift: 0.25 });
      }
      const c = z.castillo;
      this.shots.splice(1, 0, { orbit: [c.x, c.z], r: 70, y: 28 });
      const e = z.estafeta;
      const st = this.city.streets.filter((s) => /estafeta/i.test(s.name || '')).sort((a, b) => b.pts.length - a.pts.length)[0];
      if (st && st.pts.length > 1) {
        const a = st.pts[0];
        const b = st.pts[st.pts.length - 1];
        this.shots.push({ cam: [a[0], 2.2, a[1]], look: [b[0], 3, b[1]], dolly: true });
      } else if (e) this.shots.push({ orbit: [e.x, e.z], r: 30, y: 12 });
      this.shots.push({ orbit: [c.x, c.z], r: 260, y: 140 });
    }
    const dur = 7;
    const i = Math.floor(t / dur) % this.shots.length;
    const k = (t % dur) / dur;
    const s = this.shots[i];
    let cx;
    let cy;
    let cz;
    let lx;
    let ly;
    let lz;
    if (s.orbit) {
      const a = t * 0.06 + i;
      cx = s.orbit[0] + Math.sin(a) * s.r;
      cz = s.orbit[1] + Math.cos(a) * s.r;
      cy = s.y;
      lx = s.orbit[0];
      ly = 2;
      lz = s.orbit[1];
    } else {
      const dx = s.look[0] - s.cam[0];
      const dz = s.look[2] - s.cam[2];
      const m = s.dolly ? 0.55 * k : 0.12 * k;
      // avance hacia el hito y ligero desplazamiento lateral
      cx = s.cam[0] + dx * m + (s.drift ? -dz * s.drift * (k - 0.5) : 0);
      cz = s.cam[2] + dz * m + (s.drift ? dx * s.drift * (k - 0.5) : 0);
      cy = s.cam[1];
      [lx, ly, lz] = s.look;
    }
    this.camera.position.set(cx, cy, cz);
    this.camera.lookAt(lx, ly, lz);
    this.sun.position.set(cx + this.sunOffset.x, this.sunOffset.y, cz + this.sunOffset.z);
    this.sun.target.position.set(cx, 0, cz);
    this.sky.position.set(cx, 0, cz);
  }

  start() {
    this.running = true;
    this.sfx.init();
    this.cameraRig.first = true;
    // cámara detrás del jugador, mirando hacia su coche
    const pp = this.player.person;
    const car = this.allCars[0];
    this.cameraRig.yaw = car ? Math.atan2(pp.x - car.x, pp.z - car.z) : Math.PI;
    this.hud.toast('Casco Viejo Rush', 'Busca un coche (E) y entra en un círculo de color para empezar una misión', 4);
  }
}

// ---------- arranque ----------
const menu = document.getElementById('menu');
const play = document.getElementById('play');
const loading = document.getElementById('loading');
let game;
try {
  game = new Game();
  window.__game = game;
  game.frame();
  loading.hidden = true;
  play.hidden = false;
} catch (err) {
  console.error(err);
  loading.textContent = 'Error al cargar el juego: ' + err.message;
}

play.addEventListener('click', () => {
  menu.hidden = true;
  play.textContent = '▶ Continuar';
  if (!game.running) game.start();
  else game.setPaused(false);
  game.input.requestLock();
});
document.getElementById('game').addEventListener('click', () => {
  if (game?.running) game.input.requestLock();
});
// Al liberar el ratón (Esc) se pausa el juego
document.addEventListener('pointerlockchange', () => {
  if (!document.pointerLockElement && game?.running && !game.paused && !game.input.isTouch) game.setPaused(true);
});
