import { project } from '../geo.js';

// Tipos de vía por los que circulan coches (el Casco Viejo es casi todo
// peatonal con acceso restringido, así que entran también `pedestrian`).
export const CAR_TYPES = new Set([
  'primary',
  'secondary',
  'secondary_link',
  'tertiary',
  'tertiary_link',
  'unclassified',
  'residential',
  'living_street',
  'service',
  'pedestrian',
  'busway',
]);

export const WALK_TYPES = new Set([
  'footway',
  'pedestrian',
  'living_street',
  'path',
  'steps',
  'residential',
  'service',
  'cycleway',
]);

// Grafo de calles: nodos = vértices OSM compartidos, aristas = tramos.
export class RoadGraph {
  // minClear: holgura mínima (m) respecto a fachadas para usar un tramo.
  constructor(streets, types, grid, minClear = 0) {
    this.x = [];
    this.z = [];
    this.adj = [];
    this.name = [];
    const index = new Map();
    const nodeOf = (lonlat) => {
      const k = lonlat[0] + ',' + lonlat[1];
      let id = index.get(k);
      if (id === undefined) {
        id = this.x.length;
        index.set(k, id);
        const [x, z] = project(lonlat);
        this.x.push(x);
        this.z.push(z);
        this.adj.push([]);
        this.name.push(null);
      }
      return id;
    };
    for (const s of streets) {
      if (!types.has(s.type)) continue;
      let prev = nodeOf(s.pts[0]);
      for (let i = 1; i < s.pts.length; i++) {
        const cur = nodeOf(s.pts[i]);
        if (cur === prev) continue;
        const ax = this.x[prev];
        const az = this.z[prev];
        const bx = this.x[cur];
        const bz = this.z[cur];
        // Descartamos tramos que atraviesan edificios (pasajes cubiertos, etc.)
        const len = Math.hypot(bx - ax, bz - az);
        if (!grid || (grid.raycast(ax, az, bx, bz, 1 | 2) >= 1 && this._clearEdge(grid, ax, az, bx, bz, len, minClear))) {
          this.adj[prev].push({ to: cur, len, type: s.type });
          this.adj[cur].push({ to: prev, len, type: s.type });
          if (s.name) {
            this.name[prev] ??= s.name;
            this.name[cur] ??= s.name;
          }
        }
        prev = cur;
      }
    }
    this.wallGrid = grid;
    this._largestComponent();
    this._buildNodeGrid();
  }

  // Nodo más cercano con línea directa libre de fachadas (para que un coche no
  // intente ir hacia un nodo de la calle de detrás atravesando un edificio).
  nearestVisible(x, z, maxR = 120) {
    const grid = this.wallGrid;
    if (!grid) return this.nearest(x, z, maxR);
    const cand = this.nodesInRing(x, z, 0, 40);
    cand.sort((a, b) => (this.x[a] - x) ** 2 + (this.z[a] - z) ** 2 - ((this.x[b] - x) ** 2 + (this.z[b] - z) ** 2));
    for (let i = 0; i < Math.min(cand.length, 16); i++) {
      const n = cand[i];
      if (grid.raycast(x, z, this.x[n], this.z[n], 1 | 2) >= 1) return n;
    }
    return this.nearest(x, z, maxR);
  }

