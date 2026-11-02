/*
  3D product viewer (three.js, loaded on demand from CDN).
  - Shows a procedural demo model per product type (gear, flange, pump, valve, shaft, bracket)
  - Or loads a real model: set product.modelUrl to a .glb/.gltf/.stl file in data.js,
    or use the "Load STL / GLB" button to drop in a CAD export.
*/
(function () {
  "use strict";

  let libraryPromise = null;

  function loadLibrary() {
    if (!libraryPromise) {
      libraryPromise = Promise.all([
        import("three"),
        import("three/addons/controls/OrbitControls.js"),
        import("three/addons/environments/RoomEnvironment.js"),
        import("three/addons/loaders/GLTFLoader.js"),
        import("three/addons/loaders/STLLoader.js")
      ]).then(function (modules) {
        return {
          THREE: modules[0],
          OrbitControls: modules[1].OrbitControls,
          RoomEnvironment: modules[2].RoomEnvironment,
          GLTFLoader: modules[3].GLTFLoader,
          STLLoader: modules[4].STLLoader
        };
      });
      libraryPromise.catch(function () {
        libraryPromise = null;
      });
    }
    return libraryPromise;
  }

  // ---------- Procedural demo models ----------

  function metal(THREE, color, options) {
    return new THREE.MeshStandardMaterial(Object.assign({
      color: color,
      metalness: 0.75,
      roughness: 0.32
    }, options || {}));
  }

  function paint(THREE, color) {
    return new THREE.MeshStandardMaterial({ color: color, metalness: 0.2, roughness: 0.5 });
  }

  function circlePath(THREE, x, y, radius) {
    const path = new THREE.Path();
    path.absarc(x, y, radius, 0, Math.PI * 2, true);
    return path;
  }

  function buildGear(THREE, color) {
    const group = new THREE.Group();
    const teeth = 28;
    const rootRadius = 1.0;
    const tipRadius = 1.14;
    const step = (Math.PI * 2) / teeth;
    const shape = new THREE.Shape();

    for (let i = 0; i < teeth; i++) {
      const a = i * step;
      const pts = [
        [rootRadius, a],
        [tipRadius, a + step * 0.28],
        [tipRadius, a + step * 0.52],
        [rootRadius, a + step * 0.8]
      ];
      pts.forEach(function (p, index) {
        const x = p[0] * Math.cos(p[1]);
        const y = p[0] * Math.sin(p[1]);
        if (i === 0 && index === 0) {
          shape.moveTo(x, y);
        } else {
          shape.lineTo(x, y);
        }
      });
      shape.absarc(0, 0, rootRadius, a + step * 0.8, a + step, false);
    }

    shape.holes.push(circlePath(THREE, 0, 0, 0.62));
    // lightening holes in the web
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      shape.holes.push(circlePath(THREE, 0.8 * Math.cos(a) * 0.98, 0.8 * Math.sin(a) * 0.98, 0.09));
    }

    const rim = new THREE.ExtrudeGeometry(shape, {
      depth: 0.42,
      bevelEnabled: true,
      bevelThickness: 0.02,
      bevelSize: 0.015,
      bevelSegments: 2,
      curveSegments: 6
    });
    rim.translate(0, 0, -0.21);
    group.add(new THREE.Mesh(rim, metal(THREE, color)));

    // hub with bore and keyway
    const hubShape = new THREE.Shape();
    hubShape.absarc(0, 0, 0.62, 0, Math.PI * 2, false);
    const bore = new THREE.Path();
    bore.moveTo(0.06, 0.25);
    bore.lineTo(0.06, 0.32);
    bore.lineTo(-0.06, 0.32);
    bore.lineTo(-0.06, 0.25);
    bore.absarc(0, 0, 0.26, Math.PI / 2 + 0.24, Math.PI / 2 - 0.24 + Math.PI * 2, false);
    hubShape.holes.push(bore);
    const hub = new THREE.ExtrudeGeometry(hubShape, {
      depth: 0.7,
      bevelEnabled: true,
      bevelThickness: 0.03,
      bevelSize: 0.03,
      bevelSegments: 2,
      curveSegments: 32
    });
    hub.translate(0, 0, -0.35);
    group.add(new THREE.Mesh(hub, metal(THREE, color, { roughness: 0.25 })));

    group.rotation.x = -0.35;
    return group;
  }

  function buildFlange(THREE, color) {
    const group = new THREE.Group();
    const disk = new THREE.Shape();
    disk.absarc(0, 0, 1.2, 0, Math.PI * 2, false);
    disk.holes.push(circlePath(THREE, 0, 0, 0.45));
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      disk.holes.push(circlePath(THREE, 0.95 * Math.cos(a), 0.95 * Math.sin(a), 0.09));
    }
    const diskGeometry = new THREE.ExtrudeGeometry(disk, {
      depth: 0.24,
      bevelEnabled: true,
      bevelThickness: 0.015,
      bevelSize: 0.015,
      bevelSegments: 2,
      curveSegments: 48
    });
    diskGeometry.rotateX(-Math.PI / 2);
    group.add(new THREE.Mesh(diskGeometry, metal(THREE, color)));

    // raised face
    const face = new THREE.Shape();
    face.absarc(0, 0, 0.7, 0, Math.PI * 2, false);
    face.holes.push(circlePath(THREE, 0, 0, 0.45));
    const faceGeometry = new THREE.ExtrudeGeometry(face, { depth: 0.05, bevelEnabled: false, curveSegments: 48 });
    faceGeometry.rotateX(Math.PI / 2);
    group.add(new THREE.Mesh(faceGeometry, metal(THREE, color, { roughness: 0.2 })));

    // tapered weld neck (closed profile revolved about Y)
    const profile = [
      new THREE.Vector2(0.45, 0.24),
      new THREE.Vector2(0.82, 0.24),
      new THREE.Vector2(0.56, 1.05),
      new THREE.Vector2(0.45, 1.05),
      new THREE.Vector2(0.45, 0.24)
    ];
    const neck = new THREE.LatheGeometry(profile, 64);
    group.add(new THREE.Mesh(neck, metal(THREE, color, { side: THREE.DoubleSide })));
    return group;
  }

  function buildPump(THREE, color) {
    const group = new THREE.Group();
    const casing = paint(THREE, color);
    const steel = metal(THREE, "#9aa3ad");
    const motorPaint = paint(THREE, "#5b6675");

    function cylinderX(radius, length, material, x, y, z) {
      const geometry = new THREE.CylinderGeometry(radius, radius, length, 48);
      geometry.rotateZ(Math.PI / 2);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, y || 0, z || 0);
      group.add(mesh);
      return mesh;
    }

    // volute casing
    cylinderX(0.85, 0.55, casing, 0, 0.1, 0);
    // axial suction nozzle + flange
    cylinderX(0.3, 0.5, casing, -0.5, 0.1, 0);
    cylinderX(0.45, 0.08, steel, -0.78, 0.1, 0);
    // discharge nozzle + flange (vertical)
    const discharge = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.55, 40), casing);
    discharge.position.set(0, 1.05, 0.35);
    group.add(discharge);
    const dischargeFlange = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.08, 40), steel);
    dischargeFlange.position.set(0, 1.34, 0.35);
    group.add(dischargeFlange);
    // bearing bracket, coupling guard, motor
    cylinderX(0.32, 0.6, casing, 0.55, 0.1, 0);
    cylinderX(0.22, 0.35, steel, 1.0, 0.1, 0);
    cylinderX(0.58, 1.5, motorPaint, 1.95, 0.1, 0);
    for (let i = 0; i < 8; i++) {
      const fin = new THREE.Mesh(new THREE.TorusGeometry(0.59, 0.035, 8, 48), motorPaint);
      fin.rotation.y = Math.PI / 2;
      fin.position.set(1.4 + i * 0.16, 0.1, 0);
      group.add(fin);
    }
    cylinderX(0.5, 0.12, paint(THREE, "#3c4652"), 2.75, 0.1, 0);
    // terminal box
    const terminal = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.22, 0.36), motorPaint);
    terminal.position.set(1.9, 0.78, 0);
    group.add(terminal);
    // baseplate + feet
    const base = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.14, 1.3), paint(THREE, "#3a4350"));
    base.position.set(1.0, -0.9, 0);
    group.add(base);
    [[0, 0.7], [0.55, 0.45], [1.95, 0.42]].forEach(function (foot) {
      const block = new THREE.Mesh(new THREE.BoxGeometry(0.5, foot[1], 0.9), casing);
      block.position.set(foot[0], -0.83 + foot[1] / 2, 0);
      group.add(block);
    });
    return group;
  }

  function buildValve(THREE, color) {
    const group = new THREE.Group();
    const body = paint(THREE, color);
    const steel = metal(THREE, "#b5bcc5");

    const sphere = new THREE.Mesh(new THREE.SphereGeometry(0.7, 48, 32), body);
    group.add(sphere);
    const pipe = new THREE.CylinderGeometry(0.42, 0.42, 1.9, 48);
    pipe.rotateZ(Math.PI / 2);
    group.add(new THREE.Mesh(pipe, body));

    [-0.98, 0.98].forEach(function (x) {
      const flangeShape = new THREE.Shape();
      flangeShape.absarc(0, 0, 0.78, 0, Math.PI * 2, false);
      flangeShape.holes.push(circlePath(THREE, 0, 0, 0.3));
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        flangeShape.holes.push(circlePath(THREE, 0.62 * Math.cos(a), 0.62 * Math.sin(a), 0.055));
      }
      const geometry = new THREE.ExtrudeGeometry(flangeShape, { depth: 0.14, bevelEnabled: false, curveSegments: 40 });
      geometry.translate(0, 0, -0.07);
      geometry.rotateY(Math.PI / 2);
      const flange = new THREE.Mesh(geometry, body);
      flange.position.x = x;
      group.add(flange);
    });

    // top flange, stem, lever
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.12, 32), body);
    top.position.y = 0.72;
    group.add(top);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.5, 24), steel);
    stem.position.y = 1.0;
    group.add(stem);
    const lever = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.07, 0.18), steel);
    lever.position.set(0.6, 1.22, 0);
    group.add(lever);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.12, 0.24), paint(THREE, "#1f2937"));
    grip.position.set(1.3, 1.22, 0);
    group.add(grip);
    return group;
  }

  function buildShaft(THREE, color) {
    const r = function (x, y) {
      return new THREE.Vector2(x, y);
    };
    const profile = [
      r(0, 0), r(0.27, 0), r(0.3, 0.03), r(0.3, 0.8), r(0.4, 0.8), r(0.4, 2.0),
      r(0.52, 2.0), r(0.52, 2.45), r(0.4, 2.45), r(0.4, 3.6), r(0.3, 3.6),
      r(0.3, 4.17), r(0.27, 4.2), r(0, 4.2)
    ];
    const geometry = new THREE.LatheGeometry(profile, 72);
    geometry.translate(0, -2.1, 0);
    geometry.rotateZ(Math.PI / 2);
    const group = new THREE.Group();
    group.add(new THREE.Mesh(geometry, metal(THREE, color, { roughness: 0.18 })));
    // keyway marker
    const key = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.06, 0.16), metal(THREE, "#6b7280"));
    key.position.set(-1.0, 0.39, 0);
    group.add(key);
    return group;
  }

  function buildBracket(THREE, color) {
    const group = new THREE.Group();
    const material = metal(THREE, color, { metalness: 0.55, roughness: 0.38 });
    const t = 0.22;

    function plateWithHoles(width, height, holes) {
      const shape = new THREE.Shape();
      const radius = 0.08;
      shape.moveTo(radius, 0);
      shape.lineTo(width - radius, 0);
      shape.quadraticCurveTo(width, 0, width, radius);
      shape.lineTo(width, height - radius);
      shape.quadraticCurveTo(width, height, width - radius, height);
      shape.lineTo(radius, height);
      shape.quadraticCurveTo(0, height, 0, height - radius);
      shape.lineTo(0, radius);
      shape.quadraticCurveTo(0, 0, radius, 0);
      holes.forEach(function (h) {
        shape.holes.push(circlePath(THREE, h[0], h[1], h[2]));
      });
      return new THREE.ExtrudeGeometry(shape, {
        depth: t,
        bevelEnabled: true,
        bevelThickness: 0.015,
        bevelSize: 0.015,
        bevelSegments: 2,
        curveSegments: 24
      });
    }

    // base plate (horizontal)
    const base = plateWithHoles(2.2, 1.4, [[0.45, 0.35, 0.11], [0.45, 1.05, 0.11], [1.6, 0.35, 0.11], [1.6, 1.05, 0.11]]);
    base.rotateX(Math.PI / 2);
    base.translate(-1.1, t, -0.7);
    group.add(new THREE.Mesh(base, material));

    // upright plate (vertical) with large bore
    const upright = plateWithHoles(1.4, 1.7, [[0.7, 1.1, 0.28], [0.3, 0.45, 0.08], [1.1, 0.45, 0.08]]);
    upright.rotateY(Math.PI / 2);
    upright.translate(-1.1, t, 0.7);
    group.add(new THREE.Mesh(upright, material));

    // triangular gussets
    const gusset = new THREE.Shape();
    gusset.moveTo(0, 0);
    gusset.lineTo(0.9, 0);
    gusset.lineTo(0, 1.0);
    gusset.lineTo(0, 0);
    [-0.55, 0.45].forEach(function (z) {
      const geometry = new THREE.ExtrudeGeometry(gusset, { depth: 0.12, bevelEnabled: false });
      geometry.translate(-1.1 + t, t, z);
      group.add(new THREE.Mesh(geometry, material));
    });
    return group;
  }

  const BUILDERS = {
    gear: buildGear,
    flange: buildFlange,
    pump: buildPump,
    valve: buildValve,
    shaft: buildShaft,
    bracket: buildBracket
  };

  // ---------- Viewer ----------

  function mount(container, product) {
    const state = { disposed: false, api: null };
    container.innerHTML = '<div class="viewer-msg">Loading 3D viewer…</div>';

    const ready = loadLibrary().then(function (lib) {
      if (state.disposed) {
        return null;
      }
      state.api = createViewer(container, product, lib);
      return state.api;
    }).catch(function (error) {
      console.error(error);
      container.innerHTML =
        '<div class="viewer-msg"><div><b>3D viewer unavailable</b><br>' +
        "It loads three.js from the internet. Check your connection and reload.</div></div>";
      return null;
    });

    return {
      ready: ready,
      call: function (method, argument) {
        if (state.api && state.api[method]) {
          return state.api[method](argument);
        }
        return undefined;
      },
      dispose: function () {
        state.disposed = true;
        if (state.api) {
          state.api.dispose();
        }
      }
    };
  }

  function createViewer(container, product, lib) {
    const THREE = lib.THREE;
    container.innerHTML = "";

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.shadowMap.enabled = true;
    container.appendChild(renderer.domElement);

    const hint = document.createElement("div");
    hint.className = "viewer-hint";
    hint.textContent = "Drag to rotate · scroll to zoom · right-drag to pan";
    container.appendChild(hint);

    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new lib.RoomEnvironment(), 0.04).texture;

    const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 1000);
    const controls = new lib.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 1.6;

    const keyLight = new THREE.DirectionalLight(0xffffff, 1.4);
    keyLight.position.set(4, 8, 5);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024);
    scene.add(keyLight);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 0.5));

    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(6, 64),
      new THREE.ShadowMaterial({ opacity: 0.18 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    let model = null;
    let homePosition = new THREE.Vector3();
    let wireframe = false;

    function setModel(object) {
      if (model) {
        scene.remove(model);
        disposeObject(model);
      }
      model = new THREE.Group();
      model.add(object);

      // normalise size and sit the model on the ground
      let box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const scale = 3 / Math.max(size.x, size.y, size.z, 1e-6);
      model.scale.setScalar(scale);
      box = new THREE.Box3().setFromObject(model);
      const center = box.getCenter(new THREE.Vector3());
      model.position.x -= center.x;
      model.position.z -= center.z;
      model.position.y -= box.min.y;

      model.traverse(function (child) {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
          if (child.material) {
            child.material.wireframe = wireframe;
          }
        }
      });
      scene.add(model);

      const finalBox = new THREE.Box3().setFromObject(model);
      const target = finalBox.getCenter(new THREE.Vector3());
      const radius = finalBox.getSize(new THREE.Vector3()).length() / 2;
      const distance = radius / Math.sin((camera.fov * Math.PI) / 360) * 1.05;
      controls.target.copy(target);
      homePosition = target.clone().add(new THREE.Vector3(0.62, 0.45, 0.85).normalize().multiplyScalar(distance));
      camera.position.copy(homePosition);
      camera.near = distance / 100;
      camera.far = distance * 20;
      camera.updateProjectionMatrix();
      controls.update();
    }

    function buildProcedural() {
      const builder = BUILDERS[product.model] || buildBracket;
      return builder(THREE, product.color || "#a7b0bd");
    }

    function loadFromBuffer(buffer, fileName) {
      const extension = (fileName.split(".").pop() || "").toLowerCase();
      if (extension === "stl") {
        const geometry = new lib.STLLoader().parse(buffer);
        geometry.computeVertexNormals();
        // CAD STL files are usually Z-up; convert to the viewer's Y-up
        geometry.rotateX(-Math.PI / 2);
        setModel(new THREE.Mesh(geometry, metal(THREE, product.color || "#a7b0bd")));
        return Promise.resolve();
      }
      if (extension === "glb" || extension === "gltf") {
        return new Promise(function (resolve, reject) {
          new lib.GLTFLoader().parse(buffer, "", function (gltf) {
            setModel(gltf.scene);
            resolve();
          }, reject);
        });
      }
      return Promise.reject(new Error("Unsupported file type: ." + extension + " (use STL, GLB or GLTF)"));
    }

    if (product.modelUrl) {
      fetch(product.modelUrl)
        .then(function (response) {
          return response.arrayBuffer();
        })
        .then(function (buffer) {
          return loadFromBuffer(buffer, product.modelUrl);
        })
        .catch(function (error) {
          console.warn("Could not load modelUrl, using demo model.", error);
          setModel(buildProcedural());
        });
    } else {
      setModel(buildProcedural());
    }

    function resize() {
      const width = container.clientWidth || 600;
      const height = container.clientHeight || 400;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);
    resize();

    let frame = 0;
    function animate() {
      frame = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    }
    animate();

    function disposeObject(object) {
      object.traverse(function (child) {
        if (child.geometry) {
          child.geometry.dispose();
        }
        if (child.material) {
          [].concat(child.material).forEach(function (m) {
            m.dispose();
          });
        }
      });
    }

    return {
      toggleRotate: function () {
        controls.autoRotate = !controls.autoRotate;
        return controls.autoRotate;
      },
      toggleWireframe: function () {
        wireframe = !wireframe;
        if (model) {
          model.traverse(function (child) {
            if (child.isMesh && child.material) {
              [].concat(child.material).forEach(function (m) {
                m.wireframe = wireframe;
              });
            }
          });
        }
        return wireframe;
      },
      resetView: function () {
        camera.position.copy(homePosition);
        controls.update();
      },
      loadFile: function (file) {
        return file.arrayBuffer().then(function (buffer) {
          return loadFromBuffer(buffer, file.name);
        });
      },
      snapshot: function () {
        renderer.render(scene, camera);
        return renderer.domElement.toDataURL("image/png");
      },
      dispose: function () {
        cancelAnimationFrame(frame);
        resizeObserver.disconnect();
        controls.dispose();
        if (model) {
          disposeObject(model);
        }
        pmrem.dispose();
        renderer.dispose();
        container.innerHTML = "";
      }
    };
  }


  // ---------- Catalog thumbnails ----------
  // One shared off-screen renderer; renders are queued so cards never open many WebGL contexts.

  let thumbState = null;
  let thumbQueue = Promise.resolve();

  function thumbnail(product, width) {
    const job = thumbQueue.then(function () {
      return loadLibrary().then(function (lib) {
        return renderThumbnail(lib, product, width || 560);
      });
    });
    thumbQueue = job.catch(function () {});
    return job;
  }

  function renderThumbnail(lib, product, width) {
    const THREE = lib.THREE;
    const height = Math.round(width * 0.72);
    if (!thumbState) {
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      renderer.setPixelRatio(1);
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      const pmrem = new THREE.PMREMGenerator(renderer);
      thumbState = { renderer: renderer, env: pmrem.fromScene(new lib.RoomEnvironment(), 0.04).texture };
    }
    const renderer = thumbState.renderer;
    renderer.setSize(width, height, false);

    const scene = new THREE.Scene();
    scene.environment = thumbState.env;
    const key = new THREE.DirectionalLight(0xffffff, 1.3);
    key.position.set(4, 9, 6);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.radius = 6;
    scene.add(key);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 0.45));

    const builder = BUILDERS[product.model] || buildBracket;
    const model = new THREE.Group();
    model.add(builder(THREE, product.color || "#a7b0bd"));
    let box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    model.scale.setScalar(3 / Math.max(size.x, size.y, size.z, 1e-6));
    box = new THREE.Box3().setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());
    model.position.set(-center.x, -box.min.y, -center.z);
    model.traverse(function (child) {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    scene.add(model);

    const ground = new THREE.Mesh(new THREE.CircleGeometry(6, 48), new THREE.ShadowMaterial({ opacity: 0.16 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    const finalBox = new THREE.Box3().setFromObject(model);
    const target = finalBox.getCenter(new THREE.Vector3());
    const radius = finalBox.getSize(new THREE.Vector3()).length() / 2;
    const camera = new THREE.PerspectiveCamera(30, width / height, 0.01, 100);
    const distance = radius / Math.sin((camera.fov * Math.PI) / 360) * 0.98;
    camera.position.copy(target).add(new THREE.Vector3(0.62, 0.42, 0.88).normalize().multiplyScalar(distance));
    camera.lookAt(target);

    renderer.render(scene, camera);
    const url = renderer.domElement.toDataURL("image/png");

    scene.traverse(function (child) {
      if (child.geometry) {
        child.geometry.dispose();
      }
      if (child.material) {
        [].concat(child.material).forEach(function (m) {
          m.dispose();
        });
      }
    });
    return url;
  }

  window.IC_Viewer = { mount: mount, thumbnail: thumbnail };
})();
