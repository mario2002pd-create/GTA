import * as THREE from 'three';
import { mulberry32 } from '../geo.js';

// Texturas procedurales (canvas) con el aire del Casco Viejo: fachadas con
// miradores y balcones, piedra de sillería, teja árabe, adoquín de granito...

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function toTexture(c, { srgb = true, repeat = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.anisotropy = aniso;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

function shade(hex, k) {
  const c = new THREE.Color(hex);
  c.multiplyScalar(k);
  return '#' + c.getHexString();
}

// ---------------------------------------------------------------------------
// Atlas de fachada: 4 columnas × 2 filas, celdas de 128 px = 3 m × 1 planta.
// Fila superior: plantas altas. Fila inferior: planta baja (comercios).
// Se dibujan dos canvas: color y máscara (blanco = revoco que se tiñe con el
// color de cada edificio; negro = madera, cristal, hierro, piedra...).
// ---------------------------------------------------------------------------
const CELL = 128;

export function makeFacadeAtlas() {
  const [cc, g] = canvas(CELL * 4, CELL * 2);
  const [mc, m] = canvas(CELL * 4, CELL * 2);
  g.fillStyle = '#f4efe6';
  g.fillRect(0, 0, cc.width, cc.height);
  m.fillStyle = '#ffffff';
  m.fillRect(0, 0, mc.width, mc.height);
  const rng = mulberry32(7);

  // rect en color + negro en máscara (detalle no teñido)
  const R = (x, y, w, h, col, mask = true) => {
    g.fillStyle = col;
    g.fillRect(x, y, w, h);
    if (mask) {
      m.fillStyle = '#000';
      m.fillRect(x, y, w, h);
    }
  };
  // revoco más oscuro (sí se tiñe): sombras, impostas
  const P = (x, y, w, h, k) => {
    g.fillStyle = `rgba(0,0,0,${k})`;
    g.fillRect(x, y, w, h);
  };

  // textura suave del revoco
  for (let i = 0; i < 3500; i++) {
    const x = rng() * cc.width;
    const y = rng() * cc.height;
    g.fillStyle = `rgba(${rng() < 0.5 ? '0,0,0' : '255,255,255'},${0.03 + rng() * 0.04})`;
    g.fillRect(x, y, 2 + rng() * 3, 2 + rng() * 3);
  }

  const glass = (x, y, w, h, lit = false) => {
    const grad = g.createLinearGradient(x, y, x + w, y + h);
    if (lit) {
      grad.addColorStop(0, '#ffd98a');
      grad.addColorStop(1, '#f2a94a');
    } else {
      grad.addColorStop(0, '#5d7a96');
      grad.addColorStop(0.55, '#2f4256');
      grad.addColorStop(1, '#3d566e');
    }
    g.fillStyle = grad;
    g.fillRect(x, y, w, h);
    m.fillStyle = '#000';
    m.fillRect(x, y, w, h);
    if (!lit) {
      g.fillStyle = 'rgba(255,255,255,0.18)';
      g.beginPath();
      g.moveTo(x + 2, y + h * 0.15);
      g.lineTo(x + w * 0.45, y + 2);
      g.lineTo(x + w * 0.6, y + 2);
      g.lineTo(x + 2, y + h * 0.35);
      g.fill();
    }
  };
  const ironRail = (x, y, w, h) => {
    R(x, y, w, 3, '#1f1f22');
    R(x, y + h - 3, w, 3, '#1f1f22');
    for (let i = x + 3; i < x + w - 2; i += 6) R(i, y, 2, h, '#26262a');
    // repisa de piedra del balcón
    R(x - 4, y + h, w + 8, 5, '#d9d2c4');
    R(x - 2, y + h + 5, w + 4, 3, 'rgba(0,0,0,0.25)', false);
  };
  const stoneFrame = (x, y, w, h) => {
    R(x - 5, y - 6, w + 10, 6, '#ddd5c5');
    R(x - 5, y - 6, 5, h + 6, '#ddd5c5');
    R(x + w, y - 6, 5, h + 6, '#ddd5c5');
  };
  const shutters = (x, y, w, h, col) => {
    for (const sx of [x - w * 0.42, x + w]) {
      R(sx, y, w * 0.42, h, col);
      for (let k = y + 4; k < y + h - 2; k += 5) R(sx + 2, k, w * 0.42 - 4, 2, shade(col, 0.75));
    }
  };

  // --- Fila superior (y = 0..128) ---
  // Las celdas dejan revoco en el borde inferior (impostas) para que la parte
  // alta de la última planta quede limpia bajo el alero.
  const top = 0;
  // 0: balcón de forja con contraventanas verdes
  {
    const x0 = 0;
    stoneFrame(x0 + 44, top + 18, 40, 78);
    glass(x0 + 44, top + 18, 40, 78);
    R(x0 + 62, top + 18, 4, 78, '#f2ece0');
    shutters(x0 + 44, top + 18, 40, 78, '#4f7d4a');
    ironRail(x0 + 34, top + 70, 60, 22);
    P(x0, top + 112, CELL, 4, 0.08);
  }
  // 1: mirador acristalado de madera blanca (galería típica)
  {
    const x0 = CELL;
    R(x0 + 14, top + 10, 100, 96, '#f7f4ee');
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 2; r++) glass(x0 + 19 + c * 24, top + 15 + r * 34, 19, 30);
    }
    R(x0 + 14, top + 84, 100, 22, '#e9e3d6');
    for (let c = 0; c < 4; c++) R(x0 + 19 + c * 24, top + 88, 19, 14, '#d8d0c0');
    R(x0 + 10, top + 104, 108, 6, '#cfc6b4');
    R(x0 + 10, top + 6, 108, 5, '#cfc6b4');
    P(x0 + 12, top + 110, 104, 5, 0.22);
  }
  // 2: ventana con contraventanas de madera y geranios rojos
  {
    const x0 = CELL * 2;
    stoneFrame(x0 + 46, top + 24, 36, 66);
    glass(x0 + 46, top + 24, 36, 66);
    R(x0 + 62, top + 24, 4, 66, '#efe7da');
    shutters(x0 + 46, top + 24, 36, 66, '#7a4a2a');
    ironRail(x0 + 36, top + 72, 56, 18);
    for (let i = 0; i < 9; i++) {
      const fx = x0 + 40 + i * 6 + rng() * 2;
      const fy = top + 68 + rng() * 5;
      R(fx, fy, 6, 6, '#3f7a35');
      R(fx + 1, fy - 3, 4, 4, rng() < 0.75 ? '#d62828' : '#ff6b8a');
    }
    P(x0, top + 112, CELL, 4, 0.08);
  }
  // 3: balcón corrido con contraventanas azules y pañuelo rojo colgado
  {
    const x0 = CELL * 3;
    stoneFrame(x0 + 42, top + 18, 44, 80);
    glass(x0 + 42, top + 18, 44, 80);
    R(x0 + 62, top + 18, 4, 80, '#f2ece0');
    shutters(x0 + 42, top + 18, 44, 80, '#3f6d8f');
    ironRail(x0 + 6, top + 74, 116, 20);
    R(x0 + 52, top + 78, 24, 14, '#d62828');
    g.fillStyle = '#d62828';
    g.beginPath();
    g.moveTo(x0 + 52, top + 92);
    g.lineTo(x0 + 64, top + 104);
    g.lineTo(x0 + 76, top + 92);
    g.fill();
    m.fillStyle = '#000';
    m.fillRect(x0 + 52, top + 78, 24, 26);
    P(x0, top + 112, CELL, 4, 0.08);
  }

  // --- Fila inferior: plantas bajas (y = 128..256) ---
  const bot = CELL;
  const plinth = (x0) => {
    R(x0, bot + 112, CELL, 16, '#b8b0a2');
    R(x0, bot + 112, CELL, 2, '#9c9486');
  };
  // 0: comercio con escaparate y toldo a rayas rojas y blancas
  {
    const x0 = 0;
    R(x0 + 10, bot + 26, 108, 86, '#5a3a24');
    glass(x0 + 16, bot + 36, 60, 70, true);
    glass(x0 + 82, bot + 36, 30, 76);
    for (let i = 0; i < 9; i++) R(x0 + 6 + i * 13, bot + 14, 13, 16, i % 2 ? '#ffffff' : '#c81d25');
    R(x0 + 6, bot + 30, 117, 3, 'rgba(0,0,0,0.3)', false);
    plinth(x0);
  }
  // 1: portal de piedra con arco y puerta de madera
  {
    const x0 = CELL;
    R(x0 + 30, bot + 22, 68, 92, '#d4ccbc');
    g.fillStyle = '#4a2e1c';
    g.beginPath();
    g.moveTo(x0 + 40, bot + 114);
    g.lineTo(x0 + 40, bot + 52);
    g.arc(x0 + 64, bot + 52, 24, Math.PI, 0);
    g.lineTo(x0 + 88, bot + 114);
    g.fill();
    m.fillStyle = '#000';
    m.fillRect(x0 + 30, bot + 22, 68, 92);
    R(x0 + 63, bot + 50, 2, 64, '#2e1c10');
    R(x0 + 70, bot + 84, 4, 4, '#d4a73a');
    // dovelas
    for (let k = 0; k < 7; k++) {
      const a = Math.PI + (k / 6) * Math.PI;
      R(x0 + 64 + Math.cos(a) * 28 - 2, bot + 52 + Math.sin(a) * 28 - 2, 4, 4, '#b9ae99');
    }
    plinth(x0);
  }
  // 2: bar con fachada de madera oscura, luz cálida y rótulo
  {
    const x0 = CELL * 2;
    R(x0 + 6, bot + 20, 116, 94, '#3b2416');
    glass(x0 + 14, bot + 44, 48, 62, true);
    glass(x0 + 70, bot + 44, 44, 62, true);
    R(x0 + 61, bot + 44, 9, 70, '#2a170c');
    R(x0 + 18, bot + 24, 92, 16, '#1d3b2a');
    g.fillStyle = '#f2d16b';
    g.font = 'bold 12px serif';
    g.fillText('TABERNA', x0 + 36, bot + 36);
    plinth(x0);
  }
  // 3: puerta de garaje / almacén de madera y ventanuco con reja
  {
    const x0 = CELL * 3;
    R(x0 + 18, bot + 34, 56, 80, '#6b4a2e');
    for (let i = x0 + 22; i < x0 + 72; i += 9) R(i, bot + 38, 3, 74, '#5a3d25');
    glass(x0 + 86, bot + 46, 26, 30);
    for (let i = x0 + 88; i < x0 + 112; i += 6) R(i, bot + 46, 2, 30, '#1f1f22');
    R(x0 + 82, bot + 42, 34, 4, '#d4ccbc');
    plinth(x0);
  }

  const color = toTexture(cc, { repeat: false });
  const mask = toTexture(mc, { srgb: false, repeat: false });
  return { color, mask };
}

