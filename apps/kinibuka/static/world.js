// KiniBuka 3D market: the stalls from Explore as a walkable low-poly street, with each stall's menu on a
// chalkboard and the live or upcoming bazaars as tents at the far end.
// Controls: tap/click the street to walk, tap a stall to go to it, drag to look around,
// pinch or scroll to zoom, WASD/arrow keys on desktop (when the canvas has focus).
// Built from primitives only (no model files to download). Engine pattern ported from Jeda.
// Any number of stalls: only the rows near the visitor are built; the rest are just positions.

import * as THREE from './vendor/three.module.min.js';

export function webglAvailable() {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(window.WebGLRenderingContext && (
      canvas.getContext('webgl2') || canvas.getContext('webgl') || canvas.getContext('experimental-webgl')
    ));
  } catch {
    return false;
  }
}

// Pick a starting quality from the device; the loop then adapts to the real frame rate.
function detectQuality() {
  const memory = navigator.deviceMemory || 4;
  const cores = navigator.hardwareConcurrency || 4;
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && window.innerWidth < 900);
  if (memory <= 3 || (cores <= 4 && mobile)) {
    return 'low';
  }
  return mobile ? 'medium' : 'high';
}

const QUALITY = {
  low: { pixelRatio: 1, shadows: false, shadowMap: 512, antialias: false },
  medium: { pixelRatio: 1.5, shadows: true, shadowMap: 1024, antialias: true },
  high: { pixelRatio: 2, shadows: true, shadowMap: 1024, antialias: true },
};

const SKIES = {
  dawn: { top: '#f0a987', bottom: '#fde5c8', fog: '#f4d8be', sun: '#ffd2a1', sunIntensity: 1.6, hemi: 1.0, sunOffset: [-20, 12, 10] },
  day: { top: '#8fc3ea', bottom: '#e9f3f6', fog: '#dceaf0', sun: '#fff4df', sunIntensity: 2.2, hemi: 1.2, sunOffset: [12, 30, 14] },
  dusk: { top: '#5b5d9c', bottom: '#f3b07c', fog: '#d9a283', sun: '#ffb27a', sunIntensity: 1.4, hemi: 0.9, sunOffset: [24, 10, -6] },
  night: { top: '#0b1230', bottom: '#2c3762', fog: '#1d2546', sun: '#b9c8ff', sunIntensity: 1.3, hemi: 1.0, ambient: 1.1, sunOffset: [-10, 26, 8] },
};

function timeOfDay(hour) {
  if (hour >= 5 && hour < 7) {
    return 'dawn';
  }
  if (hour >= 7 && hour < 17) {
    return 'day';
  }
  return hour >= 17 && hour < 19 ? 'dusk' : 'night';
}

// Street layout: stalls alternate left/right of a street that runs towards -z.
const ROW_SPACING = 4.6; // distance between stall rows along the street
const STALL_X = 4.4; // stall centre, left (-) and right (+) of the street
const STAND_X = 2.3; // where a visitor stands in front of a stall
const WALK_X = 2.9; // walkable half-width of the street (keeps the avatar out of the stalls)
const START_Z = 6; // the avatar starts here, before the gate
const NEAR_RADIUS = 2.5; // a stall counts as "near" within this distance of its standing spot
const GATE_Z = 3.4; // the entrance gate stands here
const PICK_FRONT = STALL_X - WALK_X - 0.05; // a stall's tap target ends just outside the walking lane
const PICK_DEPTH = 2.65; // and reaches back over the booth
const BUILD_DISTANCE = 48; // rows closer than this (along the street) are built...
const DROP_DISTANCE = 58; // ...and rows further than this are freed again
const FOG_NEAR = 24;
const FOG_FAR = 62; // rows appear and disappear inside the fog, so nothing pops in sight
const TIE_MARGIN = 0.4; // stalls whose distance differs by less than this count as equally near

const CLOSED = { awning: ['#9ca3af', '#e5e7eb'], wall: '#d7dadf', roof: '#8b9099', ring: '#9ca3af' };
const OPEN_RING = '#22c55e';

// ---------- Primitives ----------
const materialCache = new Map();

function mat(color, options = {}) {
  const key = `${color}|${JSON.stringify(options)}`;
  if (!materialCache.has(key)) {
    materialCache.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, flatShading: true, ...options }));
  }
  return materialCache.get(key);
}

