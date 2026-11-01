/**
 * VertexMount — mount the full Vertex cockpit NATIVELY (no iframe) into a host
 * element using an OPEN Shadow Root. The ME R&D Toolkit calls this from its own
 * view:
 *
 *   const { stop } = await window.VertexMount.mount(hostEl, opts);
 *   ...
 *   window.VertexMount.unmount();   // or stop()
 *
 * Everything (engine, canvas, controls) runs in the same document; the shadow
 * root scopes all of Vertex's CSS so nothing leaks into the toolkit. The host
 * owns layout (size) and theme (data-theme).
 *
 * mount(hostEl, opts) -> Promise<{ stop(): void }>
 *   hostEl  Element  a real element that supports attachShadow (e.g. a <div>)
 *   opts    {
 *     apiBase     string  base for the Vertex API; '' = same-origin relative
 *                         (default). Use a full URL (trailing slash optional) to
 *                         point at the bridge or the toolkit's own proxy.
 *     theme       string  'light' | 'dark' — applied to the shadow host (default 'light')
 *     assetBase   string  base where Vertex web assets live (styles.css, app.html,
 *                         js/*); '' = same-origin relative to the current page
 *                         (default). For the toolkit, point this at the vertex web dir.
 *     stylesheet  string  optional pre-fetched styles.css text (skips the fetch)
 *     markup      string  optional pre-extracted app body markup (skips the fetch)
 *   }
 * unmount() -> void   stop timers/listeners, destroy viewports, clear the shadow.
 * isMounted() -> bool
 */