// Material de fachada: muestrea el atlas según la variante de cada edificio y
// tiñe solo el revoco. El canal alfa del color de vértice es oclusión ambiental.
export function makeFacadeMaterial(atlas) {
  const mat = new THREE.MeshLambertMaterial({ map: atlas.color, vertexColors: true });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.maskMap = { value: atlas.mask };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aVariant;\nvarying float vVariant;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvVariant = aVariant;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D maskMap;\nvarying float vVariant;')
      .replace(
        '#include <map_fragment>',
        `
        vec2 cuv = vMapUv;
        bool groundFloor = cuv.y < 1.0;
        // la variante llega interpolada: redondeamos para no saltar de celda
        float vv = floor(vVariant + 0.5);
        float groundCol = floor(vv / 4.0 + 0.01);
        float upperCol = vv - groundCol * 4.0;
        // en la planta baja cada hueco puede cambiar de tipo (tienda, portal, bar...)
        float cellX = floor(cuv.x);
        float rnd = fract(sin(cellX * 12.9898 + vv * 78.233) * 43758.5453);
        float alt = floor(fract(sin(cellX * 39.3468 + vv * 11.135) * 24634.6345) * 3.0) + 1.0;
        float gCol = mod(groundCol + (rnd > 0.55 ? alt : 0.0), 4.0);
        float col = groundFloor ? gCol : upperCol;
        vec2 f = fract(cuv);
        vec2 auv = vec2((f.x + col) * 0.25, f.y * 0.5 + (groundFloor ? 0.0 : 0.5));
        vec2 gx = dFdx(cuv) * vec2(0.25, 0.5);
        vec2 gy = dFdy(cuv) * vec2(0.25, 0.5);
        vec4 tc = textureGrad(map, auv, gx, gy);
        float msk = textureGrad(maskMap, auv, gx, gy).r;
        diffuseColor.rgb *= tc.rgb * mix(vec3(1.0), vColor.rgb, msk) * vColor.a;
        `,
      )
      .replace('#include <color_fragment>', '');
  };
  mat.customProgramCacheKey = () => 'facade-atlas';
  return mat;
}

