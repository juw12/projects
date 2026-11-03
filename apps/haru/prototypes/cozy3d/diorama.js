// Haru cozy diorama — a tiny Japanese/Korean street corner in soft 3D.
// buildDiorama({ weather, time, season, seed }) -> { scene, camera, update(dt, t) }
// Shared by the swipe-card prototype (index.html) and the scene exporter (library.html).

import * as THREE from "./vendor/three.module.js";

export const WEATHERS = ["clear", "partly_cloudy", "cloudy", "rain", "storm", "snow", "fog", "heat"];
export const TIMES = ["dawn", "morning", "noon", "dusk", "night", "late_night"];
export const SEASONS = ["spring", "summer", "autumn", "winter"];

// Palette: washi paper, sakura, matcha, hojicha, indigo, persimmon, yuzu.
export const PALETTE = {
  paper: 0xf6efe2,
  cream: 0xf3e6d0,
  plaster: 0xeee3d3,
  wood: 0xb98a63,
  woodDark: 0x8a6047,
  indigo: 0x4f5d7e,
  charcoal: 0x4a4852,
  persimmon: 0xe8875a,
  yuzu: 0xf2c14e,
  sakura: 0xf4b9c6,
  sakuraDeep: 0xee9fb2,
  matcha: 0x9dbf8e,
  matchaDeep: 0x7fa774,
  ginkgo: 0xf1c45a,
  maple: 0xd9694a,
  soil: 0x9c7a62,
  soilDark: 0x7d604e,
  asphalt: 0x8e8a92,
  stone: 0xd8d0c4,
  snow: 0xf7f8fb,
  ink: 0x3a3240,
  glass: 0xb9cfd8,
  windowWarm: 0xffd48a,
  vending: 0xdfeefa,
  red: 0xd9564f,
};

const SKY = {
  dawn: ["#f6c9b8", "#c9cfe8"],
  morning: ["#bfe0f2", "#f3f1e6"],
  noon: ["#9ccdf0", "#e6f2f7"],
  dusk: ["#8e86b8", "#f6b48f"],
  night: ["#1f2a4d", "#45507a"],
  late_night: ["#10142c", "#2a3058"],
};

const SUN = {
  dawn: { color: 0xffc7a3, intensity: 1.6, position: [8, 2.5, 3] },
  morning: { color: 0xfff1dc, intensity: 2.6, position: [6, 9, 6] },
  noon: { color: 0xffffff, intensity: 3.0, position: [3, 12, 4] },
  dusk: { color: 0xffa577, intensity: 1.8, position: [-8, 3, 5] },
  night: { color: 0x9fb2ff, intensity: 0.45, position: [-4, 8, 6] },
  late_night: { color: 0x8296e0, intensity: 0.3, position: [-4, 8, 6] },
};

function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mixColor(hexA, hexB, amount) {
  return new THREE.Color(hexA).lerp(new THREE.Color(hexB), amount);
}

