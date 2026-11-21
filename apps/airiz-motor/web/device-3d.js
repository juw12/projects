/* AIRIZ Motor Console - the Ziris unit in 3D on the Motor control page.

   The picture follows the commands the console has sent: every "diag motor rising|pan ..."
   line is already counted by the PTZ tracker (ptz-core.js), from the jog pad, the arrow keys,
   the live console, macros and the PTZ page. This file only draws that counted position on
   the CAD parts: the camera head rises on the lead-screw nut and turns on the big pan gear.
   It is a command visualisation, not position feedback.

   The CAD mesh (data/device-mesh.js) is loaded on demand. When it is not there, or the browser
   has no WebGL2, the page keeps the drawn device picture. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AirizDevice3d = api;
  if (typeof document !== 'undefined') api.start();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MESH_URL = 'data/device-mesh.js';
  const VIEW_KEY = 'airiz.device3d.view';
  const VIEWS = ['xray', 'opaque'];
  const TAU = Math.PI * 2;

  // Same part colours as the PTB FA Simulation unit viewer, so the two pictures read the same.
  const PART_COLOR = {
    screw: '#f59e0b', nut: '#ef4444', nutBracket: '#06b6d4', nutCase: '#a78bfa', pole: '#22c55e',
    bearing: '#64748b', m2nut: '#2563eb', m2screw: '#eab308', gasket: '#f9a8d4', motor: '#475569',
    gear: '#94a3b8', panGear: '#38bdf8', motorBracket: '#ec4899', fabric: '#e2e8f0', housing: '#cbd5e1',
    head: '#e7e5e4', camera: '#f8fafc', speaker: '#9ca3af', pcb: '#15803d', other: '#d4d4d8',
    pointer: '#c0ee96', home: '#8a9aa3'
  };
  // Outer parts: drawn as glass edges in the X-ray view so the mechanism shows through.
  const SHELL_PARTS = new Set(['housing', 'head', 'speaker', 'other']);
  const SHELL_ALPHA = 0.55;
  // What the unit looks like from outside (Opaque view).
  const OPAQUE_COLOR = { camera: '#111827', fabric: '#b9c0c9', housing: '#d5dbe3', head: '#e9e8e6' };

  function clamp(value, low, high) {
    return Math.min(high, Math.max(low, value));
  }

  function hexRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
  }

  // Counted steps -> how far each part of the mechanism has moved.
  //   position {pan, rising} in steps; travel {risingMax, panPerTurn} in steps;
  //   meta {strokeMm, leadMm, pinion: {ratio}} from the CAD.
  // Pan forward (positive steps) = counter-clockwise seen from above, as in the command list.
  function mechanism(position, travel, meta) {
    const risingMax = Number(travel && travel.risingMax) > 0 ? Number(travel.risingMax) : 1100;
    const panPerTurn = Number(travel && travel.panPerTurn) > 0 ? Number(travel.panPerTurn) : 4800;
    const fraction = clamp((Number(position && position.rising) || 0) / risingMax, 0, 1);
    const liftMm = fraction * meta.strokeMm;
    const panRad = (Number(position && position.pan) || 0) / panPerTurn * TAU;
    return {
      fraction,
      liftMm,
      panRad,
      panDegrees: panRad * 360 / TAU,
      screwRad: liftMm / meta.leadMm * TAU,
      // The pinion sits on the carriage and drives the big gear on the head: it spins the other way.
      pinionRad: -meta.pinion.ratio * panRad
    };
  }

  // Column-major 4x4: turn by `angle` about the vertical line through (axisX, axisZ), then lift.
  function turnLift(angle, axisX, axisZ, lift) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    return new Float32Array([
      c, 0, -s, 0,
      0, 1, 0, 0,
      s, 0, c, 0,
      axisX - (c * axisX + s * axisZ), lift, axisZ - (-s * axisX + c * axisZ), 1
    ]);
  }

  function groupMatrix(group, moved, meta) {
    if (group === 'carriage') return turnLift(0, 0, 0, moved.liftMm);
    if (group === 'head') return turnLift(moved.panRad, 0, 0, moved.liftMm);
    if (group === 'screw') return turnLift(moved.screwRad, 0, 0, 0);
    if (group === 'pinion') return turnLift(moved.pinionRad, meta.pinion.axis[0], meta.pinion.axis[1], moved.liftMm);
    if (group === 'pointer') return turnLift(moved.panRad, 0, 0, 0);
    return turnLift(0, 0, 0, 0);
  }

  // How one part category is drawn in a view: null = not drawn.
  function partStyle(category, view) {
    if (view === 'opaque') {
      return { color: hexRgb(OPAQUE_COLOR[category] || PART_COLOR[category] || PART_COLOR.other), alpha: 1, edge: false };
    }
    if (category === 'fabric') return null;
    const shell = SHELL_PARTS.has(category);
    return { color: hexRgb(PART_COLOR[category] || PART_COLOR.other), alpha: shell ? SHELL_ALPHA : 1, edge: shell };
  }

  // Text beside the model. The arrow is the turn seen from above.
  function readout(moved) {
    const degrees = Math.round(Math.abs(moved.panDegrees) % 360);
    const turn = degrees === 0 || degrees === 360 ? '' : moved.panDegrees > 0 ? ' \u21ba' : ' \u21bb';
    return {
      rise: moved.liftMm.toFixed(1) + ' mm',
      pan: (degrees === 360 ? 0 : degrees) + '\u00b0' + turn
    };
  }

  // ---- drawing (browser only) ----

  function perspective(fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2);
    const nf = 1 / (near - far);
    return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
  }

  function lookAt(eye, center) {
    let zx = eye[0] - center[0];
    let zy = eye[1] - center[1];
    let zz = eye[2] - center[2];
    let length = Math.hypot(zx, zy, zz);
    zx /= length;
    zy /= length;
    zz /= length;
    let xx = zz;
    let xz = -zx;
    length = Math.hypot(xx, xz);
    xx /= length;
    xz /= length;
    const yx = zy * xz;
    const yy = zz * xx - zx * xz;
    const yz = -zy * xx;
    return new Float32Array([
      xx, yx, zx, 0,
      0, yy, zy, 0,
      xz, yz, zz, 0,
      -(xx * eye[0] + xz * eye[2]), -(yx * eye[0] + yy * eye[1] + yz * eye[2]), -(zx * eye[0] + zy * eye[1] + zz * eye[2]), 1
    ]);
  }

  const VERTEX_SHADER = `#version 300 es
  in vec3 aPos;
  uniform mat4 uProj, uView, uModel;
  out vec3 vWorld;
  void main() {
    vec4 world = uModel * vec4(aPos, 1.0);
    vWorld = world.xyz;
    gl_Position = uProj * uView * world;
  }`;
  // Flat shading from screen-space derivatives (the mesh has no normals), as in the PTB FA viewer.
  const FRAGMENT_SHADER = `#version 300 es
  precision highp float;
  in vec3 vWorld;
  uniform vec3 uColor;
  uniform float uAlpha;
  uniform vec3 uEye;
  uniform int uEdge;
  uniform int uDark;
  out vec4 outColor;
  void main() {
    vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
    vec3 v = normalize(uEye - vWorld);
    if (dot(n, v) < 0.0) n = -n;
    vec3 l1 = normalize(vec3(0.5, 0.8, 0.45));
    vec3 l2 = normalize(vec3(-0.6, 0.3, -0.5));
    float diff = max(dot(n, l1), 0.0) * 0.75 + max(dot(n, l2), 0.0) * 0.25;
    float ndv = max(dot(n, v), 0.0);
    if (uEdge == 1) {
      // X-ray shell: faces almost invisible, silhouettes drawn like glass edges.
      float fres = pow(1.0 - ndv, 2.4);
      vec3 tint = uDark == 1 ? mix(uColor, vec3(0.55, 0.78, 1.0), 0.65) : mix(uColor, vec3(0.2, 0.32, 0.48), 0.7);
      outColor = vec4(tint * (0.55 + 0.6 * diff), uAlpha * (0.06 + 0.94 * fres));
      return;
    }
    float rim = pow(1.0 - ndv, 3.0);
    vec3 c = uColor * (0.30 + diff);
    c = uDark == 1 ? c + rim * 0.22 : c * (1.0 - rim * 0.45);
    outColor = vec4(c, uAlpha);
  }`;

  async function unpack(base64) {
    const text = atob(base64);
    const bytes = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i += 1) bytes[i] = text.charCodeAt(i);
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).arrayBuffer();
  }

  function loadMeshScript() {
    return new Promise((resolve, reject) => {
      if (window.AIRIZ_DEVICE_MESH) {
        resolve(window.AIRIZ_DEVICE_MESH);
        return;
      }
      const script = document.createElement('script');
      script.src = MESH_URL;
      script.onload = () => (window.AIRIZ_DEVICE_MESH ? resolve(window.AIRIZ_DEVICE_MESH) : reject(new Error('empty mesh file')));
      script.onerror = () => reject(new Error('no mesh file'));
      document.head.appendChild(script);
    });
  }

  // A flat arrow on the table that turns with the head: the unit is round, so without it a pan
  // is hard to read from outside. The short bar marks pan home (where the lens points at 0 steps).
  function pointerParts(meta) {
    const floor = meta.bbox[0][1] + 0.2;
    const radius = Math.max(meta.bbox[1][0], meta.bbox[1][2]);
    const arrow = [0, floor, -(radius + 20), -6, floor, -(radius + 7), 6, floor, -(radius + 7)];
    const home = [
      -1.2, floor, -(radius + 23), 1.2, floor, -(radius + 23),
      1.2, floor, -(radius + 32), -1.2, floor, -(radius + 32)
    ];
    return [
      { group: 'pointer', cat: 'pointer', positions: new Float32Array(arrow), indices: new Uint16Array([0, 1, 2]), centroid: [0, floor, -(radius + 12)] },
      { group: 'base', cat: 'home', positions: new Float32Array(home), indices: new Uint16Array([0, 1, 2, 0, 2, 3]), centroid: [0, floor, -(radius + 27)] }
    ];
  }

  function createScene(canvas, meta, buffer) {
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: true });
    if (!gl) return null;
    const uniforms = {};
    let program = null;
    let parts = [];

    function compile(type, source) {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || 'shader');
      return shader;
    }

    function upload(part) {
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, part.positions, gl.STATIC_DRAW);
      const attribute = gl.getAttribLocation(program, 'aPos');
      gl.enableVertexAttribArray(attribute);
      gl.vertexAttribPointer(attribute, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, part.indices, gl.STATIC_DRAW);
      gl.bindVertexArray(null);
      return {
        group: part.group,
        cat: part.cat,
        centroid: part.centroid,
        vao,
        count: part.indices.length,
        type: part.indices instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT
      };
    }

    // Also runs again after the browser gives the graphics context back.
    function build() {
      program = gl.createProgram();
      gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX_SHADER));
      gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || 'program');
      for (const name of ['uProj', 'uView', 'uModel', 'uColor', 'uAlpha', 'uEye', 'uEdge', 'uDark']) {
        uniforms[name] = gl.getUniformLocation(program, name);
      }
      const cadParts = meta.parts.map((part) => {
        const packed = new Int16Array(buffer, part.po, part.vn * 3);
        const positions = new Float32Array(packed.length);
        for (let i = 0; i < packed.length; i += 1) positions[i] = packed[i] * meta.scale + meta.center[i % 3];
        const indices = part.wide ? new Uint32Array(buffer, part.io, part.tn * 3) : new Uint16Array(buffer, part.io, part.tn * 3);
        return { group: part.group, cat: part.cat, centroid: part.centroid, positions, indices };
      });
      parts = cadParts.concat(pointerParts(meta)).map(upload);
    }

    function draw(camera, moved, view, dark) {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (!width || !height) return;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);
      }
      const eye = [
        camera.target[0] + camera.distance * Math.cos(camera.pitch) * Math.sin(camera.yaw),
        camera.target[1] + camera.distance * Math.sin(camera.pitch),
        camera.target[2] + camera.distance * Math.cos(camera.pitch) * Math.cos(camera.yaw)
      ];
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      gl.useProgram(program);
      gl.uniformMatrix4fv(uniforms.uProj, false, perspective(0.6, width / height, 5, 3000));
      gl.uniformMatrix4fv(uniforms.uView, false, lookAt(eye, camera.target));
      gl.uniform3fv(uniforms.uEye, eye);
      gl.uniform1i(uniforms.uDark, dark ? 1 : 0);

      const items = [];
      for (const part of parts) {
        const style = partStyle(part.cat, view);
        if (!style) continue;
        const model = groupMatrix(part.group, moved, meta);
        const c = part.centroid;
        const x = model[0] * c[0] + model[8] * c[2] + model[12];
        const y = c[1] + model[13];
        const z = model[2] * c[0] + model[10] * c[2] + model[14];
        items.push({ part, style, model, far: Math.hypot(x - eye[0], y - eye[1], z - eye[2]) });
      }
      const paint = (item) => {
        gl.uniformMatrix4fv(uniforms.uModel, false, item.model);
        gl.uniform3fv(uniforms.uColor, item.style.color);
        gl.uniform1f(uniforms.uAlpha, item.style.alpha);
        gl.uniform1i(uniforms.uEdge, item.style.edge ? 1 : 0);
        gl.bindVertexArray(item.part.vao);
        gl.drawElements(gl.TRIANGLES, item.part.count, item.part.type, 0);
      };
      gl.disable(gl.BLEND);
      gl.depthMask(true);
      items.filter((item) => item.style.alpha >= 0.99).forEach(paint);
      // Glass shells: far to near, colour blended over what is there, canvas alpha built up for the page.
      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      items.filter((item) => item.style.alpha < 0.99).sort((a, b) => b.far - a.far).forEach(paint);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
      gl.bindVertexArray(null);
    }

    build();
    return { gl, build, draw };
  }

  function start() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', start, { once: true });
      return;
    }
    const stage = document.getElementById('motion-stage');
    const canvas = document.getElementById('device-3d');
    if (!stage || !canvas || typeof DecompressionStream === 'undefined' || !window.WebGL2RenderingContext) return;
    loadMeshScript()
      .then(async (mesh) => {
        const buffer = await unpack(mesh.bin);
        mesh.bin = '';
        run(stage, canvas, mesh.meta, buffer);
      })
      .catch(() => { /* no CAD mesh in this build, or it cannot be read: the drawn device picture stays */ });
  }

  function run(stage, canvas, meta, buffer) {
    const scene = createScene(canvas, meta, buffer);
    if (!scene) return;
    const riseText = document.getElementById('device-3d-rise');
    const panText = document.getElementById('device-3d-pan');
    const readoutBox = document.getElementById('device-3d-readout');
    const viewButtons = [...document.querySelectorAll('[data-device-view]')];
    const stillMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

    // The camera looks at the lens side, a little from above. It stands back far enough for the
    // whole travel and the pan arrow to stay between the status line and buttons at the top and
    // the caption at the bottom of the stage, on a phone as well as on a tall desktop stage.
    const TOP_PX = 76;
    const BOTTOM_PX = 44;
    const low = meta.bbox[0];
    const high = meta.bbox[1];
    const fullHeight = high[1] + meta.strokeMm - low[1];
    const sceneHeight = fullHeight + 28; // the round body and the arrow in front add to the picture height
    const sceneWidth = 2 * (Math.max(high[0], high[2]) + 44);
    const middle = low[1] + fullHeight / 2 - 4;
    const homeCamera = { yaw: -2.6, pitch: 0.24 };
    const camera = { ...homeCamera, distance: 400, target: [0, middle, 0] };

    function frameView() {
      const width = canvas.clientWidth || 1;
      const height = canvas.clientHeight || 1;
      const usable = Math.max(height - TOP_PX - BOTTOM_PX, height * 0.4);
      const shownMm = Math.max(sceneHeight * height / usable, sceneWidth * height / width);
      camera.distance = shownMm / (2 * Math.tan(0.3));
      camera.target[1] = middle + (TOP_PX - BOTTOM_PX) / 2 * shownMm / height;
    }
    let view = 'xray';
    try {
      const saved = localStorage.getItem(VIEW_KEY);
      if (VIEWS.includes(saved)) view = saved;
    } catch (error) { /* storage blocked: X-ray */ }
    let dark = true;
    let shown = null; // {pan, rising} in steps, eased towards the counted position
    let lastFrame = 0;
    let frame = 0;
    let dirty = true;
    let dragging = null;
    let lost = false;

    function counted() {
      const ptz = window.AirizPtz;
      if (!ptz || typeof ptz.pose !== 'function') return { pan: 0, rising: 0, risingRef: false, travel: null };
      const pose = ptz.pose();
      return { pan: Number(pose.pan) || 0, rising: Number(pose.rising) || 0, risingRef: !!pose.risingRef, travel: ptz.travel };
    }

    function readTheme() {
      const match = /rgba?\(([^)]+)\)/.exec(getComputedStyle(stage).backgroundColor);
      if (!match) return;
      const [r, g, b] = match[1].split(',').map(Number);
      dark = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.5;
    }

    function showView() {
      stage.dataset.deviceView = view;
      viewButtons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.deviceView === view)));
    }

    function render(now) {
      frame = 0;
      if (lost) return;
      const target = counted();
      const elapsed = lastFrame ? now - lastFrame : 16; // a slow frame catches up in one go
      lastFrame = now;
      const blend = shown && !stillMotion.matches ? 1 - Math.exp(-elapsed / 90) : 1;
      if (!shown) shown = { pan: target.pan, rising: target.rising };
      shown.pan += (target.pan - shown.pan) * blend;
      shown.rising += (target.rising - shown.rising) * blend;
      const settled = Math.abs(target.pan - shown.pan) < 0.2 && Math.abs(target.rising - shown.rising) < 0.2;
      if (settled) {
        shown.pan = target.pan;
        shown.rising = target.rising;
      }
      const moved = mechanism(shown, target.travel, meta);
      frameView();
      scene.draw(camera, moved, view, dark);
      const text = readout(moved);
      if (riseText && riseText.textContent !== text.rise) riseText.textContent = text.rise;
      if (panText && panText.textContent !== text.pan) panText.textContent = text.pan;
      if (readoutBox) readoutBox.dataset.referenced = String(target.risingRef);
      dirty = false;
      if (!settled || dragging) schedule();
      else lastFrame = 0;
    }

    function schedule() {
      if (!frame && !lost && !document.hidden) frame = requestAnimationFrame(render);
    }

    function redraw() {
      dirty = true;
      schedule();
    }

    // The tracker has no "moved" event for every source of commands, so look at it a few times a second.
    setInterval(() => {
      if (frame || lost || document.hidden || !canvas.clientWidth) return;
      const target = counted();
      if (dirty || !shown || target.pan !== shown.pan || target.rising !== shown.rising) schedule();
    }, 120);

    viewButtons.forEach((button) => button.addEventListener('click', () => {
      view = button.dataset.deviceView === 'opaque' ? 'opaque' : 'xray';
      try {
        localStorage.setItem(VIEW_KEY, view);
      } catch (error) { /* storage blocked: this session only */ }
      showView();
      redraw();
    }));

    function resetView() {
      Object.assign(camera, homeCamera);
      redraw();
    }
    const resetButton = document.getElementById('device-3d-reset');
    if (resetButton) resetButton.addEventListener('click', resetView);
    canvas.addEventListener('dblclick', resetView);

    // Drag to look around. Touch: sideways turns the view, up/down still scrolls the page.
    canvas.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      dragging = { x: event.clientX, y: event.clientY, touch: event.pointerType === 'touch' };
      canvas.setPointerCapture(event.pointerId);
      canvas.classList.add('dragging');
    });
    canvas.addEventListener('pointermove', (event) => {
      if (!dragging) return;
      camera.yaw -= (event.clientX - dragging.x) * 0.008;
      if (!dragging.touch) camera.pitch = clamp(camera.pitch + (event.clientY - dragging.y) * 0.008, -0.2, 1.45);
      dragging.x = event.clientX;
      dragging.y = event.clientY;
      redraw();
    });
    const endDrag = () => {
      dragging = null;
      canvas.classList.remove('dragging');
    };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);

    canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      lost = true;
    });
    canvas.addEventListener('webglcontextrestored', () => {
      try {
        scene.build();
        lost = false;
        redraw();
      } catch (error) {
        stage.classList.remove('has-3d');
      }
    });

    const themeChanged = () => {
      readTheme();
      redraw();
    };
    new MutationObserver(themeChanged).observe(document.documentElement, { attributes: true });
    new MutationObserver(themeChanged).observe(document.body, { attributes: true, attributeFilter: ['class', 'data-theme', 'style'] });
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', themeChanged);
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(redraw).observe(canvas);
    document.addEventListener('visibilitychange', redraw);

    stage.classList.add('has-3d');
    readTheme();
    showView();
    redraw();
  }

  return { mechanism, turnLift, groupMatrix, partStyle, readout, start };
});
