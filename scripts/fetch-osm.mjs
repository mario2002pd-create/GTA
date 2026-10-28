#!/usr/bin/env node
// Descarga calles, edificios, parques y murallas del Casco Viejo de Pamplona
// desde OpenStreetMap (Overpass API) y los guarda simplificados en
// data/casco-viejo.json.
//
// Datos © OpenStreetMap contributors, licencia ODbL 1.0
// (https://www.openstreetmap.org/copyright).
//
// Uso:  npm run fetch-osm
// (detrás de un proxy HTTP con Node >= 22.21: NODE_USE_ENV_PROXY=1 npm run fetch-osm)

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '../data/casco-viejo.json');

// Caja que cubre el Casco Antiguo: de la Taconera a la Catedral/Redín y
// del Paseo de Sarasate a las murallas sobre el Arga.
const BBOX = { south: 42.8132, west: -1.6540, north: 42.8222, east: -1.6372 };

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

const bb = `${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east}`;
const QUERY = `[out:json][timeout:180];
(
  way["highway"](${bb});
  way["building"](${bb});
  relation["building"]["type"="multipolygon"](${bb});
  way["leisure"~"park|garden"](${bb});
  way["landuse"~"grass"](${bb});
  way["barrier"="city_wall"](${bb});
  way["historic"="citywalls"](${bb});
  way["place"="square"](${bb});
  way["highway"="pedestrian"]["area"="yes"](${bb});
);
out body;
>;
out skel qt;`;

async function query() {
  let lastErr;
  for (const url of [...ENDPOINTS, ...ENDPOINTS]) {
    try {
      console.log(`→ Consultando ${url} ...`);
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'casco-viejo-rush/1.0 (juego educativo)',
        },
        body: 'data=' + encodeURIComponent(QUERY),
        signal: AbortSignal.timeout(240_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!json.elements?.length) throw new Error('respuesta vacía');
      return json;
    } catch (err) {
      console.warn(`  ✗ ${err.message}`);
      lastErr = err;
    }
  }
  throw lastErr;
}

// Preferimos el nombre en castellano si existe (en Pamplona `name` suele ir en euskera).
const nameOf = (t) => t['name:es'] || t.name || undefined;
const r6 = (v) => Math.round(v * 1e6) / 1e6;

function levelsOf(tags) {
  const l = parseInt(tags['building:levels'], 10);
  if (Number.isFinite(l) && l > 0) return Math.min(Math.max(l, 2), 7);
  return null;
}

async function main() {
  const osm = await query();
  const nodes = new Map();
  const ways = new Map();
  for (const el of osm.elements) {
    if (el.type === 'node') nodes.set(el.id, [r6(el.lon), r6(el.lat)]);
    else if (el.type === 'way') ways.set(el.id, el);
  }
  const coords = (w) => w.nodes.map((id) => nodes.get(id)).filter(Boolean);

  const out = {
    attribution: '© OpenStreetMap contributors, ODbL 1.0',
    source: 'Overpass API',
    fetched: new Date().toISOString().slice(0, 10),
    bbox: BBOX,
    streets: [],
    buildings: [],
    parks: [],
    squares: [],
    walls: [],
  };

  const usedInRelation = new Set();
  for (const el of osm.elements) {
    if (el.type !== 'relation' || !el.tags?.building) continue;
    for (const m of el.members) {
      if (m.type !== 'way' || m.role !== 'outer') continue;
      const w = ways.get(m.ref);
      if (!w) continue;
      usedInRelation.add(w.id);
      const pts = coords(w);
      if (pts.length >= 4) {
        out.buildings.push({ id: el.id, name: nameOf(el.tags), levels: levelsOf(el.tags) ?? undefined, kind: el.tags.building, pts });
      }
    }
  }

  for (const w of ways.values()) {
    const t = w.tags || {};
    const pts = coords(w);
    if (pts.length < 2) continue;
    if (t.building && !usedInRelation.has(w.id)) {
      if (pts.length < 4) continue;
      out.buildings.push({
        id: w.id,
        name: nameOf(t),
        levels: levelsOf(t) ?? undefined,
        kind: t.building,
        amenity: t.amenity || undefined,
        pts,
      });
    } else if (t.highway && t.area === 'yes') {
      out.squares.push({ id: w.id, name: nameOf(t), pts });
    } else if (t.highway) {
      if (['proposed', 'construction', 'elevator', 'platform', 'bus_stop'].includes(t.highway)) continue;
      out.streets.push({ id: w.id, name: nameOf(t), type: t.highway, pts });
    } else if (t.place === 'square') {
      out.squares.push({ id: w.id, name: nameOf(t), pts });
    } else if (t.leisure || t.landuse) {
      out.parks.push({ id: w.id, name: nameOf(t), pts });
    } else if (t.barrier === 'city_wall' || t.historic === 'citywalls') {
      out.walls.push({ id: w.id, name: nameOf(t), pts });
    }
  }

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(out));
  console.log(
    `✓ Guardado ${OUT}\n  calles: ${out.streets.length}, edificios: ${out.buildings.length}, ` +
      `parques: ${out.parks.length}, plazas: ${out.squares.length}, murallas: ${out.walls.length}`,
  );
}

main().catch((err) => {
  console.error('No se pudieron descargar los datos de OSM:', err);
  process.exit(1);
});
