import { STREET_STYLE } from '../world/city.js';

const PX = 1.6; // píxeles por metro en la imagen del mapa

// HUD en español: minimapa, mapa grande (M), velocímetro, estrellas, misión.
export class Hud {
  constructor(game) {
    this.game = game;
    this.$ = (id) => document.getElementById(id);
    this.mini = this.$('minimap');
    this.miniCtx = this.mini.getContext('2d');
    this.big = this.$('bigmap-canvas');
    this.bigCtx = this.big.getContext('2d');
    this.speedo = this.$('speedo');
    this.speedoCtx = this.speedo.getContext('2d');
    this.toastT = 0;
    this.hintT = 0;
    this.bigOpen = false;
    this.lastLoc = '';
    this.buildMapImage();
  }

  buildMapImage() {
    const city = this.game.city;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const s of city.streets) {
      for (const p of s.pts) {
        minX = Math.min(minX, p[0]);
        maxX = Math.max(maxX, p[0]);
        minZ = Math.min(minZ, p[1]);
        maxZ = Math.max(maxZ, p[1]);
      }
    }
    minX -= 40;
    minZ -= 40;
    maxX += 40;
    maxZ += 40;
    this.map = { minX, minZ, w: (maxX - minX) * PX, h: (maxZ - minZ) * PX };
    const c = document.createElement('canvas');
    c.width = Math.ceil(this.map.w);
    c.height = Math.ceil(this.map.h);
    const g = c.getContext('2d');
    const tx = (x) => (x - minX) * PX;
    const tz = (z) => (z - minZ) * PX;
    const poly = (pts) => {
      g.beginPath();
      pts.forEach((p, i) => (i ? g.lineTo(tx(p[0]), tz(p[1])) : g.moveTo(tx(p[0]), tz(p[1]))));
      g.closePath();
    };
    g.fillStyle = '#9fab86';
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#7fae5b';
    for (const p of city.parks) {
      poly(p.pts);
      g.fill();
    }
    g.fillStyle = '#d9c9a8';
    for (const s of city.squares) {
      poly(s.pts);
      g.fill();
    }
    g.lineCap = 'round';
    g.lineJoin = 'round';
    const order = ['footway', 'path', 'steps', 'cycleway', 'service', 'pedestrian', 'living_street', 'residential', 'unclassified', 'tertiary', 'secondary', 'primary', 'busway'];
    for (const type of order) {
      const st = STREET_STYLE[type];
      if (!st) continue;
      g.strokeStyle = type === 'footway' || type === 'path' || type === 'steps' ? '#d6c9ae' : ['pedestrian', 'living_street'].includes(type) ? '#efe3c8' : '#ffffff';
      g.lineWidth = Math.max(1.5, st.w * PX * 0.9);
      for (const s of city.streets) {
        if (s.type !== type) continue;
        g.beginPath();
        s.pts.forEach((p, i) => (i ? g.lineTo(tx(p[0]), tz(p[1])) : g.moveTo(tx(p[0]), tz(p[1]))));
        g.stroke();
      }
    }
    g.fillStyle = '#c79d7a';
    g.strokeStyle = '#a77d5b';
    g.lineWidth = 1;
    for (const f of city.footprints) {
      poly(f.pts);
      g.fill();
      g.stroke();
    }
    g.strokeStyle = '#8a7a5a';
    g.lineWidth = 3 * PX;
    for (const line of city.walls) {
      for (const [a, b] of line) {
        g.beginPath();
        g.moveTo(tx(a[0]), tz(a[1]));
        g.lineTo(tx(b[0]), tz(b[1]));
        g.stroke();
      }
    }
    this.mapImg = c;
  }

  toMap(x, z) {
    return [(x - this.map.minX) * PX, (z - this.map.minZ) * PX];
  }

  // ---------- Mensajes ----------
  toast(title, sub = '', dur = 3) {
    this.$('toast-title').textContent = title;
    this.$('toast-sub').textContent = sub;
    this.$('toast').classList.add('show');
    this.toastT = dur;
  }

  flash(text) {
    this.hint(text, 2.6);
  }

  hint(text, dur = 2.2) {
    const el = this.$('hint');
    el.textContent = text;
    el.classList.add('show');
    this.hintT = dur;
  }

  toggleBigMap(force) {
    this.bigOpen = force ?? !this.bigOpen;
    this.$('bigmap').hidden = !this.bigOpen;
    if (this.bigOpen) this.drawBigMap();
  }

  // ---------- Actualización por frame ----------
  update(dt, t) {
    const game = this.game;
    if (this.toastT > 0) {
      this.toastT -= dt;
      if (this.toastT <= 0) this.$('toast').classList.remove('show');
    }
    if (this.hintT > 0) {
      this.hintT -= dt;
      if (this.hintT <= 0) this.$('hint').classList.remove('show');
    }

    // Estrellas
    const pol = game.police;
    const stars = this.$('stars').children;
    const blink = pol.evading && Math.floor(t * 3) % 2 === 0;
    for (let i = 0; i < stars.length; i++) {
      stars[i].classList.toggle('on', i < pol.level && !blink);
      stars[i].classList.toggle('dim', i < pol.level && blink);
    }
    const evade = this.$('evade');
    if (pol.level > 0 && pol.evading) {
      evade.hidden = false;
      this.$('evade-bar').style.width = `${Math.min(100, (pol.evadeT / pol.evadeNeeded) * 100)}%`;
    } else evade.hidden = true;
    this.$('score').textContent = `${game.score} pts`;

    // Misión
    const mt = game.missions.missionText();
    const panel = this.$('mission');
    if (mt) {
      panel.hidden = false;
      this.$('mission-title').textContent = mt.title;
      this.$('mission-text').textContent = mt.text;
      const timer = this.$('mission-timer');
      if (mt.time != null) {
        const s = Math.ceil(mt.time);
        timer.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
        timer.classList.toggle('urgent', s <= 10);
        timer.hidden = false;
      } else timer.hidden = true;
    } else panel.hidden = true;

    // Flecha al objetivo
    const obj = game.missions.objective();
    const arrow = this.$('arrow');
    const objEl = this.$('objective');
    const p = game.playerPos();
    if (obj) {
      const dx = obj.x - p.x;
      const dz = obj.z - p.z;
      const ang = Math.atan2(dx, -dz) + game.cameraRig.yaw;
      objEl.hidden = false;
      arrow.style.transform = `rotate(${ang}rad)`;
      this.$('arrow-dist').textContent = `${Math.round(Math.hypot(dx, dz))} m`;
    } else objEl.hidden = true;

    // Velocímetro
    const car = game.player.car;
    this.speedo.hidden = !car;
    if (car) this.drawSpeedo(Math.abs(car.forwardSpeed) * 3.6);

    // Ubicación (calle más cercana)
    this.locT = (this.locT || 0) - dt;
    if (this.locT <= 0) {
      this.locT = 0.5;
      const loc = game.locationName();
      if (loc !== this.lastLoc) {
        this.lastLoc = loc;
        this.$('location').textContent = loc;
      }
    }

    this.drawMinimap(t);
    if (this.bigOpen) {
      this.bigT = (this.bigT || 0) - dt;
      if (this.bigT <= 0) {
        this.bigT = 0.2;
        this.drawBigMap();
      }
    }
  }

  drawSpeedo(kmh) {
    const g = this.speedoCtx;
    const w = this.speedo.width;
    const cx = w / 2;
    const cy = w / 2;
    const r = w / 2 - 10;
    g.clearRect(0, 0, w, w);
    g.lineWidth = 10;
    g.lineCap = 'round';
    const a0 = Math.PI * 0.75;
    const a1 = Math.PI * 2.25;
    g.strokeStyle = 'rgba(255,255,255,0.18)';
    g.beginPath();
    g.arc(cx, cy, r, a0, a1);
    g.stroke();
    const k = Math.min(1, kmh / 120);
    const grad = g.createLinearGradient(0, w, w, 0);
    grad.addColorStop(0, '#4ade80');
    grad.addColorStop(0.6, '#facc15');
    grad.addColorStop(1, '#ef4444');
    g.strokeStyle = grad;
    g.beginPath();
    g.arc(cx, cy, r, a0, a0 + (a1 - a0) * k);
    g.stroke();
    g.fillStyle = '#fff';
    g.textAlign = 'center';
    g.font = 'bold 38px system-ui, sans-serif';
    g.fillText(String(Math.round(kmh)), cx, cy + 10);
    g.font = '600 13px system-ui, sans-serif';
    g.fillStyle = 'rgba(255,255,255,0.75)';
    g.fillText('km/h', cx, cy + 30);
  }

  drawMarkers(g, scale, toScreen, clampR, t) {
    const game = this.game;
    for (const m of game.missions.markers()) {
      const [sx, sy, clamped] = toScreen(m.x, m.z, clampR);
      g.fillStyle = m.color;
      g.strokeStyle = '#111';
      g.lineWidth = 2;
      if (m.kind === 'objective') {
        const s = 7 + Math.sin(t * 6) * 1.5;
        g.beginPath();
        g.moveTo(sx, sy - s);
        g.lineTo(sx + s, sy);
        g.lineTo(sx, sy + s);
        g.lineTo(sx - s, sy);
        g.closePath();
        g.fill();
        g.stroke();
      } else if (m.kind === 'rival') {
        g.beginPath();
        g.arc(sx, sy, 4, 0, Math.PI * 2);
        g.fill();
        g.stroke();
      } else {
        g.beginPath();
        g.arc(sx, sy, clamped ? 5 : 7, 0, Math.PI * 2);
        g.fill();
        g.stroke();
        g.fillStyle = '#111';
        g.font = 'bold 9px system-ui';
        g.textAlign = 'center';
        g.fillText(m.done ? '✓' : '!', sx, sy + 3);
      }
    }
    // policía
    for (const c of game.police.cars) {
      const [sx, sy] = toScreen(c.x, c.z, clampR);
      g.fillStyle = Math.floor(t * 6) % 2 ? '#ff3b3b' : '#3b82ff';
      g.beginPath();
      g.arc(sx, sy, 4.5, 0, Math.PI * 2);
      g.fill();
    }
  }

  drawMinimap(t) {
    const game = this.game;
    const g = this.miniCtx;
    const W = this.mini.width;
    const p = game.playerPos();
    const speed = game.player.car ? game.player.car.speed : 0;
    const zoom = 1.05 - Math.min(0.35, speed / 80);
    const yaw = game.cameraRig.yaw;
    g.save();
    g.clearRect(0, 0, W, W);
    g.beginPath();
    g.arc(W / 2, W / 2, W / 2 - 2, 0, Math.PI * 2);
    g.clip();
    g.fillStyle = '#9fab86';
    g.fillRect(0, 0, W, W);
    g.translate(W / 2, W / 2);
    g.rotate(yaw);
    g.scale(zoom, zoom);
    const [mx, my] = this.toMap(p.x, p.z);
    g.drawImage(this.mapImg, -mx, -my);
    g.restore();

    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const R = W / 2 - 8;
    const toScreen = (x, z, clampR) => {
      const dx = (x - p.x) * PX * zoom;
      const dy = (z - p.z) * PX * zoom;
      let sx = dx * cos - dy * sin;
      let sy = dx * sin + dy * cos;
      const l = Math.hypot(sx, sy);
      let clamped = false;
      if (clampR && l > R) {
        sx *= R / l;
        sy *= R / l;
        clamped = true;
      }
      return [W / 2 + sx, W / 2 + sy, clamped];
    };
    this.drawMarkers(g, zoom, toScreen, true, t);

    // jugador (flecha según su orientación)
    const head = game.player.car ? game.player.car.heading : game.player.person.heading;
    g.save();
    g.translate(W / 2, W / 2);
    g.rotate(yaw - head + Math.PI);
    g.fillStyle = '#ffffff';
    g.strokeStyle = '#111';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(0, -9);
    g.lineTo(6.5, 7);
    g.lineTo(0, 3);
    g.lineTo(-6.5, 7);
    g.closePath();
    g.fill();
    g.stroke();
    g.restore();

    // N de norte
    const north = toScreen(p.x, p.z - 10000, true);
    g.fillStyle = '#fff';
    g.strokeStyle = '#111';
    g.lineWidth = 3;
    g.font = 'bold 13px system-ui';
    g.textAlign = 'center';
    g.strokeText('N', north[0], north[1] + 4);
    g.fillText('N', north[0], north[1] + 4);

    g.strokeStyle = 'rgba(0,0,0,0.6)';
    g.lineWidth = 4;
    g.beginPath();
    g.arc(W / 2, W / 2, W / 2 - 2, 0, Math.PI * 2);
    g.stroke();
  }

  drawBigMap() {
    const c = this.big;
    const rect = c.getBoundingClientRect();
    c.width = Math.max(300, rect.width);
    c.height = Math.max(200, rect.height);
    const g = this.bigCtx;
    const s = Math.min(c.width / this.map.w, c.height / this.map.h);
    const ox = (c.width - this.map.w * s) / 2;
    const oy = (c.height - this.map.h * s) / 2;
    g.fillStyle = '#1b1f27';
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(this.mapImg, ox, oy, this.map.w * s, this.map.h * s);
    const toScreen = (x, z) => {
      const [mx, my] = this.toMap(x, z);
      return [ox + mx * s, oy + my * s, false];
    };
    // nombres de zonas
    g.font = '600 12px system-ui';
    g.textAlign = 'center';
    for (const z of this.game.zones.zones) {
      const [sx, sy] = toScreen(z.x, z.z);
      g.lineWidth = 3;
      g.strokeStyle = 'rgba(255,255,255,0.85)';
      g.strokeText(z.name, sx, sy - 10);
      g.fillStyle = '#2b2b2b';
      g.fillText(z.name, sx, sy - 10);
    }
    const t = performance.now() / 1000;
    this.drawMarkers(g, s, toScreen, false, t);
    // etiquetas de misión
    for (const m of this.game.missions.markers()) {
      if (m.kind !== 'mission') continue;
      const [sx, sy] = toScreen(m.x, m.z);
      g.font = 'bold 12px system-ui';
      g.lineWidth = 3;
      g.strokeStyle = '#111';
      g.strokeText(m.label + (m.done ? ' ✓' : ''), sx, sy + 20);
      g.fillStyle = m.color;
      g.fillText(m.label + (m.done ? ' ✓' : ''), sx, sy + 20);
    }
    const p = this.game.playerPos();
    const [px, py] = toScreen(p.x, p.z);
    g.fillStyle = '#fff';
    g.strokeStyle = '#111';
    g.lineWidth = 3;
    g.beginPath();
    g.arc(px, py, 7, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  }
}