// Sillería de piedra (iglesias, murallas, baluartes): 2,4 m × 2,4 m
export function makeStoneTexture() {
  const [c, g] = canvas(256, 256);
  const rng = mulberry32(11);
  g.fillStyle = '#8f8471';
  g.fillRect(0, 0, 256, 256);
  const rows = 4;
  const rh = 256 / rows;
  for (let r = 0; r < rows; r++) {
    const off = r % 2 ? 64 : 0;
    for (let k = -1; k < 3; k++) {
      const x = k * 128 + off;
      const v = 0.85 + rng() * 0.25;
      const base = new THREE.Color('#d8c9a8').multiplyScalar(v);
      g.fillStyle = '#' + base.getHexString();
      g.fillRect(x + 2, r * rh + 2, 124, rh - 4);
      for (let i = 0; i < 60; i++) {
        g.fillStyle = `rgba(${rng() < 0.5 ? '60,50,35' : '255,250,235'},${0.06 + rng() * 0.08})`;
        g.fillRect(x + 2 + rng() * 120, r * rh + 2 + rng() * (rh - 8), 2 + rng() * 6, 2 + rng() * 4);
      }
      g.fillStyle = 'rgba(255,255,255,0.18)';
      g.fillRect(x + 2, r * rh + 2, 124, 2);
      g.fillStyle = 'rgba(0,0,0,0.18)';
      g.fillRect(x + 2, r * rh + rh - 5, 124, 3);
    }
  }
  return toTexture(c);
}