  _clearEdge(grid, ax, az, bx, bz, len, minClear) {
    if (minClear <= 0) return true;
    const n = Math.max(1, Math.ceil(len / 2));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      if (grid.clearance(ax + (bx - ax) * t, az + (bz - az) * t, minClear + 0.5, 1 | 2) < minClear) return false;
    }
    return true;
  }

  _largestComponent() {
    const n = this.x.length;
    const comp = new Int32Array(n).fill(-1);
    let best = -1;
    let bestSize = 0;
    let c = 0;
    for (let i = 0; i < n; i++) {
      if (comp[i] !== -1 || this.adj[i].length === 0) continue;
      const stack = [i];
      comp[i] = c;
      let size = 0;
      while (stack.length) {
        const u = stack.pop();
        size++;
        for (const e of this.adj[u]) {
          if (comp[e.to] === -1) {
            comp[e.to] = c;
            stack.push(e.to);
          }
        }
      }
      if (size > bestSize) {
        bestSize = size;
        best = c;
      }
      c++;
    }
    this.valid = new Uint8Array(n);
    this.nodes = [];
    for (let i = 0; i < n; i++) {
      if (comp[i] === best) {
        this.valid[i] = 1;
        this.nodes.push(i);
      }
    }
  }

  _buildNodeGrid() {
    this.cell = 25;
    this.grid = new Map();
    for (const i of this.nodes) {
      const k = this._key(Math.floor(this.x[i] / this.cell), Math.floor(this.z[i] / this.cell));
      let a = this.grid.get(k);
      if (!a) this.grid.set(k, (a = []));
      a.push(i);
    }
  }

  _key(i, j) {
    return (i + 32768) * 65536 + (j + 32768);
  }

  nearest(x, z, maxR = 400) {
    let best = -1;
    let bestD = Infinity;
    const ci = Math.floor(x / this.cell);
    const cj = Math.floor(z / this.cell);
    for (let r = 0; r * this.cell < maxR; r++) {
      for (let i = ci - r; i <= ci + r; i++) {
        for (let j = cj - r; j <= cj + r; j++) {
          if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== r) continue;
          const a = this.grid.get(this._key(i, j));
          if (!a) continue;
          for (const id of a) {
            const d = (this.x[id] - x) ** 2 + (this.z[id] - z) ** 2;
            if (d < bestD) {
              bestD = d;
              best = id;
            }
          }
        }
      }
      if (best >= 0 && Math.sqrt(bestD) < r * this.cell) break;
    }
    return best;
  }

  // Nodos dentro de un anillo [rMin, rMax] alrededor de (x, z)
  nodesInRing(x, z, rMin, rMax) {
    const out = [];
    const ci0 = Math.floor((x - rMax) / this.cell);
    const ci1 = Math.floor((x + rMax) / this.cell);
    const cj0 = Math.floor((z - rMax) / this.cell);
    const cj1 = Math.floor((z + rMax) / this.cell);
    for (let i = ci0; i <= ci1; i++) {
      for (let j = cj0; j <= cj1; j++) {
        const a = this.grid.get(this._key(i, j));
        if (!a) continue;
        for (const id of a) {
          const d = Math.hypot(this.x[id] - x, this.z[id] - z);
          if (d >= rMin && d <= rMax) out.push(id);
        }
      }
    }
    return out;
  }

  randomNode(rng = Math.random) {
    return this.nodes[Math.floor(rng() * this.nodes.length)];
  }

  // A* clásico con montículo binario.
  path(from, to, maxIter = 20000) {
    if (from < 0 || to < 0) return null;
    if (from === to) return [from];
    const g = new Map([[from, 0]]);
    const came = new Map();
    const heap = [[this._h(from, to), from]];
    const closed = new Set();
    let iter = 0;
    while (heap.length && iter++ < maxIter) {
      const [, u] = heapPop(heap);
      if (u === to) {
        const out = [u];
        let c = u;
        while (came.has(c)) {
          c = came.get(c);
          out.push(c);
        }
        return out.reverse();
      }
      if (closed.has(u)) continue;
      closed.add(u);
      const gu = g.get(u);
      for (const e of this.adj[u]) {
        if (!this.valid[e.to] || closed.has(e.to)) continue;
        // Penalizamos un poco escaleras y sendas para preferir calles
        const w = e.type === 'steps' ? 6 : e.type === 'footway' || e.type === 'path' ? 1.6 : 1;
        const ng = gu + e.len * w;
        if (ng < (g.get(e.to) ?? Infinity)) {
          g.set(e.to, ng);
          came.set(e.to, u);
          heapPush(heap, [ng + this._h(e.to, to), e.to]);
        }
      }
    }
    return null;
  }

  // Índice inicial de una ruta saltando los nodos que ya quedan detrás de (x, z)
  trimStart(path, x, z) {
    let i = 0;
    while (i + 1 < path.length) {
      const a = path[i];
      const b = path[i + 1];
      const seg = Math.hypot(this.x[b] - this.x[a], this.z[b] - this.z[a]);
      if (Math.hypot(this.x[b] - x, this.z[b] - z) < seg + 1) i++;
      else break;
    }
    return i;
  }

  _h(a, b) {
    return Math.hypot(this.x[a] - this.x[b], this.z[a] - this.z[b]);
  }
}

function heapPush(h, item) {
  h.push(item);
  let i = h.length - 1;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (h[p][0] <= h[i][0]) break;
    [h[p], h[i]] = [h[i], h[p]];
    i = p;
  }
}

function heapPop(h) {
  const top = h[0];
  const last = h.pop();
  if (h.length) {
    h[0] = last;
    let i = 0;
    for (;;) {
      const l = i * 2 + 1;
      const r = l + 1;
      let m = i;
      if (l < h.length && h[l][0] < h[m][0]) m = l;
      if (r < h.length && h[r][0] < h[m][0]) m = r;
      if (m === i) break;
      [h[m], h[i]] = [h[i], h[m]];
      i = m;
    }
  }
  return top;
}