function gradientTexture(top, bottom) {
  const canvas = document.createElement("canvas");
  canvas.width = 4;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  const gradient = context.createLinearGradient(0, 0, 0, 256);
  gradient.addColorStop(0, top);
  gradient.addColorStop(1, bottom);
  context.fillStyle = gradient;
  context.fillRect(0, 0, 4, 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function roundedRectShape(width, depth, radius) {
  const shape = new THREE.Shape();
  const x = -width / 2;
  const y = -depth / 2;
  shape.moveTo(x + radius, y);
  shape.lineTo(x + width - radius, y);
  shape.quadraticCurveTo(x + width, y, x + width, y + radius);
  shape.lineTo(x + width, y + depth - radius);
  shape.quadraticCurveTo(x + width, y + depth, x + width - radius, y + depth);
  shape.lineTo(x + radius, y + depth);
  shape.quadraticCurveTo(x, y + depth, x, y + depth - radius);
  shape.lineTo(x, y + radius);
  shape.quadraticCurveTo(x, y, x + radius, y);
  return shape;
}

export function buildDiorama({ weather = "clear", time = "noon", season = "spring", seed = 7 } = {}) {
  const random = mulberry32(seed);
  const scene = new THREE.Scene();
  const night = time === "night" || time === "late_night";
  const snowy = season === "winter" || weather === "snow";
  const overcast = ["cloudy", "rain", "storm", "snow", "fog"].includes(weather);
  const materials = new Map();
  const animated = [];
  const nightLights = [];

  function material(color, options = {}) {
    const key = `${color}-${JSON.stringify(options)}`;
    if (!materials.has(key)) {
      materials.set(
        key,
        new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...options })
      );
    }
    return materials.get(key);
  }

  function add(mesh, x = 0, y = 0, z = 0, parent = scene) {
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  function box(width, height, depth, color, x, y, z, parent, options) {
    return add(new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material(color, options)), x, y + height / 2, z, parent);
  }

  // ---------- Sky, fog, light ----------
  let [skyTop, skyBottom] = SKY[time];
  if (overcast) {
    const grey = weather === "storm" ? 0.55 : 0.35;
    skyTop = "#" + mixColor(skyTop, night ? 0x2a2c3a : 0xa9adb8, grey).getHexString();
    skyBottom = "#" + mixColor(skyBottom, night ? 0x3a3c4c : 0xc9ccd4, grey).getHexString();
  }
  if (weather === "heat" && !night) {
    skyBottom = "#ffd9a8";
  }
  scene.background = gradientTexture(skyTop, skyBottom);
  if (weather === "fog") {
    scene.fog = new THREE.Fog(new THREE.Color(skyBottom), 19, 36); // camera sits ~26 units away
  } else {
    scene.fog = new THREE.Fog(new THREE.Color(skyBottom), 26, 60);
  }

  const sunSettings = SUN[time];
  const hemisphere = new THREE.HemisphereLight(
    new THREE.Color(skyTop),
    new THREE.Color(night ? 0x2b2a3a : 0xc8b49a),
    night ? 0.6 : overcast ? 1.9 : 1.2
  );
  scene.add(hemisphere);
  const sun = new THREE.DirectionalLight(sunSettings.color, sunSettings.intensity * (overcast ? 0.45 : 1));
  sun.position.set(...sunSettings.position);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -7;
  sun.shadow.camera.right = 7;
  sun.shadow.camera.top = 7;
  sun.shadow.camera.bottom = -7;
  sun.shadow.radius = 4;
  sun.shadow.bias = -0.0008;
  scene.add(sun);

  // ---------- Base: chunky rounded diorama tile ----------
  const groundColor = snowy
    ? PALETTE.snow
    : { spring: 0xb3d39c, summer: 0x9cc788, autumn: 0xd8c48f, winter: PALETTE.snow }[season];
  const soilGeometry = new THREE.ExtrudeGeometry(roundedRectShape(8, 8, 0.9), {
    depth: 0.7,
    bevelEnabled: true,
    bevelThickness: 0.08,
    bevelSize: 0.08,
    bevelSegments: 3,
  });
  soilGeometry.rotateX(-Math.PI / 2);
  add(new THREE.Mesh(soilGeometry, material(PALETTE.soil)), 0, -0.78, 0);
  const grassGeometry = new THREE.ExtrudeGeometry(roundedRectShape(8.02, 8.02, 0.92), {
    depth: 0.14,
    bevelEnabled: true,
    bevelThickness: 0.05,
    bevelSize: 0.05,
    bevelSegments: 3,
  });
  grassGeometry.rotateX(-Math.PI / 2);
  add(new THREE.Mesh(grassGeometry, material(groundColor)), 0, -0.1, 0);

  // Road with crosswalk, and a stone footpath.
  const roadColor = snowy ? 0xd9dbe2 : PALETTE.asphalt;
  box(8.1, 0.03, 1.5, roadColor, 0, 0.05, 1.2);
  for (let i = 0; i < 5; i++) {
    box(0.22, 0.031, 1.2, snowy ? 0xf2f3f7 : 0xf3efe6, -1.0 + i * 0.4, 0.06, 1.2);
  }
  for (let i = 0; i < 6; i++) {
    box(0.42, 0.04, 0.42, PALETTE.stone, 2.2 + (i % 2) * 0.15, 0.05, 2.4 + i * 0.28 - 0.2);
  }

  // ---------- Buildings ----------
  function windowPane(width, height, x, y, z, rotationY = 0, parent = scene) {
    const lit = night && random() < (time === "late_night" ? 0.45 : 0.85);
    const pane = new THREE.Mesh(
      new THREE.BoxGeometry(width, height, 0.04),
      lit
        ? new THREE.MeshStandardMaterial({ color: PALETTE.windowWarm, emissive: PALETTE.windowWarm, emissiveIntensity: 1.6 })
        : material(PALETTE.glass, { roughness: 0.3 })
    );
    pane.position.set(x, y, z);
    pane.rotation.y = rotationY;
    parent.add(pane);
    // Little wooden frame for a hand-made feel.
    const frame = new THREE.Mesh(new THREE.BoxGeometry(width + 0.08, height + 0.08, 0.03), material(PALETTE.woodDark));
    frame.position.set(x, y, z);
    frame.rotation.y = rotationY;
    frame.translateZ(-0.01);
    parent.add(frame);
    return lit;
  }

  function gableRoof(width, depth, height, color, x, y, z) {
    const shape = new THREE.Shape();
    shape.moveTo(-width / 2 - 0.18, 0);
    shape.lineTo(width / 2 + 0.18, 0);
    shape.lineTo(0, height);
    shape.lineTo(-width / 2 - 0.18, 0);
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: depth + 0.3, bevelEnabled: false });
    geometry.translate(0, 0, -(depth + 0.3) / 2);
    const roofColor = snowy ? PALETTE.snow : color;
    const roof = add(new THREE.Mesh(geometry, material(roofColor)), x, y, z);
    // Ridge cap.
    box(0.16, 0.08, depth + 0.34, snowy ? 0xe9ecf2 : PALETTE.charcoal, x, y + height - 0.04, z);
    return roof;
  }

  // House A — Japanese two-storey home with gable roof and sliding door.
  const houseA = { x: -2.2, z: -1.9, w: 2.3, d: 1.9, h: 1.8 };
  box(houseA.w, houseA.h, houseA.d, PALETTE.plaster, houseA.x, 0.05, houseA.z);
  box(houseA.w + 0.04, 0.12, houseA.d + 0.04, PALETTE.woodDark, houseA.x, 0.05 + 0.85, houseA.z);
  gableRoof(houseA.w, houseA.d, 0.9, PALETTE.indigo, houseA.x, 0.05 + houseA.h, houseA.z);
  box(0.75, 0.95, 0.06, PALETTE.wood, houseA.x - 0.4, 0.05, houseA.z + houseA.d / 2 + 0.02);
  windowPane(0.55, 0.4, houseA.x + 0.55, 0.55, houseA.z + houseA.d / 2 + 0.03);
  windowPane(0.5, 0.38, houseA.x - 0.45, 1.35, houseA.z + houseA.d / 2 + 0.03);
  windowPane(0.5, 0.38, houseA.x + 0.45, 1.35, houseA.z + houseA.d / 2 + 0.03);
  windowPane(0.45, 0.38, houseA.x + houseA.w / 2 + 0.03, 1.35, houseA.z, Math.PI / 2);
  // Noren curtain over the door.
  box(0.8, 0.28, 0.03, PALETTE.indigo, houseA.x - 0.4, 0.75, houseA.z + houseA.d / 2 + 0.07);

  // Building B — small apartment (villa) with balconies, laundry and AC units.
  const aptB = { x: 1.5, z: -2.0, w: 2.2, d: 1.8, h: 2.7 };
  box(aptB.w, aptB.h, aptB.d, 0xe9d9c6, aptB.x, 0.05, aptB.z);
  box(aptB.w + 0.12, 0.12, aptB.d + 0.12, PALETTE.charcoal, aptB.x, 0.05 + aptB.h, aptB.z);
  if (snowy) {
    box(aptB.w + 0.1, 0.1, aptB.d + 0.1, PALETTE.snow, aptB.x, 0.17 + aptB.h, aptB.z);
  }
  for (let floor = 0; floor < 2; floor++) {
    const y = 0.45 + floor * 1.25;
    windowPane(0.5, 0.5, aptB.x - 0.55, y + 0.3, aptB.z + aptB.d / 2 + 0.03);
    windowPane(0.5, 0.5, aptB.x + 0.55, y + 0.3, aptB.z + aptB.d / 2 + 0.03);
    windowPane(0.5, 0.45, aptB.x + aptB.w / 2 + 0.03, y + 0.3, aptB.z + 0.3, Math.PI / 2);
    // Balcony rail.
    box(aptB.w * 0.9, 0.06, 0.32, PALETTE.charcoal, aptB.x, y - 0.05, aptB.z + aptB.d / 2 + 0.16);
    box(aptB.w * 0.9, 0.3, 0.03, 0xd6c9b8, aptB.x, y, aptB.z + aptB.d / 2 + 0.31);
    // AC unit.
    box(0.36, 0.26, 0.2, 0xf1f1ee, aptB.x + aptB.w / 2 + 0.14, y + 0.05, aptB.z - 0.45);
  }
  // Laundry line with colourful clothes (only on dry days).
  if (!["rain", "storm", "snow"].includes(weather) && !night) {
    const clothes = [PALETTE.sakura, 0xffffff, PALETTE.yuzu, 0x9fc3e6];
    clothes.forEach((color, i) => {
      const cloth = box(0.18, 0.24, 0.02, color, aptB.x - 0.6 + i * 0.32, 1.72, aptB.z + aptB.d / 2 + 0.28);
      animated.push((dt, t) => {
        cloth.rotation.x = Math.sin(t * 1.6 + i) * 0.12;
      });
    });
  }

  // Corner café kiosk facing the viewer, with striped awning.
  const cafe = { x: -2.2, z: 3.0, w: 2.0, d: 1.3, h: 1.35 };
  box(cafe.w, cafe.h, cafe.d, PALETTE.cream, cafe.x, 0.05, cafe.z);
  box(cafe.w + 0.16, 0.14, cafe.d + 0.16, PALETTE.woodDark, cafe.x, 0.05 + cafe.h, cafe.z);
  if (snowy) {
    box(cafe.w + 0.14, 0.08, cafe.d + 0.14, PALETTE.snow, cafe.x, 0.19 + cafe.h, cafe.z);
  }
  const cafeLit = windowPane(1.1, 0.55, cafe.x - 0.25, 0.75, cafe.z + cafe.d / 2 + 0.03);
  box(0.42, 0.85, 0.05, PALETTE.wood, cafe.x + 0.65, 0.05, cafe.z + cafe.d / 2 + 0.02);
  for (let i = 0; i < 6; i++) {
    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(cafe.w / 6, 0.04, 0.55),
      material(i % 2 ? PALETTE.cream : PALETTE.persimmon)
    );
    stripe.rotation.x = 0.45;
    add(stripe, cafe.x - cafe.w / 2 + cafe.w / 12 + (i * cafe.w) / 6, 1.18, cafe.z + cafe.d / 2 + 0.24);
  }
  // Sign board + potted plants.
  box(0.32, 0.42, 0.06, PALETTE.charcoal, cafe.x + 1.25, 0.05, cafe.z + 0.85);
  [-0.9, 0.2].forEach((dx) => {
    box(0.22, 0.2, 0.22, PALETTE.persimmon, cafe.x + dx, 0.05, cafe.z + cafe.d / 2 + 0.25);
    const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(0.17, 0), material(snowy ? 0xe6ebe4 : PALETTE.matchaDeep, { flatShading: true }));
    add(leaf, cafe.x + dx, 0.38, cafe.z + cafe.d / 2 + 0.25);
  });

  // ---------- Street furniture ----------
  // Vending machine (iconic, glows at night).
  const vendX = -0.5;
  const vendZ = -0.55;
  box(0.62, 1.2, 0.5, 0xf2f2ef, vendX, 0.05, vendZ);
  const vendFront = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.62, 0.02),
    new THREE.MeshStandardMaterial({ color: PALETTE.vending, emissive: night ? 0xcfe6ff : 0x000000, emissiveIntensity: night ? 0.7 : 0 })
  );
  add(vendFront, vendX, 0.86, vendZ + 0.26);
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 4; col++) {
      const colors = [PALETTE.red, PALETTE.yuzu, 0x6aa3d8, PALETTE.matcha];
      box(0.07, 0.11, 0.04, colors[(row + col) % 4], vendX - 0.18 + col * 0.12, 0.62 + row * 0.18, vendZ + 0.27);
    }
  }
  if (night) {
    const glow = new THREE.PointLight(0xcfe6ff, 1.2, 2.5, 2);
    glow.position.set(vendX, 0.9, vendZ + 0.7);
    scene.add(glow);
    nightLights.push(glow);
  }

  // Utility poles with sagging wires.
  const poles = [
    [0.4, 0.25],
    [-3.6, 0.25],
    [3.6, 0.25],
  ];
  poles.forEach(([x, z]) => {
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 3.6, 8), material(0xb7b0a6)), x, 1.85, z);
    box(0.7, 0.06, 0.08, 0x8f877d, x, 3.3, z);
  });
  const wireMaterial = new THREE.MeshStandardMaterial({ color: 0x3e3a44, roughness: 1 });
  for (let i = 0; i < poles.length - 1; i++) {
    const sorted = [...poles].sort((a, b) => a[0] - b[0]);
    const [ax, az] = sorted[i];
    const [bx, bz] = sorted[i + 1];
    [-0.28, 0.28].forEach((offset) => {
      const curve = new THREE.QuadraticBezierCurve3(
        new THREE.Vector3(ax, 3.32, az + offset * 0.1),
        new THREE.Vector3((ax + bx) / 2, 2.95, (az + bz) / 2 + offset * 0.1),
        new THREE.Vector3(bx, 3.32, bz + offset * 0.1)
      );
      const wire = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.012, 4, false), wireMaterial);
      wire.position.x = offset;
      scene.add(wire);
    });
  }

  // Street lamp.
  const lampX = 2.0;
  const lampZ = 2.1;
  add(new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 2.2, 8), material(PALETTE.charcoal)), lampX, 1.15, lampZ);
  const lampHead = new THREE.Mesh(
    new THREE.SphereGeometry(0.16, 16, 12),
    new THREE.MeshStandardMaterial({ color: 0xfff1d0, emissive: night || weather === "storm" ? 0xffd38a : 0x000000, emissiveIntensity: 2 })
  );
  add(lampHead, lampX, 2.3, lampZ);
  if (night || weather === "storm") {
    const lampLight = new THREE.PointLight(0xffc982, 6, 5, 2);
    lampLight.position.set(lampX, 2.2, lampZ);
    lampLight.castShadow = false;
    scene.add(lampLight);
    nightLights.push(lampLight);
    animated.push((dt, t) => {
      lampLight.intensity = 6 + Math.sin(t * 7.3) * 0.25 + Math.sin(t * 13.1) * 0.15;
    });
  }

  // Red post box (Japan) / mailbox.
  box(0.26, 0.55, 0.24, PALETTE.red, 0.9, 0.05, 2.7);
  add(new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.24, 16, 1, false, 0, Math.PI), material(PALETTE.red)), 0.9, 0.6, 2.7).rotation.z = Math.PI / 2;

  // Low wall with a sleeping cat.
  box(1.8, 0.4, 0.22, PALETTE.stone, 1.0, 0.05, 3.55);
  const catColor = 0xf0a868;
  const cat = new THREE.Group();
  add(new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 12), material(catColor)), 0, 0, 0, cat).scale.set(1.35, 0.8, 1);
  add(new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12), material(catColor)), 0.2, 0.06, 0.02, cat);
  [-0.05, 0.05].forEach((dz) => {
    const ear = add(new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.08, 4), material(catColor)), 0.23, 0.17, dz, cat);
    ear.rotation.z = -0.2;
  });
  const tail = add(new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.02, 0.32, 6), material(catColor)), -0.26, 0.02, 0.08, cat);
  tail.rotation.z = 1.2;
  cat.position.set(1.3, 0.62, 3.55);
  scene.add(cat);
  animated.push((dt, t) => {
    cat.scale.y = 1 + Math.sin(t * 1.4) * 0.03; // slow breathing
    tail.rotation.x = Math.sin(t * 0.9) * 0.3;
  });

  // Bicycle leaning near the café.
  const bike = new THREE.Group();
  [-0.28, 0.28].forEach((dx) => {
    add(new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.025, 8, 24), material(PALETTE.charcoal)), dx, 0.2, 0, bike);
  });
  const frameMaterial = material(0x7fb3a8);
  const tube = (length, x, y, rz) => {
    const mesh = add(new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, length, 6), frameMaterial), x, y, 0, bike);
    mesh.rotation.z = rz;
  };
  tube(0.5, 0, 0.3, Math.PI / 2);
  tube(0.38, -0.14, 0.32, 0.6);
  tube(0.38, 0.14, 0.32, -0.6);
  box(0.16, 0.04, 0.08, PALETTE.woodDark, -0.08, 0.48, 0, bike);
  box(0.18, 0.12, 0.16, 0xc9a77c, 0.32, 0.42, 0, bike); // front basket
  bike.position.set(-0.6, 0.05, 2.75);
  bike.rotation.y = 0.35;
  scene.add(bike);

  // Bench.
  box(0.9, 0.06, 0.3, PALETTE.wood, 2.9, 0.38, -0.2);
  box(0.06, 0.33, 0.26, PALETTE.charcoal, 2.55, 0.05, -0.2);
  box(0.06, 0.33, 0.26, PALETTE.charcoal, 3.25, 0.05, -0.2);

  // ---------- Trees by season ----------
  const foliage = {
    spring: [PALETTE.sakura, PALETTE.sakuraDeep, 0xf9d3dc],
    summer: [PALETTE.matcha, PALETTE.matchaDeep, 0xb3d39b],
    autumn: [PALETTE.ginkgo, PALETTE.maple, 0xe9a04f],
    winter: [0xeef1f6, 0xe2e7ee, 0xffffff],
  }[weather === "snow" ? "winter" : season];

  function tree(x, z, scale = 1) {
    const trunk = add(new THREE.Mesh(new THREE.CylinderGeometry(0.08 * scale, 0.12 * scale, 1.1 * scale, 7), material(PALETTE.woodDark)), x, 0.6 * scale, z);
    const bare = season === "winter" && random() < 0.5;
    if (bare) {
      for (let i = 0; i < 4; i++) {
        const branch = add(new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.04, 0.6 * scale, 5), material(PALETTE.woodDark)), x, 1.25 * scale, z);
        branch.rotation.z = (i % 2 ? 1 : -1) * 0.6;
        branch.rotation.y = i * 1.3;
        branch.translateY(0.25 * scale);
      }
      return trunk;
    }
    const clumps = 5;
    for (let i = 0; i < clumps; i++) {
      const angle = (i / clumps) * Math.PI * 2 + random();
      const radius = (0.32 + random() * 0.18) * scale;
      const blob = new THREE.Mesh(
        new THREE.IcosahedronGeometry(radius, 1),
        material(foliage[i % foliage.length], { flatShading: true, roughness: 0.95 })
      );
      add(blob, x + Math.cos(angle) * 0.3 * scale, (1.35 + random() * 0.35) * scale, z + Math.sin(angle) * 0.3 * scale);
    }
    const top = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42 * scale, 1), material(foliage[0], { flatShading: true }));
    add(top, x, 1.75 * scale, z);
    return trunk;
  }
  tree(3.1, -1.5, 1.05);
  tree(3.0, 3.2, 0.9);
  tree(-3.4, 0.0, 0.75);
  if (season === "summer" && weather !== "snow") {
    // Sunflowers along the wall.
    for (let i = 0; i < 4; i++) {
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.6, 5), material(PALETTE.matchaDeep)), 0.2 + i * 0.22, 0.35, 3.3);
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.03, 12), material(PALETTE.yuzu)), 0.2 + i * 0.22, 0.68, 3.33).rotation.x = Math.PI / 2.4;
    }
  }

  // ---------- Sky objects ----------
  if (!night && ["clear", "partly_cloudy", "heat"].includes(weather)) {
    const sunDisc = new THREE.Mesh(
      new THREE.SphereGeometry(0.55, 24, 16),
      new THREE.MeshBasicMaterial({ color: time === "dawn" || time === "dusk" ? 0xffb58a : 0xfff0b8, fog: false })
    );
    sunDisc.position.set(-5.5, time === "noon" ? 8.2 : time === "morning" ? 6.8 : 4.6, -9);
    scene.add(sunDisc);
  }
  if (night) {
    const moon = new THREE.Mesh(new THREE.SphereGeometry(0.42, 24, 16), new THREE.MeshBasicMaterial({ color: 0xfaf3d8, fog: false }));
    moon.position.set(-5.5, 7.5, -9);
    scene.add(moon);
    if (!overcast) {
      const starPositions = [];
      for (let i = 0; i < 260; i++) {
        starPositions.push((random() - 0.5) * 60, 6 + random() * 18, -12 - random() * 14);
      }
      const stars = new THREE.Points(
        new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(starPositions, 3)),
        new THREE.PointsMaterial({ color: 0xfff8e0, size: 0.08, fog: false })
      );
      scene.add(stars);
      animated.push((dt, t) => {
        stars.material.opacity = 0.75 + Math.sin(t * 2) * 0.25;
        stars.material.transparent = true;
      });
    }
  }

  const cloudCount = { partly_cloudy: 3, cloudy: 6, rain: 6, storm: 7, snow: 5, fog: 4 }[weather] || (weather === "clear" ? 1 : 0);
  const cloudColor = weather === "storm" ? 0x9a9cab : night ? 0x8a8fae : overcast ? 0xe6e8ee : 0xffffff;
  for (let i = 0; i < cloudCount; i++) {
    const cloud = new THREE.Group();
    const puffs = 4 + Math.floor(random() * 3);
    for (let p = 0; p < puffs; p++) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(0.45 + random() * 0.35, 14, 10), material(cloudColor, { roughness: 1 }));
      puff.position.set(p * 0.55 - puffs * 0.27, random() * 0.25, (random() - 0.5) * 0.4);
      puff.castShadow = overcast;
      cloud.add(puff);
    }
    cloud.position.set(-7 + random() * 10, 5.6 + random() * 1.2, -8 + random() * 4);
    cloud.scale.setScalar(0.45 + random() * 0.3);
    scene.add(cloud);
    const speed = 0.08 + random() * 0.08;
    animated.push((dt) => {
      cloud.position.x += speed * dt;
      if (cloud.position.x > 8) {
        cloud.position.x = -8;
      }
    });
  }

  // ---------- Particles: rain, snow, sakura petals, autumn leaves ----------
  function particles(count, color, size, speed, drift, spread = 9, height = 7) {
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (random() - 0.5) * spread;
      positions[i * 3 + 1] = random() * height;
      positions[i * 3 + 2] = (random() - 0.5) * spread;
    }
    const geometry = new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const points = new THREE.Points(geometry, new THREE.PointsMaterial({ color, size, transparent: true, opacity: 0.9, depthWrite: false }));
    scene.add(points);
    animated.push((dt, t) => {
      const array = geometry.attributes.position.array;
      for (let i = 0; i < count; i++) {
        array[i * 3 + 1] -= speed * dt;
        array[i * 3] += Math.sin(t * 0.8 + i) * drift * dt;
        if (array[i * 3 + 1] < 0) {
          array[i * 3 + 1] = height;
        }
      }
      geometry.attributes.position.needsUpdate = true;
    });
  }
  if (weather === "rain" || weather === "storm") {
    const count = weather === "storm" ? 900 : 550;
    const positions = new Float32Array(count * 6);
    for (let i = 0; i < count; i++) {
      const x = (random() - 0.5) * 10;
      const y = random() * 7;
      const z = (random() - 0.5) * 10;
      positions.set([x, y, z, x - 0.03, y - 0.22, z], i * 6);
    }
    const geometry = new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const rain = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: 0xcfdcf0, transparent: true, opacity: 0.55 }));
    scene.add(rain);
    animated.push((dt) => {
      const array = geometry.attributes.position.array;
      for (let i = 0; i < count; i++) {
        array[i * 6 + 1] -= 7 * dt;
        array[i * 6 + 4] -= 7 * dt;
        if (array[i * 6 + 4] < 0) {
          array[i * 6 + 1] += 7;
          array[i * 6 + 4] += 7;
        }
      }
      geometry.attributes.position.needsUpdate = true;
    });
    // Puddle shine on the road.
    box(1.4, 0.005, 0.6, 0xaabbd0, -2.2, 0.085, 1.0, scene, { roughness: 0.05, metalness: 0.2 });
  }
  if (weather === "snow") {
    particles(500, 0xffffff, 0.09, 0.6, 0.3);
  } else if (season === "spring" && !["rain", "storm"].includes(weather)) {
    particles(70, PALETTE.sakura, 0.11, 0.35, 0.5);
  } else if (season === "autumn" && !["rain", "storm"].includes(weather)) {
    particles(45, PALETTE.ginkgo, 0.12, 0.4, 0.6);
  }
  if (weather === "storm") {
    let flash = 0;
    animated.push((dt) => {
      flash = Math.max(0, flash - dt * 4);
      if (Math.random() < dt * 0.25) {
        flash = 1;
      }
      hemisphere.intensity = 0.6 + flash * 3;
    });
  }

  // ---------- Camera: slow, tilt-shift-like perspective ----------
  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
  const target = new THREE.Vector3(0, 0.55, 0.2);
  const baseAngle = Math.PI / 4;
  const distance = 22.5;
  function placeCamera(sway = 0) {
    const angle = baseAngle + sway;
    camera.position.set(Math.sin(angle) * distance, 12.6, Math.cos(angle) * distance);
    camera.lookAt(target);
  }
  placeCamera();

  return {
    scene,
    camera,
    placeCamera,
    update(dt, t) {
      for (const step of animated) {
        step(dt, t);
      }
    },
  };
}

export function createRenderer(canvas, { preserve = false } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: preserve });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  return renderer;
}