// Ladrillo (torres de San Saturnino): 1,2 m × 1,2 m
export function makeBrickTexture() {
  const [c, g] = canvas(128, 128);
  const rng = mulberry32(5);
  g.fillStyle = '#c9b49a';
  g.fillRect(0, 0, 128, 128);
  for (let r = 0; r < 16; r++) {
    const off = r % 2 ? 8 : 0;
    for (let k = -1; k < 9; k++) {
      const col = new THREE.Color('#a4583c').multiplyScalar(0.8 + rng() * 0.35);
      g.fillStyle = '#' + col.getHexString();
      g.fillRect(k * 16 + off + 1, r * 8 + 1, 14, 6);
    }
  }
  return toTexture(c);
}

// Teja árabe: filas de canales curvos, 2 m × 2 m
export function makeRoofTexture() {
  const [c, g] = canvas(256, 256);
  const rng = mulberry32(3);
  g.fillStyle = '#7a3a22';
  g.fillRect(0, 0, 256, 256);
  const cols = 12;
  const rows = 8;
  const cw = 256 / cols;
  const rh = 256 / rows;
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < cols; k++) {
      const v = 0.82 + rng() * 0.3;
      const x = k * cw;
      const y = r * rh;
      const grad = g.createLinearGradient(x, 0, x + cw, 0);
      const base = new THREE.Color(rng() < 0.12 ? '#9c5a3c' : '#c4673f').multiplyScalar(v);
      const hi = base.clone().multiplyScalar(1.25);
      const lo = base.clone().multiplyScalar(0.6);
      grad.addColorStop(0, '#' + lo.getHexString());
      grad.addColorStop(0.45, '#' + hi.getHexString());
      grad.addColorStop(1, '#' + lo.getHexString());
      g.fillStyle = grad;
      g.fillRect(x + 1, y, cw - 2, rh - 3);
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(x + 1, y + rh - 4, cw - 2, 3);
      if (rng() < 0.15) {
        g.fillStyle = 'rgba(70,80,50,0.25)';
        g.fillRect(x + 2, y + rng() * rh, cw - 4, 4);
      }
    }
  }
  return toTexture(c);
}

