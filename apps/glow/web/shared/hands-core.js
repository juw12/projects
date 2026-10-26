/* Glow Hands core: the same browser-control rules as glow_hands.py, for browsers that GlowLead drives
 * directly (the Android app's built-in browser and the Glow cloud browser).
 *
 * createHandsCore(driver) returns { observe, act, handle }. The driver supplies:
 *   evaluate(source, arg) -> JSON value of (source)(arg) run inside the page      (required)
 *   goto(url), back(), info() -> {url, title}, settle()                           (required)
 *   click(ref), fill(ref, text), press(key), scroll(dy), close()                  (optional, native fidelity)
 * Safety model (identical to the PC companion): risky clicks and Enter inside a form need approval, it never
 * types into password / card / one-time-code fields, and only http(s) pages on public hosts can be opened.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.GlowHandsCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const VERSION = "0.5.0";
  const RISKY_WORDS = new RegExp("\\b(submit|send|buy|pay|purchase|order|checkout|check out|place|confirm|delete|remove|transfer|post|publish|book|reserve|subscribe|sign ?up|register|apply|donate|unsubscribe|cancel|withdraw|accept|agree|log ?out)\\b", "i");
  const SECRET_AUTOCOMPLETE = new RegExp("(cc-|one-time-code|current-password|new-password)", "i");
  const KEYS = new Set(["Enter", "Tab", "Escape", "ArrowDown", "ArrowUp", "PageDown", "PageUp"]);

  const OBSERVE = "() => {\n  document.querySelectorAll('[data-glow-ref]').forEach((node) => node.removeAttribute('data-glow-ref'));\n  const selector = 'a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=link],' +\n    '[role=checkbox],[role=radio],[role=tab],[role=menuitem],[role=option],[contenteditable=true]';\n  const elements = [];\n  for (const node of document.querySelectorAll(selector)) {\n    if (elements.length >= 120) break;\n    const box = node.getBoundingClientRect();\n    const style = getComputedStyle(node);\n    if (box.width < 2 || box.height < 2 || style.visibility === 'hidden' || style.display === 'none') continue;\n    const ref = elements.length + 1;\n    node.setAttribute('data-glow-ref', String(ref));\n    const tag = node.tagName.toLowerCase();\n    const type = (node.getAttribute('type') || '').toLowerCase();\n    const label = node.labels && node.labels[0] ? node.labels[0].innerText : '';\n    const name = (node.getAttribute('aria-label') || label || node.innerText ||\n      (tag === 'input' && ['submit', 'button'].includes(type) ? node.value : '') ||\n      node.getAttribute('placeholder') || node.getAttribute('title') || node.getAttribute('name') || '')\n      .replace(/\\s+/g, ' ').trim().slice(0, 80);\n    const secret = type === 'password' || /(cc-|one-time-code|password)/i.test(node.getAttribute('autocomplete') || '');\n    elements.push({\n      ref, tag, type, role: node.getAttribute('role') || '', name,\n      value: secret ? '' : String(node.value || '').slice(0, 60),\n      secret, inForm: !!node.closest('form'),\n      href: tag === 'a' ? String(node.href || '').slice(0, 140) : '',\n      options: tag === 'select' ? [...node.options].slice(0, 20).map((o) => o.text.trim().slice(0, 40)) : undefined,\n    });\n  }\n  const text = document.body ? document.body.innerText.replace(/\\n{3,}/g, '\\n\\n').slice(0, 5000) : '';\n  return { elements, text, hasPassword: !!document.querySelector('input[type=password]') };\n}";
  const ELEMENT_INFO = "(node) => {\n  const tag = node.tagName.toLowerCase();\n  const type = (node.getAttribute('type') || '').toLowerCase();\n  const form = node.closest('form');\n  const label = node.labels && node.labels[0] ? node.labels[0].innerText : '';\n  const name = (node.getAttribute('aria-label') || label || node.innerText || node.value ||\n    node.getAttribute('title') || node.getAttribute('name') || '').replace(/\\s+/g, ' ').trim().slice(0, 120);\n  const submits = tag === 'input' ? ['submit', 'image'].includes(type)\n    : tag === 'button' ? (type === '' || type === 'submit') && !!form : false;\n  return { tag, type, name, inForm: !!form, submits, autocomplete: node.getAttribute('autocomplete') || '',\n    editable: node.isContentEditable || ['input', 'textarea', 'select'].includes(tag) };\n}";
  const FIND = "(ref) => { const nodes = document.querySelectorAll('[data-glow-ref=\"' + ref + '\"]'); " +
    "return { count: nodes.length, info: nodes.length === 1 ? (" + ELEMENT_INFO + ")(nodes[0]) : null }; }";
  const CLICK = "(ref) => { const node = document.querySelector('[data-glow-ref=\"' + ref + '\"]'); if (!node) return false; " +
    "node.scrollIntoView({ block: 'center' }); if (node.focus) node.focus(); node.click(); return true; }";
  const FILL = "(input) => { const node = document.querySelector('[data-glow-ref=\"' + input.ref + '\"]'); if (!node) return false; " +
    "node.scrollIntoView({ block: 'center' }); if (node.focus) node.focus(); " +
    "if (node.isContentEditable) { node.textContent = input.text; } else { " +
    "const proto = node.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; " +
    "const setter = Object.getOwnPropertyDescriptor(proto, 'value').set; setter.call(node, input.text); } " +
    "node.dispatchEvent(new Event('input', { bubbles: true })); node.dispatchEvent(new Event('change', { bubbles: true })); return true; }";
  const SELECT = "(input) => { const node = document.querySelector('[data-glow-ref=\"' + input.ref + '\"]'); if (!node || !node.options) return 'missing'; " +
    "const wanted = String(input.text).trim().toLowerCase(); " +
    "const option = [...node.options].find((o) => o.text.trim().toLowerCase() === wanted) || [...node.options].find((o) => o.text.trim().toLowerCase().includes(wanted)); " +
    "if (!option) return 'no-option'; node.value = option.value; node.dispatchEvent(new Event('input', { bubbles: true })); " +
    "node.dispatchEvent(new Event('change', { bubbles: true })); return 'ok'; }";
  const IN_FORM = "() => !!(document.activeElement && document.activeElement.closest('form'))";
  const PRESS = "(key) => { const target = document.activeElement || document.body; " +
    "const options = { key, bubbles: true, cancelable: true }; const allowed = target.dispatchEvent(new KeyboardEvent('keydown', options)); " +
    "target.dispatchEvent(new KeyboardEvent('keyup', options)); if (!allowed) return true; " +
    "if (key === 'Enter') { const form = target.closest && target.closest('form'); if (form) { if (form.requestSubmit) form.requestSubmit(); else form.submit(); } else if (target.click && target !== document.body) target.click(); } " +
    "else if (key === 'Tab') { const focusable = [...document.querySelectorAll('a[href],button,input:not([type=hidden]),select,textarea,[tabindex]:not([tabindex=\"-1\"])')]" +
    ".filter((n) => !n.disabled && n.offsetParent !== null); const next = focusable[(focusable.indexOf(target) + 1) % Math.max(focusable.length, 1)]; if (next) next.focus(); } " +
    "else if (key === 'PageDown' || key === 'PageUp') window.scrollBy(0, (key === 'PageDown' ? 1 : -1) * window.innerHeight * 0.8); " +
    "else if ((key === 'ArrowDown' || key === 'ArrowUp') && !/^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) window.scrollBy(0, key === 'ArrowDown' ? 120 : -120); " +
    "return true; }";
  const SCROLL = "(dy) => { window.scrollBy(0, dy); return true; }";

  class HandsError extends Error {
    constructor(message, status = 400, extra = {}) {
      super(message);
      this.status = status;
      this.extra = extra;
    }
  }

  function hostIsPrivate(hostname) {
    const host = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
    if (!host || host === "localhost" || /\.(localhost|local|internal|lan|home\.arpa)$/.test(host)) return true;
    const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
    if (v4) {
      const a = Number(v4[1]);
      const b = Number(v4[2]);
      return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19));
    }
    if (host.includes(":")) {
      return host === "::" || host === "::1" || /^f[cd][0-9a-f]{2}:/.test(host) || /^fe[89ab][0-9a-f]:/.test(host) || host.startsWith("::ffff:");
    }
    return /^\d+$/.test(host) || /^0x[0-9a-f]+$/.test(host);
  }

  function checkUrl(url, allowPrivate) {
    let parsed;
    try {
      parsed = new URL(String(url || "").trim());
    } catch (error) {
      throw new HandsError("That is not a valid web address.");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new HandsError("Only http and https pages can be opened.");
    if (parsed.username || parsed.password) throw new HandsError("Links with embedded usernames or passwords are refused.");
    if (!allowPrivate && hostIsPrivate(parsed.hostname)) throw new HandsError("Private network and local addresses are blocked.");
    return parsed.href;
  }

  function createHandsCore(driver, options = {}) {
    const allowPrivate = options.allowPrivate === true;
    const mode = options.mode || "embedded";

    async function element(ref) {
      const number = Number.parseInt(ref, 10);
      if (!Number.isFinite(number) || String(number) !== String(ref).trim()) {
        throw new HandsError("This action needs a numeric element ref from the latest observation.");
      }
      const found = await driver.evaluate(FIND, number);
      if (!found || found.count !== 1) {
        throw new HandsError("Element [" + number + "] is no longer on the page. Observe again.", 409, { stale: true });
      }
      return { ref: number, info: found.info };
    }

    async function observe() {
      let snapshot;
      try {
        snapshot = await driver.evaluate(OBSERVE, null);
      } catch (error) {
        await driver.settle();
        snapshot = await driver.evaluate(OBSERVE, null);
      }
      const where = await driver.info();
      return { url: where.url, title: where.title, ...(snapshot || { elements: [], text: "", hasPassword: false }) };
    }

    async function act(action, approved = false) {
      const kind = String((action && action.action) || "");
      if (kind === "goto") {
        await driver.goto(checkUrl(action.url, allowPrivate));
      } else if (kind === "back") {
        await driver.back();
      } else if (kind === "scroll") {
        const dy = String(action.direction) === "up" ? -700 : 700;
        if (driver.scroll) await driver.scroll(dy);
        else await driver.evaluate(SCROLL, dy);
      } else if (kind === "click") {
        const { ref, info } = await element(action.ref);
        const label = info.name || info.tag;
        if (!approved && (info.submits || RISKY_WORDS.test(info.name || ""))) {
          throw new HandsError("Clicking “" + label + "” may submit, send or change something.", 409, { needsApproval: true, target: label });
        }
        if (driver.click) await driver.click(ref);
        else if (!(await driver.evaluate(CLICK, ref))) throw new HandsError("Element [" + ref + "] is no longer on the page. Observe again.", 409, { stale: true });
      } else if (kind === "type" || kind === "select") {
        const { ref, info } = await element(action.ref);
        const text = String(action.text == null ? "" : action.text).slice(0, 500);
        if (info.type === "password" || SECRET_AUTOCOMPLETE.test(info.autocomplete || "")) {
          throw new HandsError("Glow Hands never types passwords, card numbers or one-time codes. Type it yourself in the browser.", 403, { secret: true });
        }
        if (!info.editable) throw new HandsError("Element [" + ref + "] is not a text field or list.");
        if (kind === "select") {
          const result = await driver.evaluate(SELECT, { ref, text });
          if (result !== "ok") throw new HandsError("No option named “" + text + "” in that list.");
        } else if (driver.fill) {
          await driver.fill(ref, text);
        } else {
          await driver.evaluate(FILL, { ref, text });
        }
      } else if (kind === "press") {
        const key = String(action.key || "");
        if (!KEYS.has(key)) throw new HandsError("Only Enter, Tab, Escape, arrow and page keys are allowed.");
        const inForm = await driver.evaluate(IN_FORM, null);
        if (key === "Enter" && inForm && !approved) {
          throw new HandsError("Pressing Enter here may submit the form.", 409, { needsApproval: true, target: "Enter in a form" });
        }
        if (driver.press) await driver.press(key);
        else await driver.evaluate(PRESS, key);
      } else {
        throw new HandsError("Unknown action. Use goto, click, type, select, press, scroll or back.");
      }
      await driver.settle();
      return driver.info();
    }

    async function handle(path, body) {
      try {
        if (path === "status") return { status: 200, ok: true, app: "glow-hands", version: VERSION, paired: true, mode };
        if (path === "observe") return { status: 200, ...(await observe()) };
        if (path === "act") {
          const data = body || {};
          return { status: 200, ...(await act(data.action || {}, data.approved === true)) };
        }
        if (path === "close") {
          if (driver.close) await driver.close();
          return { status: 200, closed: true };
        }
        return { status: 404, error: "Not found." };
      } catch (error) {
        if (error instanceof HandsError) return { status: error.status, error: error.message, ...error.extra };
        const message = String((error && error.message) || error).split("\n")[0].slice(0, 300);
        return { status: 502, error: ((error && error.name) || "Error") + ": " + message };
      }
    }

    return { observe, act, handle };
  }

  return { VERSION, createHandsCore, checkUrl, hostIsPrivate, HandsError, scripts: { OBSERVE, ELEMENT_INFO, FIND, CLICK, FILL, SELECT, PRESS, IN_FORM, SCROLL } };
});