(function (global) {
  'use strict';

  var instance = null;

  function normalizeBase(base) {
    if (base == null) return '';
    var s = String(base);
    if (s && s.charAt(s.length - 1) !== '/') s += '/';
    return s;
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = global.document.createElement('script');
      s.src = src;
      s.async = false;
      s.addEventListener('load', function () { resolve(); });
      s.addEventListener('error', function () { reject(new Error('VertexMount: failed to load ' + src)); });
      global.document.head.appendChild(s);
    });
  }

  /* Load the engine + viewport + app logic if they are not already on the page.
     Order (vertex -> viewport -> app) is preserved by chaining the Promises. */
  function loadVertexScripts(assetBase) {
    function ensure(src, ready) {
      return ready ? Promise.resolve() : loadScript(src);
    }
    return ensure(assetBase + 'js/vertex.js', typeof global.Vertex !== 'undefined')
      .then(function () { return ensure(assetBase + 'js/viewport.js', typeof global.VertexView !== 'undefined'); })
      .then(function () { return ensure(assetBase + 'js/app.js', typeof global.VertexApp === 'function'); });
  }

  /* Rewrite the page stylesheet for a shadow tree. Shadow DOM already scopes the
     `*` reset and class selectors (.btn, .modal, ...) to the shadow, so the only
     edits needed are the document-root selectors and viewport-height units:
       :root[...] / :root       -> :host[...] / :host   (theme attr lands on the host)
       html / body              -> .app-body            (the wrapper the mount injects)
       100vh                    -> 100%                 (fill the sized host, not the viewport)
     A `transform` on :host makes it the containing block for the position:fixed
     modal + guide overlay, so they stay inside the host instead of covering the
     whole toolkit page. */
  function toShadowCss(css) {
    var out = css;
    out = out.replace(/:root\[data-theme="light"\]/g, ':host([data-theme="light"])');
    out = out.replace(/:root:not\(\[data-theme="dark"\]\)/g, ':host:not([data-theme="dark"])');
    out = out.replace(/:root[ \t]*\{/, ':host {');
    out = out.replace(/^[ \t]*html[ \t]*\{/m, '.app-body {');
    out = out.replace(/^[ \t]*body[ \t]*\{/m, '.app-body {');
    out = out.replace(/min-height:\s*100vh/g, 'min-height: 100%');
    out = out.replace(/height:\s*100vh/g, 'height: 100%');
    out += '\n:host { display: block; transform: translateZ(0); }\n.topbar { display: none !important; }\n';
    return out;
  }

  /* Pull the app markup out of app.html: the <body> innerHTML with all <script>
     tags (inline head logic is not in <body>, the bottom scripts are stripped)
     plus the install callout + install button + variant nav removed. */
  function extractBodyMarkup(html) {
    var parsed = new global.DOMParser().parseFromString(html, 'text/html');
    var body = parsed.body;
    var toRemove = body.querySelectorAll('script, #install-callout, #btn-install-app, .variant-nav');
    for (var i = 0; i < toRemove.length; i++) {
      var node = toRemove[i];
      if (node.parentNode) node.parentNode.removeChild(node);
    }
    return body.innerHTML;
  }

  /* A document-like proxy scoped to the shadow root. Element lookups and
     selectors resolve inside the shadow; body -> the injected .app-body wrapper;
     documentElement -> the shadow host (so data-theme lands on the host); page
     event listeners route to the shadow root (scoped + cleanable); everything
     else delegates to the real document. */
  function createDocProxy(realDoc, shadow, host, bodyEl) {
    return new Proxy(realDoc, {
      get: function (target, prop) {
        if (prop === 'getElementById') {
          return function (id) {
            var sel = '#' + (global.CSS && global.CSS.escape ? global.CSS.escape(String(id)) : String(id));
            return shadow.querySelector(sel);
          };
        }
        if (prop === 'querySelector') return function (sel) { return shadow.querySelector(sel); };
        if (prop === 'querySelectorAll') return function (sel) { return shadow.querySelectorAll(sel); };
        if (prop === 'body') return bodyEl;
        if (prop === 'documentElement') return host;
        if (prop === 'addEventListener' || prop === 'removeEventListener') {
          return shadow[prop].bind(shadow);
        }
        var value = target[prop];
        if (typeof value === 'function') return value.bind(target);
        return value;
      }
    });
  }

  function mount(hostEl, opts) {
    opts = opts || {};
    if (instance) return Promise.reject(new Error('VertexMount: already mounted; call unmount() first.'));
    if (!hostEl || typeof hostEl.attachShadow !== 'function') {
      return Promise.reject(new Error('VertexMount.mount: hostEl must be an element that supports attachShadow.'));
    }

    var assetBase = normalizeBase(opts.assetBase);
    var theme = (opts.theme === 'dark' || opts.theme === 'light') ? opts.theme : 'light';

    var cssPromise = (typeof opts.stylesheet === 'string')
      ? Promise.resolve(opts.stylesheet)
      : fetch(assetBase + 'styles.css').then(function (r) {
          if (!r.ok) throw new Error('VertexMount: failed to fetch styles.css (' + r.status + ')');
          return r.text();
        });

    var markupPromise = (typeof opts.markup === 'string')
      ? Promise.resolve(opts.markup)
      : fetch(assetBase + 'app.html').then(function (r) {
          if (!r.ok) throw new Error('VertexMount: failed to fetch app.html (' + r.status + ')');
          return r.text();
        }).then(extractBodyMarkup);

    return Promise.all([cssPromise, markupPromise]).then(function (results) {
      var cssText = results[0];
      var bodyMarkup = results[1];

      return loadVertexScripts(assetBase).then(function () {
        if (typeof global.VertexApp !== 'function') {
          throw new Error('VertexMount: VertexApp is not available (js/app.js did not load).');
        }

        var shadow = hostEl.shadowRoot || hostEl.attachShadow({ mode: 'open' });
        shadow.textContent = '';

        var styleEl = global.document.createElement('style');
        styleEl.textContent = toShadowCss(cssText);
        shadow.appendChild(styleEl);

        var bodyWrap = global.document.createElement('div');
        bodyWrap.className = 'app-body';
        bodyWrap.innerHTML = bodyMarkup;
        shadow.appendChild(bodyWrap);

        var proxy = createDocProxy(global.document, shadow, hostEl, bodyWrap);
        var handle = global.VertexApp(proxy, global, {
          embedded: true,
          apiBase: opts.apiBase == null ? '' : opts.apiBase
        });

        hostEl.setAttribute('data-theme', theme);

        instance = { host: hostEl, shadow: shadow, handle: handle };
        handle.start();

        /* First paint: re-layout so canvases size to the (now visible) host. */
        requestAnimationFrame(function () {
          global.dispatchEvent(new global.Event('resize'));
        });

        return {
          stop: function () {
            if (instance && instance.handle) instance.handle.stop();
          }
        };
      });
    });
  }

  function unmount() {
    if (!instance) return;
    var it = instance;
    instance = null;
    try { if (it.handle && it.handle.stop) it.handle.stop(); } catch (e) { /* best effort */ }
    /* Detach where supported; where it is a no-op, leave the (now reusable) shadow
       root in place but empty so a later mount() can reuse it. */
    try { it.host.shadowRoot = null; } catch (e) { /* detach unsupported */ }
    if (it.host.shadowRoot) { try { it.shadow.innerHTML = ''; } catch (e) { /* best effort */ } }
  }

  function isMounted() { return !!instance; }

  global.VertexMount = { mount: mount, unmount: unmount, isMounted: isMounted };
})(typeof window !== 'undefined' ? window : this);