function mesh(geometry, color, options) {
  const m = new THREE.Mesh(geometry, mat(color, options));
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// Every stall uses the same few shapes, so their geometry is shared instead of rebuilt per stall.
const geometryCache = new Map();

function shared(key, make) {
  if (!geometryCache.has(key)) {
    geometryCache.set(key, make());
  }
  return geometryCache.get(key);
}

const box = (w, h, d, color, options) => mesh(shared(`box|${w}|${h}|${d}`, () => new THREE.BoxGeometry(w, h, d)), color, options);
const cyl = (rt, rb, h, color, seg = 12, options) => mesh(shared(`cyl|${rt}|${rb}|${h}|${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg)), color, options);
const sphere = (r, color, seg = 12, options) => mesh(shared(`sphere|${r}|${seg}`, () => new THREE.SphereGeometry(r, seg, Math.max(6, seg / 2))), color, options);
const cone = (r, h, color, seg = 8, options) => mesh(shared(`cone|${r}|${h}|${seg}`, () => new THREE.ConeGeometry(r, h, seg)), color, options);

function put(object, x, y, z) {
  object.position.set(x, y, z);
  return object;
}

// Free GPU memory of everything under `root`. Cached materials and geometry are shared, so they are
// kept until the whole market is destroyed.
function disposeTree(root) {
  const sharedMaterials = new Set(materialCache.values());
  const sharedGeometry = new Set(geometryCache.values());
  root.traverse((object) => {
    if (object.geometry && !sharedGeometry.has(object.geometry)) {
      object.geometry.dispose();
    }
    if (object.material && !sharedMaterials.has(object.material)) {
      if (object.material.map) {
        object.material.map.dispose();
      }
      object.material.dispose();
    }
  });
}

function gradientTexture(top, bottom) {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  const gradient = context.createLinearGradient(0, 0, 0, 256);
  gradient.addColorStop(0, top);
  gradient.addColorStop(1, bottom);
  context.fillStyle = gradient;
  context.fillRect(0, 0, 4, 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// A rounded label that always faces the camera. `lines` are stacked and centred.
function labelSprite(lines, background = 'rgba(20,18,16,0.62)') {
  const font = (line) => `${line.weight || 600} ${line.size}px system-ui, "Segoe UI", sans-serif`;
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  const padding = 22;
  const gap = 8;
  let width = 0;
  let height = padding * 2 - gap;
  lines.forEach((line) => {
    context.font = font(line);
    width = Math.max(width, context.measureText(line.text).width);
    height += line.size + gap;
  });
  canvas.width = Math.ceil(width) + padding * 2;
  canvas.height = Math.ceil(height);
  context.fillStyle = background;
  context.beginPath();
  if (context.roundRect) {
    context.roundRect(0, 0, canvas.width, canvas.height, 24);
  } else {
    context.rect(0, 0, canvas.width, canvas.height);
  }
  context.fill();
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  let y = padding;
  lines.forEach((line) => {
    context.font = font(line);
    context.fillStyle = line.color || '#ffffff';
    context.fillText(line.text, canvas.width / 2, y + line.size / 2 + 2);
    y += line.size + gap;
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  // Labels draw on top of the scene, so bunting, the gate and roofs never hide a stall's name.
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthWrite: false, depthTest: false, transparent: true }));
  sprite.renderOrder = 10;
  const scale = 0.0072;
  sprite.scale.set(canvas.width * scale, canvas.height * scale, 1);
  return sprite;
}

const shorten = (text, max = 22) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

// ---------- Stalls ----------
// What an open stall shows on its counter, per category (counter top is at y = 1.02).
const GOODS = {
  Food(group) {
    ['#f59e0b', '#84cc16', '#ef4444'].forEach((topping, i) => {
      const x = -1.0 + i * 0.5;
      group.add(put(cyl(0.17, 0.11, 0.12, '#ffffff'), x, 1.08, 0.6));
      group.add(put(sphere(0.12, topping, 8), x, 1.13, 0.6));
    });
    group.add(put(cyl(0.24, 0.24, 0.3, '#4b5563'), 0.85, 1.17, 0.55));
    group.add(put(cyl(0.26, 0.26, 0.04, '#9ca3af'), 0.85, 1.34, 0.55));
  },
  Drinks(group) {
    ['#fb923c', '#f472b6', '#86efac', '#fde047'].forEach((juice, i) => {
      const x = -1.05 + i * 0.36;
      group.add(put(cyl(0.09, 0.07, 0.26, juice), x, 1.15, 0.62));
      group.add(put(cyl(0.012, 0.012, 0.2, '#ffffff', 6), x + 0.03, 1.34, 0.62));
    });
    group.add(put(cyl(0.22, 0.22, 0.5, '#f97316', 12, { transparent: true, opacity: 0.8 }), 0.8, 1.27, 0.5));
    group.add(put(cyl(0.24, 0.24, 0.06, '#1f2937'), 0.8, 1.55, 0.5));
  },
  Snacks(group) {
    ['#fbbf24', '#f87171', '#a78bfa'].forEach((sweet, i) => {
      const x = -1.0 + i * 0.45;
      group.add(put(cyl(0.15, 0.15, 0.3, sweet, 12, { transparent: true, opacity: 0.85 }), x, 1.17, 0.6));
      group.add(put(cyl(0.16, 0.16, 0.05, '#b91c1c'), x, 1.34, 0.6));
    });
    [[0.6, 0.55], [0.82, 0.62], [0.72, 0.42], [0.72, 0.55]].forEach(([x, z], i) => {
      group.add(put(sphere(0.1, '#d97706', 8), x, i === 3 ? 1.24 : 1.1, z));
    });
  },
  Fashion(group) {
    group.add(put(box(2.6, 0.04, 0.04, '#6b4a2f'), 0, 2.0, 0.2));
    ['#ef4444', '#3b82f6', '#f59e0b', '#10b981', '#8b5cf6'].forEach((cloth, i) => {
      const x = -1.0 + i * 0.5;
      group.add(put(box(0.38, 0.5, 0.05, cloth), x, 1.72, 0.2));
      group.add(put(box(0.6, 0.14, 0.05, cloth), x, 1.9, 0.2));
    });
    ['#fde68a', '#bfdbfe', '#fecaca'].forEach((cloth, i) => {
      group.add(put(box(0.5, 0.07, 0.36, cloth), 0.7, 1.06 + i * 0.07, 0.6));
    });
  },
  Crafts(group) {
    [['#c2410c', -0.95], ['#0f766e', -0.45], ['#b45309', 0.05]].forEach(([clay, x]) => {
      group.add(put(sphere(0.16, clay, 10), x, 1.17, 0.6));
      group.add(put(cyl(0.07, 0.1, 0.16, clay, 10), x, 1.34, 0.6));
    });
    group.add(put(cyl(0.26, 0.2, 0.22, '#d6b98c', 10), 0.85, 1.13, 0.55));
    group.add(put(cone(0.2, 0.2, '#f59e0b', 8), 0.85, 1.32, 0.55));
  },
  Services(group) {
    group.add(put(box(0.6, 0.26, 0.32, '#dc2626'), -0.75, 1.15, 0.58));
    group.add(put(box(0.3, 0.05, 0.05, '#1f2937'), -0.75, 1.31, 0.58));
    group.add(put(box(0.52, 0.03, 0.36, '#374151'), 0.55, 1.04, 0.6));
    const screen = put(box(0.52, 0.34, 0.03, '#60a5fa', { emissive: '#60a5fa', emissiveIntensity: 0.35 }), 0.55, 1.2, 0.43);
    screen.rotation.x = -0.2;
    group.add(screen);
  },
  Other(group) {
    group.add(put(box(0.5, 0.36, 0.4, '#a16207'), -0.8, 1.2, 0.58));
    group.add(put(box(0.44, 0.3, 0.36, '#ca8a04'), -0.2, 1.17, 0.6));
    group.add(put(box(0.36, 0.26, 0.3, '#a16207'), -0.6, 1.51, 0.58));
    group.add(put(sphere(0.14, '#6b7280', 8), 0.7, 1.16, 0.6));
  },
};

// Cut `text` to fit `maxWidth` pixels in the context's current font.
function fitText(context, text, maxWidth) {
  if (context.measureText(text).width <= maxWidth) {
    return text;
  }
  let cut = text;
  while (cut.length > 1 && context.measureText(`${cut}…`).width > maxWidth) {
    cut = cut.slice(0, -1);
  }
  return `${cut.trimEnd()}…`;
}

const MENU_LINES = 5; // items written on a stall's chalkboard; the card below the canvas lists them all

// The stall's menu chalked on a board: up to MENU_LINES items with prices, then "+N more".
function menuBoardTexture(menu, words) {
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 400;
  const context = canvas.getContext('2d');
  const font = (weight, size) => `${weight} ${size}px system-ui, "Segoe UI", sans-serif`;
  context.fillStyle = '#8b5e34';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#1f3b2f';
  context.fillRect(14, 14, canvas.width - 28, canvas.height - 28);
  context.textBaseline = 'middle';
  context.textAlign = 'center';
  context.fillStyle = '#fde68a';
  context.font = font(700, 40);
  context.fillText(words.menu, canvas.width / 2, 54);
  context.strokeStyle = 'rgba(253, 230, 138, 0.55)';
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(44, 86);
  context.lineTo(canvas.width - 44, 86);
  context.stroke();
  menu.slice(0, MENU_LINES).forEach((item, i) => {
    const y = 118 + i * 50;
    context.font = font(600, 22);
    context.textAlign = 'right';
    context.fillStyle = '#fcd34d';
    context.fillText(item.price, canvas.width - 30, y);
    const priceWidth = context.measureText(item.price).width;
    context.font = font(500, 24);
    context.textAlign = 'left';
    context.fillStyle = '#f9fafb';
    context.fillText(fitText(context, item.name, canvas.width - 72 - priceWidth), 30, y);
  });
  if (menu.length > MENU_LINES) {
    context.font = font(500, 22);
    context.textAlign = 'center';
    context.fillStyle = 'rgba(249, 250, 251, 0.7)';
    context.fillText(words.more(menu.length - MENU_LINES), canvas.width / 2, 362);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// An A-frame chalkboard standing on the street beside the counter, turned a little towards the gate
// so visitors walking in can read it. `side` is -1 (left of the street) or 1 (right).
function buildMenuBoard(menu, open, night, side, words) {
  const group = new THREE.Group();
  group.add(put(box(1.24, 1.54, 0.05, '#6b4a2f'), 0, 0.97, 0));
  [-0.6, 0.6].forEach((x) => group.add(put(box(0.06, 1.8, 0.06, '#5b3d24'), x, 0.9, 0.01)));
  const strut = put(box(0.06, 1.6, 0.06, '#5b3d24'), 0, 0.78, -0.32);
  strut.rotation.x = 0.32;
  group.add(strut);
  const tint = !open ? '#9ca3af' : night ? '#e5e7eb' : '#ffffff';
  const face = new THREE.Mesh(
    shared('menu-face', () => new THREE.PlaneGeometry(1.15, 1.44)),
    // Unlit and not tone-mapped, so the chalk stays readable by day and by night.
    new THREE.MeshBasicMaterial({ map: menuBoardTexture(menu, words), color: tint, toneMapped: false }),
  );
  face.position.set(0, 0.97, 0.03);
  group.add(face);
  // A thin tap target on the board itself: turned with the board it stays outside the walking lane
  // (which starts STALL_X - WALK_X = 1.5 m in front of the stall), so street taps beside it still walk.
  const pick = new THREE.Mesh(shared('menu-pick', () => new THREE.BoxGeometry(1.25, 1.9, 0.1)), new THREE.MeshBasicMaterial({ visible: false }));
  pick.position.set(0, 0.97, 0);
  group.add(pick);
  // In the stall's own frame +x points towards the gate on the right-hand side and away from it on the left.
  group.position.set(side * 2.15, 0, 1.15);
  group.rotation.y = side * 0.5;
  return { group, pick };
}

// One stand, modelled facing +z; the caller rotates it to face the street.
function buildStall(stall, colors, night, side = -1, words = { menu: 'Menu', more: (n) => `+${n}` }) {
  const [light, dark] = colors[stall.category] || colors.Other || ['#f3f4f6', '#374151'];
  const group = new THREE.Group();
  const wallGlow = stall.open && night ? { emissive: light, emissiveIntensity: 0.4 } : undefined;

  group.add(put(box(2.9, 0.95, 0.7, '#b98a5a'), 0, 0.475, 0.55));
  group.add(put(box(3.05, 0.07, 0.85, '#e8d3b0'), 0, 0.985, 0.55));
  group.add(put(box(3.0, 2.4, 0.1, stall.open ? light : CLOSED.wall, wallGlow), 0, 1.2, -1.05));
  [-1.45, 1.45].forEach((x) => {
    [-1.0, 0.9].forEach((z) => group.add(put(box(0.1, 2.4, 0.1, '#6b4a2f'), x, 1.2, z)));
  });
  group.add(put(box(3.2, 0.1, 2.2, stall.open ? dark : CLOSED.roof), 0, 2.45, -0.05));

  // Striped awning, hinged at the roof's front edge and sloping down towards the street.
  const awning = new THREE.Group();
  awning.position.set(0, 2.42, 1.0);
  awning.rotation.x = 0.28;
  const stripes = 6;
  const stripeWidth = 3.2 / stripes;
  for (let i = 0; i < stripes; i++) {
    const color = stall.open ? (i % 2 ? '#ffffff' : dark) : CLOSED.awning[i % 2];
    awning.add(put(box(stripeWidth, 0.06, 0.9, color), -1.6 + stripeWidth * (i + 0.5), 0, 0.45));
  }
  group.add(awning);

  if (stall.open) {
    (GOODS[stall.category] || GOODS.Other)(group);
    group.add(put(cyl(0.01, 0.01, 0.3, '#374151', 6), 0, 2.25, 0.5));
    group.add(put(sphere(0.1, '#fff1c2', 10, { emissive: '#ffcf70', emissiveIntensity: night ? 2.2 : 0.7 }), 0, 2.06, 0.5));
  } else {
    group.add(put(box(2.9, 1.42, 0.06, '#8b9099'), 0, 1.71, 0.88));
    [1.3, 1.6, 1.9, 2.2].forEach((y) => group.add(put(box(2.9, 0.03, 0.08, '#6b7280'), 0, y, 0.88)));
  }

  // Where to stand: a pulsing ring on the street in front of the counter.
  const ring = new THREE.Mesh(
    shared('ring', () => new THREE.RingGeometry(0.55, 0.75, 32)),
    new THREE.MeshBasicMaterial({ color: stall.open ? OPEN_RING : CLOSED.ring, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(0, 0.05, STALL_X - STAND_X);
  group.add(ring);

  const label = labelSprite([
    { text: shorten(stall.name), size: 46 },
    { text: stall.status, size: 38, color: stall.open ? '#86efac' : '#d1d5db' },
  ]);
  label.position.set(0, 3.45, 0.4);
  group.add(label);
  label.userData.fadeNear = true;

  // Invisible tap target: the booth and its label. It stops at the edge of the walking lane, so a tap
  // on the street always walks, also when you already stand at this stall.
  const pick = new THREE.Mesh(shared('pick', () => new THREE.BoxGeometry(3.3, 4, PICK_DEPTH)), new THREE.MeshBasicMaterial({ visible: false }));
  pick.position.set(0, 2, PICK_FRONT - PICK_DEPTH / 2);
  group.add(pick);
  const picks = [pick];

  if (stall.menu && stall.menu.length) {
    const board = buildMenuBoard(stall.menu, stall.open, night, side, words);
    group.add(board.group);
    picks.push(board.pick);
  }

  return { group, ring, picks };
}

// A bazaar: a purple marquee with fairy lights and trestle tables, in the same slot as a stall.
function buildBazaarTent(bazaar, night) {
  const group = new THREE.Group();
  const canvasColor = bazaar.open ? '#6d28d9' : '#8b5cf6';
  [-1.5, 1.5].forEach((x) => {
    [-1.0, 1.0].forEach((z) => group.add(put(cyl(0.05, 0.05, 2.5, '#e5e7eb', 8), x, 1.25, z)));
  });
  const roof = put(cone(2.35, 1.2, canvasColor, 4), 0, 3.08, 0);
  roof.rotation.y = Math.PI / 4;
  roof.scale.set(1, 1, 0.72);
  group.add(roof);
  const stripes = 8;
  const stripeWidth = 3.32 / stripes;
  for (let i = 0; i < stripes; i++) {
    group.add(put(box(stripeWidth, 0.32, 0.04, i % 2 ? '#ffffff' : canvasColor), -1.66 + stripeWidth * (i + 0.5), 2.32, 1.2));
  }
  [-0.75, 0.75].forEach((x, t) => {
    group.add(put(box(1.2, 0.75, 0.6, '#f5f5f4'), x, 0.375, 0.2));
    group.add(put(box(1.26, 0.04, 0.66, '#c4b5fd'), x, 0.77, 0.2));
    ['#f59e0b', '#ef4444', '#10b981'].forEach((color, i) => {
      group.add(put(box(0.24, 0.18 + ((i + t) % 2) * 0.1, 0.24, color), x - 0.36 + i * 0.36, 0.88, 0.2));
    });
  });
  ['#fde047', '#f472b6', '#60a5fa', '#86efac', '#fde047', '#f472b6', '#60a5fa'].forEach((color, i) => {
    group.add(put(sphere(0.06, color, 8, { emissive: color, emissiveIntensity: night ? 2.2 : 0.6 }), -1.5 + i * 0.5, 2.12, 1.24));
  });

  const ring = new THREE.Mesh(
    shared('ring', () => new THREE.RingGeometry(0.55, 0.75, 32)),
    new THREE.MeshBasicMaterial({ color: '#a78bfa', transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(0, 0.05, STALL_X - STAND_X);
  group.add(ring);

  const label = labelSprite([
    { text: shorten(bazaar.name), size: 46 },
    { text: bazaar.status, size: 34, color: '#ddd6fe' },
  ], 'rgba(76, 29, 149, 0.85)');
  label.position.set(0, 4.25, 0.4);
  group.add(label);
  label.userData.fadeNear = true;

  const pick = new THREE.Mesh(shared('pick', () => new THREE.BoxGeometry(3.3, 4, PICK_DEPTH)), new THREE.MeshBasicMaterial({ visible: false }));
  pick.position.set(0, 2, PICK_FRONT - PICK_DEPTH / 2);
  group.add(pick);
  return { group, ring, picks: [pick] };
}

function buildTree(scale) {
  const group = new THREE.Group();
  group.add(put(cyl(0.16, 0.22, 1.4, '#7a5a3a', 6), 0, 0.7, 0));
  group.add(put(sphere(1.0, '#5b9a4d', 7), 0, 2.1, 0));
  group.add(put(sphere(0.7, '#6fb05c', 7), 0.35, 2.85, 0.1));
  group.scale.setScalar(scale);
  return group;
}

// Triangular flags on sagging strings across the street, as one mesh (one draw call).
function buildBunting(rows) {
  const positions = [];
  const vertexColors = [];
  const palette = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#ec4899', '#ffffff'].map((c) => new THREE.Color(c));
  const flags = 11;
  for (let row = 0; row < rows; row++) {
    const z = 2.3 - row * ROW_SPACING;
    for (let i = 0; i < flags; i++) {
      const u = (i + 0.5) / flags;
      const x = -3.3 + u * 6.6;
      const y = 3.75 - Math.sin(u * Math.PI) * 0.45;
      positions.push(x - 0.2, y, z, x + 0.2, y, z, x, y - 0.42, z);
      const color = palette[(i + row) % palette.length];
      for (let v = 0; v < 3; v++) {
        vertexColors.push(color.r, color.g, color.b);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(vertexColors, 3));
  return new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
}

function avatarLabel(name) {
  const label = labelSprite([{ text: shorten(name, 16), size: 40 }]);
  label.scale.multiplyScalar(0.75);
  label.position.y = 2.1;
  return label;
}

function createAvatar(name, color) {
  const group = new THREE.Group();
  const body = new THREE.Group();
  const robe = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.7, 4, 12), mat(color, { roughness: 0.7 }));
  robe.position.y = 0.72;
  robe.castShadow = true;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12), mat('#f1d9bf', { roughness: 0.6 }));
  head.position.y = 1.52;
  head.castShadow = true;
  body.add(robe, head);
  [0.36, -0.36].forEach((x) => {
    const sleeve = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.42, 3, 8), mat(color, { roughness: 0.7 }));
    sleeve.position.set(x, 0.94, 0);
    sleeve.rotation.z = x > 0 ? 0.12 : -0.12;
    body.add(sleeve);
  });
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.42, 20), new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.18, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.02;
  const label = avatarLabel(name);
  group.add(body, shadow, label);
  return { group, body, label, name, target: new THREE.Vector3(), facing: Math.PI, goal: null };
}

// ---------- Market ----------
// options: { me: { name, color }, colors: { Category: [light, dark] }, title, label, time, quality,
//   text: { menu, more(n) }, start: pose from getPose() to continue where the visitor was,
//   onNearStall(id | null, altId | null) }
// Returns { setStalls(stalls, bazaars), setName(name), walkTo(id), sideOf(id), getPose(), getState(), destroy() }
//   stalls:  [{ id, name, category, open, status, menu: [{ name, price }] }]  (price already formatted)
//   bazaars: [{ id, name, open, status }]  their ids are reported as 'bazaar-<id>'
export function createMarket(container, options = {}) {
  const {
    me = { name: 'You', color: '#0f766e' },
    colors = {},
    title = 'KiniBuka',
    label = '3D market',
    time = timeOfDay(new Date().getHours()),
    quality: requestedQuality = 'auto',
    text = {},
    start = null,
    onNearStall = () => {},
  } = options;
  const words = { menu: 'Menu', more: (n) => `+${n} more`, ...text };
  const sky = SKIES[time] || SKIES.day;
  const night = time === 'night';
  let qualityName = QUALITY[requestedQuality] ? requestedQuality : detectQuality();
  const quality = QUALITY[qualityName];

  // Try the nicest renderer first, then progressively simpler ones, so almost every phone gets 3D.
  let renderer = null;
  const attempts = [
    { antialias: quality.antialias, powerPreference: 'high-performance' },
    { antialias: false, powerPreference: 'default' },
    { antialias: false, powerPreference: 'low-power', precision: 'mediump', failIfMajorPerformanceCaveat: false },
  ];
  for (const attempt of attempts) {
    try {
      renderer = new THREE.WebGLRenderer(attempt);
      break;
    } catch {
      renderer = null;
    }
  }
  if (!renderer) {
    throw new Error('webgl-unavailable');
  }
  let pixelRatio = Math.min(window.devicePixelRatio || 1, quality.pixelRatio);
  renderer.setPixelRatio(pixelRatio);
  renderer.shadowMap.enabled = quality.shadows;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  const canvas = renderer.domElement;
  canvas.className = 'world-canvas';
  canvas.setAttribute('aria-label', label);
  canvas.tabIndex = 0;
  container.appendChild(canvas);

  const scene = new THREE.Scene();
  scene.background = gradientTexture(sky.top, sky.bottom);
  scene.fog = new THREE.Fog(sky.fog, FOG_NEAR, FOG_FAR);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);

  scene.add(new THREE.HemisphereLight(sky.top, '#8a7b66', sky.hemi));
  if (sky.ambient) {
    scene.add(new THREE.AmbientLight('#aab6e8', sky.ambient)); // the night sky alone is too dark to light the street
  }
  const sun = new THREE.DirectionalLight(sky.sun, sky.sunIntensity);
  sun.castShadow = quality.shadows;
  sun.shadow.mapSize.set(quality.shadowMap, quality.shadowMap);
  sun.shadow.camera.left = -20;
  sun.shadow.camera.right = 20;
  sun.shadow.camera.top = 20;
  sun.shadow.camera.bottom = -20;
  sun.shadow.bias = -0.0005;
  scene.add(sun, sun.target);

  // A unit plane, stretched in setStalls to cover the whole street however long it gets.
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat('#8fb86a', { roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.scale.set(420, 420, 1);
  ground.receiveShadow = true;
  scene.add(ground);

  if (night) {
    const starPositions = [];
    for (let i = 0; i < 400; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI * 0.42;
      starPositions.push(Math.sin(phi) * Math.cos(theta) * 120, Math.cos(phi) * 120, Math.sin(phi) * Math.sin(theta) * 120);
    }
    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starPositions, 3));
    scene.add(new THREE.Points(starGeometry, new THREE.PointsMaterial({ color: '#ffffff', size: 0.9, sizeAttenuation: true, fog: false })));
  }

  const tapMarker = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.3, 24), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthWrite: false }));
  tapMarker.rotation.x = -Math.PI / 2;
  scene.add(tapMarker);

  const self = createAvatar(me.name, me.color);
  self.group.position.set(0, 0, START_Z);
  self.group.rotation.y = self.facing;
  self.target.copy(self.group.position);
  scene.add(self.group);

  // ---------- Street (rebuilt whenever the stall list changes) ----------
  // Every stall and bazaar gets a slot (`placed`), but only the rows near the visitor are built as meshes,
  // so the street can be as long as the market without slowing a phone down.
  let street = null;
  let placed = []; // [{ id, kind, side, z, data, open, stand: Vector3, centre: Vector3, ring }]
  let rows = []; // [{ index, z, entries, group, picks }]
  let pickables = [];
  let signature = null;
  let nearStall = null;
  let nearAlt = null; // an equally near stall across the street that nothing could choose between
  let gateSign = null;
  let minZ = -4;
  let lastSyncZ = Infinity;
  let pendingStart = start && Number.isFinite(start.x) && Number.isFinite(start.z) ? start : null;
  let snapCamera = false;

  function clampToStreet(point) {
    point.x = THREE.MathUtils.clamp(point.x, -WALK_X, WALK_X);
    point.z = THREE.MathUtils.clamp(point.z, minZ, START_Z + 1.5);
    point.y = 0;
    return point;
  }

  function buildRow(row) {
    const group = new THREE.Group();
    row.picks = [];
    row.entries.forEach((entry) => {
      const built = entry.kind === 'bazaar'
        ? buildBazaarTent(entry.data, night)
        : buildStall(entry.data, colors, night, entry.side, words);
      built.group.position.set(entry.side * STALL_X, 0, entry.z);
      built.group.rotation.y = -entry.side * Math.PI / 2; // the front faces the street
      group.add(built.group);
      entry.ring = built.ring;
      built.picks.forEach((pick) => {
        pick.userData.stall = entry;
        row.picks.push(pick);
      });
    });
    // Trees between the rows; the last row also plants the ones that close the street.
    const treeRows = row.index === rows.length - 1 ? [row.index, row.index + 1] : [row.index];
    treeRows.forEach((treeRow) => {
      [-1, 1].forEach((side) => {
        const tree = buildTree(0.9 + ((treeRow * 7 + side + 1) % 5) * 0.12);
        tree.position.set(side * (8.6 + ((treeRow * 3 + side + 1) % 3) * 0.9), 0, 2.3 - treeRow * ROW_SPACING);
        group.add(tree);
      });
    });
    street.add(group);
    group.updateMatrixWorld(true);
    row.group = group;
    row.labels = [];
    group.traverse((object) => {
      if (object.userData.fadeNear) {
        row.labels.push({ sprite: object, at: object.getWorldPosition(new THREE.Vector3()) });
      }
    });
  }

  function dropRow(row) {
    street.remove(row.group);
    disposeTree(row.group);
    row.group = null;
    row.picks = [];
    row.labels = [];
    row.entries.forEach((entry) => {
      entry.ring = null;
    });
  }

  // Build the rows that came within reach and free the ones left far behind (or far ahead).
  function syncRows(force = false) {
    const z = self.group.position.z;
    if (!force && Math.abs(z - lastSyncZ) < 2) {
      return;
    }
    lastSyncZ = z;
    let changed = false;
    rows.forEach((row) => {
      const distance = Math.abs(row.z - z);
      if (!row.group && distance < BUILD_DISTANCE) {
        buildRow(row);
        changed = true;
      } else if (row.group && distance > DROP_DISTANCE) {
        dropRow(row);
        changed = true;
      }
    });
    if (changed) {
      pickables = rows.flatMap((row) => row.picks);
    }
  }

  function setStalls(list, bazaars = []) {
    const next = JSON.stringify([
      list.map((s) => [s.id, s.name, s.category, s.open, s.status, s.menu]),
      bazaars.map((z) => [z.id, z.name, z.open, z.status]),
    ]);
    if (next === signature) {
      return;
    }
    signature = next;
    if (street) {
      scene.remove(street);
      disposeTree(street); // also frees every built row, they live inside the street
    }
    street = new THREE.Group();
    // Stalls first, then the bazaars as tents at the far end of the street.
    const items = [
      ...list.map((data) => ({ kind: 'stall', id: data.id, data })),
      ...bazaars.map((data) => ({ kind: 'bazaar', id: `bazaar-${data.id}`, data })),
    ];
    const rowCount = Math.max(1, Math.ceil(items.length / 2));
    const length = (rowCount - 1) * ROW_SPACING + 13;
    minZ = -(rowCount - 1) * ROW_SPACING - 4;

    const paving = new THREE.Mesh(new THREE.PlaneGeometry(6.8, length), mat('#d9cdb8', { roughness: 1 }));
    paving.rotation.x = -Math.PI / 2;
    paving.position.set(0, 0.01, START_Z + 2 - length / 2);
    paving.receiveShadow = true;
    street.add(paving);
    ground.scale.set(420, length + 420, 1);
    ground.position.z = START_Z + 2 - length / 2;

    // Entrance gate with the app name.
    [-3.5, 3.5].forEach((x) => street.add(put(box(0.24, 4.2, 0.24, '#6b4a2f'), x, 2.1, GATE_Z)));
    street.add(put(box(7.4, 0.3, 0.3, '#0f766e'), 0, 4.2, GATE_Z));
    gateSign = labelSprite([{ text: title, size: 54, weight: 700 }], 'rgba(15,118,110,0.92)');
    gateSign.position.set(0, 4.95, GATE_Z);
    street.add(gateSign);
    street.add(buildBunting(rowCount));

    rows = Array.from({ length: rowCount }, (_, index) => ({ index, z: -index * ROW_SPACING, entries: [], group: null, picks: [], labels: [] }));
    placed = items.map((item, index) => {
      const side = index % 2 ? 1 : -1;
      const row = rows[Math.floor(index / 2)];
      const entry = {
        ...item,
        side,
        z: row.z,
        open: Boolean(item.data.open),
        stand: new THREE.Vector3(side * STAND_X, 0, row.z),
        centre: new THREE.Vector3(side * STALL_X, 0, row.z),
        ring: null,
      };
      row.entries.push(entry);
      return entry;
    });

    scene.add(street);
    street.updateMatrixWorld(true);
    if (pendingStart && items.length) {
      // Back where the visitor was before the view was closed (language switch, another tab, reload).
      self.group.position.set(pendingStart.x, 0, pendingStart.z);
      clampToStreet(self.group.position);
      self.target.copy(self.group.position);
      if (Number.isFinite(pendingStart.facing)) {
        self.facing = pendingStart.facing;
        self.group.rotation.y = self.facing;
      }
      pendingStart = null;
      snapCamera = true;
    } else {
      clampToStreet(self.target);
    }
    self.goal = null;
    pickables = [];
    syncRows(true);
    // Report again after a rebuild, so the page can refresh what it shows for the stall you stand at.
    nearStall = null;
    nearAlt = null;
    onNearStall(null, null);
  }

  // ---------- Camera rig ----------
  const rig = { yaw: 0, pitch: 0.4, distance: 9.5, targetDistance: 9.5 };

  function updateCamera(delta) {
    rig.distance += (rig.targetDistance - rig.distance) * Math.min(1, delta * 6);
    // Look a little ahead of the avatar so it sits in the lower third and the street stays in view.
    const ahead = new THREE.Vector3(-Math.sin(rig.yaw), 0, -Math.cos(rig.yaw)).multiplyScalar(2.6);
    const focus = self.group.position.clone().add(new THREE.Vector3(0, 1.5, 0)).add(ahead);
    const offset = new THREE.Vector3(
      Math.sin(rig.yaw) * Math.cos(rig.pitch),
      Math.sin(rig.pitch),
      Math.cos(rig.yaw) * Math.cos(rig.pitch),
    ).multiplyScalar(rig.distance);
    camera.position.lerp(focus.clone().add(offset), Math.min(1, delta * 5));
    camera.lookAt(focus);
  }

  // ---------- Input ----------
  const raycaster = new THREE.Raycaster();
  const pointers = new Map();
  let drag = null;
  let pinchStart = 0;
  const keys = new Set();
  const WALK_KEYS = ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'];

  function toNdc(event) {
    const rect = canvas.getBoundingClientRect();
    return new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
  }

  function handleTap(event) {
    raycaster.setFromCamera(toNdc(event), camera);
    const stallHit = raycaster.intersectObjects(pickables, false)[0];
    if (stallHit) {
      self.goal = stallHit.object.userData.stall;
      self.target.copy(self.goal.stand);
      return;
    }
    const groundHit = raycaster.intersectObject(ground, false)[0];
    if (groundHit) {
      clampToStreet(self.target.copy(groundHit.point));
      self.goal = null;
      tapMarker.position.set(self.target.x, 0.06, self.target.z);
      tapMarker.material.opacity = 0.9;
    }
  }

  const onPointerDown = (event) => {
    canvas.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 1) {
      drag = { x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, time: performance.now() };
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchStart = Math.hypot(a.x - b.x, a.y - b.y);
      drag = null;
    }
  };
  const onPointerMove = (event) => {
    if (!pointers.has(event.pointerId)) {
      return;
    }
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchStart && distance) {
        rig.targetDistance = THREE.MathUtils.clamp(rig.targetDistance * (pinchStart / distance), 4, 18);
      }
      pinchStart = distance;
      return;
    }
    if (drag) {
      rig.yaw -= (event.clientX - drag.x) * 0.006;
      rig.pitch = THREE.MathUtils.clamp(rig.pitch + (event.clientY - drag.y) * 0.004, 0.12, 1.2);
      drag.x = event.clientX;
      drag.y = event.clientY;
    }
  };
  const onPointerUp = (event) => {
    pointers.delete(event.pointerId);
    if (drag && pointers.size === 0 && event.type === 'pointerup') {
      const moved = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
      if (moved < 8 && performance.now() - drag.time < 450) {
        handleTap(event);
      }
    }
    if (pointers.size < 2) {
      pinchStart = 0;
    }
    drag = null;
  };
  const onWheel = (event) => {
    event.preventDefault();
    rig.targetDistance = THREE.MathUtils.clamp(rig.targetDistance + event.deltaY * 0.01, 4, 18);
  };
  const onKeyDown = (event) => {
    const key = event.key.toLowerCase();
    if (WALK_KEYS.includes(key) && !event.ctrlKey && !event.metaKey && !event.altKey) {
      keys.add(key);
      event.preventDefault();
    }
  };
  const onKeyUp = (event) => keys.delete(event.key.toLowerCase());
  const onBlur = () => keys.clear();
  // Phones may drop the GPU context (backgrounding, memory pressure); keep the page alive and let it restore.
  const onContextLost = (event) => {
    event.preventDefault();
    running = false;
    cancelAnimationFrame(frame);
    container.classList.add('context-lost');
  };
  const onContextRestored = () => {
    container.classList.remove('context-lost');
    running = true;
    clock.getDelta();
    tick();
  };
  canvas.addEventListener('webglcontextlost', onContextLost);
  canvas.addEventListener('webglcontextrestored', onContextRestored);
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('keydown', onKeyDown);
  canvas.addEventListener('keyup', onKeyUp);
  canvas.addEventListener('blur', onBlur);

  // ---------- Loop ----------
  const clock = new THREE.Clock();
  let elapsed = 0;
  let frame = 0;
  let running = true;

  function moveAvatar(delta) {
    const position = self.group.position;
    const toTarget = self.target.clone().sub(position);
    toTarget.y = 0;
    const distance = toTarget.length();
    if (distance > 0.05) {
      // A stroll for short hops, a jog for a stall far down a long street.
      const speed = THREE.MathUtils.clamp(distance * 0.9, 3.4, 12);
      position.add(toTarget.normalize().multiplyScalar(Math.min(distance, speed * delta)));
      self.facing = Math.atan2(toTarget.x, toTarget.z);
      self.body.position.y = Math.abs(Math.sin(elapsed * 9)) * 0.06;
      return true;
    }
    self.body.position.y *= 0.8;
    return false;
  }

  // Which side of the street does the visitor mean? The side they stand on, else the way they face,
  // else the way the camera looks. 0 when nothing tells.
  function sideCue() {
    const position = self.group.position;
    if (Math.abs(position.x) > 0.35) {
      return Math.sign(position.x);
    }
    const facingX = Math.sin(self.facing);
    if (Math.abs(facingX) > 0.5) {
      return Math.sign(facingX);
    }
    const lookX = -Math.sin(rig.yaw);
    return Math.abs(lookX) > 0.35 ? Math.sign(lookX) : 0;
  }

  // The stall the visitor is at. Equally near stalls (within TIE_MARGIN) are settled by sideCue(); a tie
  // across the street that nothing settles is reported as a pair, so the page offers both instead of guessing.
  function updateNearStall() {
    const position = self.group.position;
    const candidates = [];
    rows.forEach((row) => {
      if (Math.abs(row.z - position.z) > NEAR_RADIUS + 0.5) {
        return;
      }
      row.entries.forEach((entry) => {
        const distance = Math.hypot(entry.stand.x - position.x, entry.stand.z - position.z);
        if (distance < NEAR_RADIUS) {
          candidates.push({ entry, distance });
        }
      });
    });
    let primary = null;
    let alt = null;
    if (candidates.length) {
      candidates.sort((a, b) => a.distance - b.distance || a.entry.side - b.entry.side);
      const tied = candidates.filter((c) => c.distance - candidates[0].distance < TIE_MARGIN).map((c) => c.entry);
      const cue = tied.length > 1 ? sideCue() : 0;
      const onCueSide = cue ? tied.filter((entry) => entry.side === cue) : [];
      const pool = onCueSide.length ? onCueSide : tied;
      // Stay with the current stall while it is still among the nearest (no flicker between neighbours).
      primary = pool.includes(nearStall) ? nearStall : pool[0];
      alt = pool.find((entry) => entry !== primary && entry.side !== primary.side) || null;
    }
    if (primary !== nearStall || alt !== nearAlt) {
      nearStall = primary;
      nearAlt = alt;
      onNearStall(primary ? primary.id : null, alt ? alt.id : null);
    }
  }

  // Adaptive quality: if the device can't hold ~28 fps, lower resolution, then drop shadows.
  let frameCount = 0;
  let windowStart = performance.now();
  let slowWindows = 0;
  function adaptQuality(now) {
    frameCount += 1;
    if (now - windowStart < 2000) {
      return;
    }
    const fps = (frameCount * 1000) / (now - windowStart);
    frameCount = 0;
    windowStart = now;
    if (document.hidden || fps >= 28) {
      slowWindows = 0;
      return;
    }
    slowWindows += 1;
    if (slowWindows < 2) {
      return;
    }
    slowWindows = 0;
    if (pixelRatio > 0.75) {
      pixelRatio = Math.max(0.75, pixelRatio - 0.25);
      renderer.setPixelRatio(pixelRatio);
      resize();
    } else if (renderer.shadowMap.enabled) {
      renderer.shadowMap.enabled = false;
      sun.castShadow = false;
      materialCache.forEach((material) => {
        material.needsUpdate = true;
      });
      qualityName = 'low';
    }
  }

  function tick() {
    if (!running) {
      return;
    }
    frame = requestAnimationFrame(tick);
    const delta = Math.min(clock.getDelta(), 0.05);
    elapsed += delta;

    if (keys.size) {
      const forward = new THREE.Vector3(-Math.sin(rig.yaw), 0, -Math.cos(rig.yaw));
      const right = new THREE.Vector3(-forward.z, 0, forward.x);
      const move = new THREE.Vector3();
      if (keys.has('w') || keys.has('arrowup')) move.add(forward);
      if (keys.has('s') || keys.has('arrowdown')) move.sub(forward);
      if (keys.has('d') || keys.has('arrowright')) move.add(right);
      if (keys.has('a') || keys.has('arrowleft')) move.sub(right);
      if (move.lengthSq() > 0) {
        clampToStreet(self.target.copy(self.group.position).add(move.normalize().multiplyScalar(0.6)));
        self.goal = null;
      }
    }

    const moving = moveAvatar(delta);
    if (!moving && self.goal) {
      // Arrived: turn to face the stall.
      self.facing = Math.atan2(self.goal.centre.x - self.group.position.x, self.goal.centre.z - self.group.position.z);
      self.goal = null;
    }
    let turn = self.facing - self.group.rotation.y;
    turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    self.group.rotation.y += turn * Math.min(1, delta * 8);

    syncRows();
    updateNearStall();

    rows.forEach((row) => {
      if (!row.group) {
        return;
      }
      row.entries.forEach((stall, i) => {
        const pulse = stall.open ? 0.55 + Math.sin(elapsed * 2.4 + row.index * 2 + i) * 0.3 : 0.35;
        stall.ring.material.opacity = stall === nearStall || stall === nearAlt ? 0.95 : pulse;
      });
    });
    tapMarker.material.opacity = Math.max(0, tapMarker.material.opacity - delta * 1.2);

    // The sun follows the visitor so shadows stay sharp along the whole street.
    sun.target.position.copy(self.group.position);
    sun.position.copy(self.group.position).add(new THREE.Vector3(...sky.sunOffset));

    adaptQuality(performance.now());
    updateCamera(snapCamera ? 1 : delta);
    snapCamera = false;
    // The avatar's own name tag fades too when you zoom right in behind it.
    const tagDistance = camera.position.distanceTo(self.label.getWorldPosition(new THREE.Vector3()));
    self.label.material.opacity = THREE.MathUtils.clamp((tagDistance - 3.5) / 2.5, 0, 1);
    self.label.visible = self.label.material.opacity > 0.02;
    // Stall names fade when the camera passes right under them, so a label never fills the screen.
    rows.forEach((row) => {
      if (!row.group) {
        return;
      }
      row.labels.forEach(({ sprite, at }) => {
        sprite.material.opacity = THREE.MathUtils.clamp((camera.position.distanceTo(at) - 2.5) / 3, 0, 1);
        sprite.visible = sprite.material.opacity > 0.02;
      });
    });
    if (gateSign) {
      // Full strength from 7 m away, gone within 3 m: the sign never fills the screen as you walk through.
      gateSign.material.opacity = THREE.MathUtils.clamp((camera.position.distanceTo(gateSign.position) - 3) / 4, 0, 1);
      gateSign.visible = gateSign.material.opacity > 0.02;
    }
    renderer.render(scene, camera);
  }

  function resize() {
    const width = container.clientWidth || 1;
    const height = container.clientHeight || 1;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    // Portrait phones get a wider lens so both rows of stalls stay in view.
    camera.fov = camera.aspect < 0.8 ? 62 : 50;
    camera.updateProjectionMatrix();
  }
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);
  resize();
  if (camera.aspect < 0.8) {
    // Portrait phones start further back and higher, so both rows of stalls fit the narrow view.
    rig.distance = 12;
    rig.targetDistance = 12;
    rig.pitch = 0.52;
  }
  if (start && Number.isFinite(start.yaw)) {
    rig.yaw = start.yaw;
    rig.pitch = THREE.MathUtils.clamp(Number(start.pitch) || rig.pitch, 0.12, 1.2);
    rig.distance = THREE.MathUtils.clamp(Number(start.distance) || rig.distance, 4, 18);
    rig.targetDistance = rig.distance;
  }
  setStalls([]);
  updateCamera(1);
  tick();

  const onVisibility = () => {
    if (document.hidden) {
      running = false;
      cancelAnimationFrame(frame);
    } else if (!running && !container.classList.contains('context-lost')) {
      running = true;
      clock.getDelta();
      tick();
    }
  };
  document.addEventListener('visibilitychange', onVisibility);

  const findPlaced = (id) => placed.find((entry) => entry.id === id) || null;

  return {
    setStalls,
    // Relabel the avatar in place (log in / log out) without rebuilding the market.
    setName(name) {
      if (!name || name === self.name) {
        return;
      }
      const next = avatarLabel(name);
      self.group.remove(self.label);
      self.label.material.map.dispose();
      self.label.material.dispose();
      self.group.add(next);
      self.label = next;
      self.name = name;
    },
    // Walk (or jog) to a stall or bazaar by id, also when its row is not built yet.
    walkTo(id) {
      const entry = findPlaced(id);
      if (!entry) {
        return false;
      }
      self.goal = entry;
      self.target.copy(entry.stand);
      return true;
    },
    sideOf(id) {
      const entry = findPlaced(id);
      return entry ? entry.side : 0;
    },
    // Where the visitor stands and looks; pass it back as `start` to continue from here.
    getPose() {
      const position = self.goal ? self.goal.stand : self.group.position;
      return {
        x: Math.round(position.x * 100) / 100,
        z: Math.round(position.z * 100) / 100,
        facing: self.facing,
        yaw: rig.yaw,
        pitch: rig.pitch,
        distance: rig.targetDistance,
      };
    },
    getState() {
      return {
        x: Math.round(self.group.position.x * 100) / 100,
        z: Math.round(self.group.position.z * 100) / 100,
        near: nearStall ? nearStall.id : null,
        nearAlt: nearAlt ? nearAlt.id : null,
        goal: self.goal ? self.goal.id : null,
        stalls: placed.filter((entry) => entry.kind === 'stall').length,
        bazaars: placed.filter((entry) => entry.kind === 'bazaar').length,
        rows: rows.length,
        builtRows: rows.filter((row) => row.group).length,
        name: self.name,
        quality: qualityName,
        time,
      };
    },
    destroy() {
      running = false;
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('keydown', onKeyDown);
      canvas.removeEventListener('keyup', onKeyUp);
      canvas.removeEventListener('blur', onBlur);
      container.classList.remove('context-lost');
      disposeTree(scene);
      scene.background.dispose();
      materialCache.forEach((material) => material.dispose());
      materialCache.clear();
      geometryCache.forEach((geometry) => geometry.dispose());
      geometryCache.clear();
      renderer.dispose();
      // Give the GPU context back right away, so switching Map/3D many times never runs out of contexts.
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}
