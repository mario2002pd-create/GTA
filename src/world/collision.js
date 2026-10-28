import { segIntersect } from '../geo.js';

// Rejilla espacial de segmentos (paredes de edificios, murallas, troncos...)
// para colisiones círculo-segmento y rayos 2D de línea de visión / cámara.
export class SegmentGrid {
  constructor(cell = 8) {
    this.cell = cell;
    this.cells = new Map();
    this.ax = [];
    this.az = [];
    this.bx = [];
    this.bz = [];
    this.pad = [];
    this.flags = [];
    this.stamp = new Uint32Array(0);
    this.stampId = 0;
  }

  key(i, j) {
    return (i + 32768) * 65536 + (j + 32768);
  }

  // flags: 1 = edificio, 2 = muralla, 4 = árbol/mobiliario
  add(ax, az, bx, bz, pad = 0, flags = 1) {
    const id = this.ax.length;
    this.flags.push(flags);
    this.ax.push(ax);
    this.az.push(az);
    this.bx.push(bx);
    this.bz.push(bz);
    this.pad.push(pad);
    const c = this.cell;
    const i0 = Math.floor((Math.min(ax, bx) - pad) / c);
    const i1 = Math.floor((Math.max(ax, bx) + pad) / c);
    const j0 = Math.floor((Math.min(az, bz) - pad) / c);
    const j1 = Math.floor((Math.max(az, bz) + pad) / c);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const k = this.key(i, j);
        let arr = this.cells.get(k);
        if (!arr) this.cells.set(k, (arr = []));
        arr.push(id);
      }
    }
    return id;
  }

  addPolygon(pts, pad = 0, flags = 1) {
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const q = pts[(i + 1) % pts.length];
      this.add(p[0], p[1], q[0], q[1], pad, flags);
    }
  }

  _begin() {
    if (this.stamp.length < this.ax.length) this.stamp = new Uint32Array(this.ax.length + 1024);
    this.stampId++;
    if (this.stampId > 4e9) {
      this.stamp.fill(0);
      this.stampId = 1;
    }
  }

  // Llama a cb(id) para cada segmento cercano a la caja [x0,x1]×[z0,z1].
  forEachIn(x0, z0, x1, z1, cb) {
    this._begin();
    const c = this.cell;
    const i0 = Math.floor(x0 / c);
    const i1 = Math.floor(x1 / c);
    const j0 = Math.floor(z0 / c);
    const j1 = Math.floor(z1 / c);
    const st = this.stamp;
    const sid = this.stampId;
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const arr = this.cells.get(this.key(i, j));
        if (!arr) continue;
        for (let n = 0; n < arr.length; n++) {
          const id = arr[n];
          if (st[id] === sid) continue;
          st[id] = sid;
          cb(id);
        }
      }
    }
  }

  // Empuja un círculo fuera de los segmentos. Devuelve la normal acumulada
  // (o null si no hay contacto). `out` = {x, z} se modifica en el sitio.
  resolveCircle(out, r) {
    let nx = 0;
    let nz = 0;
    let hit = false;
    for (let iter = 0; iter < 3; iter++) {
      let any = false;
      const px = out.x;
      const pz = out.z;
      this.forEachIn(px - r - 4, pz - r - 4, px + r + 4, pz + r + 4, (id) => {
        const ax = this.ax[id];
        const az = this.az[id];
        const dx = this.bx[id] - ax;
        const dz = this.bz[id] - az;
        const len2 = dx * dx + dz * dz || 1e-9;
        let t = ((out.x - ax) * dx + (out.z - az) * dz) / len2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const cx = ax + dx * t;
        const cz = az + dz * t;
        let ex = out.x - cx;
        let ez = out.z - cz;
        const rr = r + this.pad[id];
        const d2 = ex * ex + ez * ez;
        if (d2 < rr * rr) {
          let d = Math.sqrt(d2);
          if (d < 1e-6) {
            ex = -dz;
            ez = dx;
            d = Math.hypot(ex, ez) || 1;
          }
          const push = rr - d;
          ex /= d;
          ez /= d;
          out.x += ex * push;
          out.z += ez * push;
          nx += ex;
          nz += ez;
          any = true;
          hit = true;
        }
      });
      if (!any) break;
    }
    if (!hit) return null;
    const l = Math.hypot(nx, nz) || 1;
    return { x: nx / l, z: nz / l };
  }

  // Distancia libre desde (x, z) hasta el segmento más cercano (máx. `maxR`).
  clearance(x, z, maxR = 6, mask = 0xff) {
    let best = maxR;
    this.forEachIn(x - maxR, z - maxR, x + maxR, z + maxR, (id) => {
      if (!(this.flags[id] & mask)) return;
      const ax = this.ax[id];
      const az = this.az[id];
      const dx = this.bx[id] - ax;
      const dz = this.bz[id] - az;
      const l2 = dx * dx + dz * dz || 1e-9;
      let t = ((x - ax) * dx + (z - az) * dz) / l2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const d = Math.hypot(x - ax - dx * t, z - az - dz * t) - this.pad[id];
      if (d < best) best = d;
    });
    return best;
  }

  // Rayo 2D: fracción t ∈ [0,1] del primer choque (1 si está libre).
  // exitOnly: en edificios solo cuentan las fachadas que el rayo cruza al SALIR
  // (las que miran hacia el final del rayo); útil para la cámara, porque las
  // caras traseras no se dibujan y no tapan la vista.
  raycast(ax, az, bx, bz, mask = 0xff, exitOnly = false) {
    let best = 1;
    const x0 = Math.min(ax, bx) - 2;
    const x1 = Math.max(ax, bx) + 2;
    const z0 = Math.min(az, bz) - 2;
    const z1 = Math.max(az, bz) + 2;
    // Para rayos largos, recorremos por tramos para no visitar celdas inútiles.
    const len = Math.hypot(bx - ax, bz - az);
    if (len > this.cell * 6) {
      const steps = Math.ceil(len / (this.cell * 3));
      for (let s = 0; s < steps; s++) {
        const t0 = s / steps;
        const t1 = (s + 1) / steps;
        const sx = ax + (bx - ax) * t0;
        const sz = az + (bz - az) * t0;
        const ex = ax + (bx - ax) * t1;
        const ez = az + (bz - az) * t1;
        const t = this.raycast(sx, sz, ex, ez, mask, exitOnly);
        if (t < 1) return t0 + (t1 - t0) * t;
      }
      return 1;
    }
    this.forEachIn(x0, z0, x1, z1, (id) => {
      if (!(this.flags[id] & mask)) return;
      if (exitOnly && this.flags[id] & 1) {
        // normal exterior del polígono CCW = (dz, -dx)
        const nx = this.bz[id] - this.az[id];
        const nz = -(this.bx[id] - this.ax[id]);
        if ((bx - ax) * nx + (bz - az) * nz <= 0) return;
      }
      const t = segIntersect(ax, az, bx, bz, this.ax[id], this.az[id], this.bx[id], this.bz[id]);
      if (t >= 0 && t < best) best = t;
    });
    return best;
  }
}