// Adoquinado de granito: 2 m × 2 m, piezas de ~20 × 12 cm
export function makeCobbleTexture() {
  const [c, g] = canvas(512, 512);
  const rng = mulberry32(21);
  g.fillStyle = '#5f5850';
  g.fillRect(0, 0, 512, 512);
  const rows = 16;
  const rh = 512 / rows;
  for (let r = 0; r < rows; r++) {
    let x = r % 2 ? -26 : 0;
    while (x < 512) {
      const w = 40 + rng() * 24;
      const v = 0.78 + rng() * 0.35;
      const tone = rng() < 0.15 ? '#a59683' : rng() < 0.3 ? '#9a9a97' : '#aba395';
      const col = new THREE.Color(tone).multiplyScalar(v);
      const y = r * rh;
      const rr = 6;
      g.fillStyle = '#' + col.getHexString();
      g.beginPath();
      g.roundRect(x + 2, y + 2, w - 4, rh - 4, rr);
      g.fill();
      // relieve: luz arriba-izquierda, sombra abajo
      g.fillStyle = 'rgba(255,255,255,0.16)';
      g.beginPath();
      g.roundRect(x + 4, y + 3, w - 10, 5, 3);
      g.fill();
      g.fillStyle = 'rgba(0,0,0,0.2)';
      g.beginPath();
      g.roundRect(x + 4, y + rh - 8, w - 8, 4, 2);
      g.fill();
      for (let i = 0; i < 6; i++) {
        g.fillStyle = `rgba(${rng() < 0.5 ? '30,30,30' : '255,255,255'},0.12)`;
        g.fillRect(x + 4 + rng() * (w - 10), y + 4 + rng() * (rh - 10), 2, 2);
      }
      x += w;
    }
  }
  // Hilada central de losas (canal) cada 2 m: ayuda a leer la calle
  return toTexture(c);
}

// Losas grandes (plazas): 3 m × 3 m
export function makeSlabTexture(baseHex = '#cfc3ac') {
  const [c, g] = canvas(256, 256);
  const rng = mulberry32(31);
  g.fillStyle = '#8c8170';
  g.fillRect(0, 0, 256, 256);
  const n = 4;
  const s = 256 / n;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const col = new THREE.Color(baseHex).multiplyScalar(0.88 + rng() * 0.2);
      g.fillStyle = '#' + col.getHexString();
      const off = j % 2 ? s / 2 : 0;
      g.fillRect(((i * s + off) % 256) + 1, j * s + 1, s - 2, s - 2);
      if (off) g.fillRect(((i * s + off) % 256) - 256 + 1, j * s + 1, s - 2, s - 2);
      for (let k = 0; k < 40; k++) {
        g.fillStyle = `rgba(${rng() < 0.5 ? '40,35,30' : '255,255,250'},0.07)`;
        g.fillRect(rng() * 256, j * s + rng() * s, 3, 3);
      }
    }
  }
  return toTexture(c);
}

export function makeAsphaltTexture() {
  const [c, g] = canvas(256, 256);
  const rng = mulberry32(41);
  g.fillStyle = '#56575c';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 9000; i++) {
    const v = Math.floor(60 + rng() * 70);
    g.fillStyle = `rgba(${v},${v},${v + 4},0.35)`;
    g.fillRect(rng() * 256, rng() * 256, 1 + rng() * 2, 1 + rng() * 2);
  }
  return toTexture(c);
}

export function makeGrassTexture() {
  const [c, g] = canvas(256, 256);
  const rng = mulberry32(51);
  g.fillStyle = '#6fa34c';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 7000; i++) {
    const col = new THREE.Color().setHSL(0.24 + rng() * 0.06, 0.45 + rng() * 0.2, 0.3 + rng() * 0.2);
    g.fillStyle = '#' + col.getHexString();
    g.globalAlpha = 0.5;
    g.fillRect(rng() * 256, rng() * 256, 1 + rng() * 3, 2 + rng() * 4);
  }
  g.globalAlpha = 1;
  return toTexture(c);
}
