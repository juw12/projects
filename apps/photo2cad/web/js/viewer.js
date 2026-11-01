/* ============================================================================
   photo2cad — 3D viewer (three.js via CDN import map)
   Loaded lazily by app.js only when a model exists. Every failure path
   (CDN unreachable, no WebGL, STL fetch/parse error) is caught and reported
   to the caller via onFail — the page never throws and downloads stay usable.
   ========================================================================== */

export function mountViewer(container, stlUrl, hooks) {
  const onReady = (hooks && hooks.onReady) || function () {};
  const onFail = (hooks && hooks.onFail) || function () {};

  let disposed = false;
  let renderer = null, controls = null, observer = null;
  let scene = null, camera = null, mesh = null, geometry = null, material = null, grid = null;

  const handle = { dispose: noop };
  function noop() {}

  (async () => {
    // 1) Load the engine from the CDN (import-map resolved). Fail soft.
    let THREE, STLLoader, OrbitControls;
    try {
      THREE = await import('three');
      const L = await import('three/addons/loaders/STLLoader.js');
      const O = await import('three/addons/controls/OrbitControls.js');
      STLLoader = L.STLLoader;
      OrbitControls = O.OrbitControls;
    } catch (e) {
      onFail('The 3D engine could not be loaded (CDN unreachable).');
      return;
    }
    if (disposed) return;

    // 2) WebGL context. Fail soft.
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    } catch (e) {
      onFail('WebGL is not available in this browser.');
      return;
    }
    if (disposed) { try { renderer.dispose(); } catch (_) {} return; }

    // 3) Scene / camera (camera first so sizing can reference it).
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0d1622);
    scene.fog = new THREE.Fog(0x0d1622, 1, 10); // rescaled once the model is measured

    camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
    camera.position.set(3, 2, 4);

    renderer.setClearColor(0x0d1622, 1);
    const el = renderer.domElement;
    el.style.width = '100%';
    el.style.height = '100%';
    el.style.display = 'block';
    container.appendChild(el);

    const sizeTo = () => {
      const w = container.clientWidth || 320;
      const h = container.clientHeight || 200;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    sizeTo();

    // 4) Lighting — a soft studio setup that reads well on any solid.
    const hemi = new THREE.HemisphereLight(0xcfe0f5, 0x0d1622, 1.4);
    const key = new THREE.DirectionalLight(0xffffff, 2.6);
    const fill = new THREE.DirectionalLight(0x8aa6d6, 0.9);
    const amb = new THREE.AmbientLight(0xffffff, 0.25);
    scene.add(hemi, key, fill, amb);

    material = new THREE.MeshStandardMaterial({ color: 0xb9c7d6, metalness: 0.3, roughness: 0.55 });

    // 5) Load the STL. Fail soft.
    const loader = new STLLoader();
    loader.load(
      stlUrl,
      (geo) => {
        if (disposed) { try { geo.dispose(); } catch (_) {} return; }
        geometry = geo;
        if (!geometry.attributes || !geometry.attributes.position || geometry.attributes.position.count === 0) {
          onFail('The returned STL contained no geometry.');
          return;
        }

        // Center the model at the origin and measure it.
        geometry.computeBoundingBox();
        const size = new THREE.Vector3();
        const center = new THREE.Vector3();
        geometry.boundingBox.getSize(size);
        geometry.boundingBox.getCenter(center);
        geometry.translate(-center.x, -center.y, -center.z);
        const maxDim = Math.max(size.x, size.y, size.z) || 1;

        // Ground grid + scaled fog.
        grid = new THREE.GridHelper(maxDim * 4, 24, 0x33506b, 0x1e3346);
        grid.position.y = -size.y / 2 - maxDim * 0.01;
        grid.material.transparent = true;
        grid.material.opacity = 0.45;
        scene.add(grid);
        scene.fog = new THREE.Fog(0x0d1622, maxDim * 2.5, maxDim * 8);

        // Auto-fit the camera to the bounding box.
        const fov = THREE.MathUtils.degToRad(camera.fov);
        const dist = (maxDim / (2 * Math.tan(fov / 2))) * 1.2;
        camera.near = Math.max(maxDim / 1000, 0.01);
        camera.far = maxDim * 100;
        camera.position.set(dist * 0.72, dist * 0.5, dist);
        camera.updateProjectionMatrix();

        key.position.set(maxDim * 1.2, maxDim * 1.5, maxDim * 1.1);
        fill.position.set(-maxDim, maxDim * 0.5, -maxDim * 0.9);

        mesh = new THREE.Mesh(geometry, material);
        scene.add(mesh);

        // 6) Controls — orbit, damping, gentle auto-rotate that stops on touch.
        controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.08;
        controls.autoRotate = true;
        controls.autoRotateSpeed = 0.9;
        controls.minDistance = maxDim * 0.15;
        controls.maxDistance = maxDim * 20;
        controls.target.set(0, 0, 0);
        controls.addEventListener('start', () => { controls.autoRotate = false; });
        controls.update();

        sizeTo();
        renderer.setAnimationLoop(() => {
          if (controls) controls.update();
          renderer.render(scene, camera);
        });

        onReady();
      },
      undefined,
      () => {
        if (!disposed) onFail('Could not load the STL preview. The downloads below still work.');
      }
    );

    // 7) Keep the canvas sized to its frame.
    observer = new ResizeObserver(() => { if (!disposed) sizeTo(); });
    observer.observe(container);
  })();

  handle.dispose = function () {
    disposed = true;
    if (observer) { try { observer.disconnect(); } catch (_) {} observer = null; }
    if (controls) { try { controls.dispose(); } catch (_) {} controls = null; }
    if (renderer) {
      try { renderer.setAnimationLoop(null); } catch (_) {}
      try { renderer.dispose(); } catch (_) {}
      try { renderer.forceContextLoss(); } catch (_) {}
      const node = renderer.domElement;
      if (node && node.parentNode) node.parentNode.removeChild(node);
      renderer = null;
    }
    if (geometry) { try { geometry.dispose(); } catch (_) {} geometry = null; }
    if (material) { try { material.dispose(); } catch (_) {} material = null; }
    if (grid) { try { grid.dispose(); } catch (_) {} grid = null; }
    scene = null; camera = null; mesh = null;
  };

  return handle;
}
