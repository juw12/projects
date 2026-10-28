// Glow download page: shows the right download for this device first, the version, and QR codes.
(function () {
  "use strict";

  const LIVE_PAGE = "https://juw12.github.io/projects/glow/download/";
  const APK_URL = "https://github.com/juw12/projects/releases/download/glow-android/Glow-android.apk";
  const EXE_URL = "https://github.com/juw12/projects/releases/download/glow-windows/Glow-Setup.exe";
  const $ = (id) => document.getElementById(id);
  const ua = navigator.userAgent;
  const isIPhone = /iPhone|iPod/.test(ua);
  const isIPad = /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/.test(ua);
  const isWindows = /Windows NT/.test(ua);
  const isMac = /Macintosh/.test(ua) && !isIPad;
  const isChromeOS = /CrOS/.test(ua);
  const isLinux = /Linux/.test(ua) && !isAndroid && !isChromeOS;
  const isSafari = /Safari/.test(ua) && !/Chrome|CriOS|Edg|FxiOS|Firefox/.test(ua);
  let installEvent = null;

  function preferredTheme() {
    const own = localStorage.getItem("glow.home.theme");
    if (own === "light" || own === "dark") return own;
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }

  function button(label, href, primary, extra = {}) {
    const link = document.createElement(href ? "a" : "button");
    link.className = `btn${primary ? " primary big" : ""}`;
    link.textContent = label;
    if (href) {
      link.href = href;
      if (extra.download) link.setAttribute("download", "");
    } else {
      link.type = "button";
    }
    if (extra.onClick) link.addEventListener("click", extra.onClick);
    return link;
  }

  function steps(list) {
    const box = $("for-you-steps");
    box.innerHTML = "";
    for (const text of list) {
      const item = document.createElement("li");
      item.textContent = text;
      box.appendChild(item);
    }
    box.hidden = !list.length;
  }

  function recommend() {
    const actions = $("for-you-actions");
    const standalone = window.GlowApps && window.GlowApps.isStandalone && window.GlowApps.isStandalone();
    actions.innerHTML = "";
    if (standalone) {
      $("for-you-title").textContent = "Glow is installed";
      $("for-you-text").textContent = "You're using the Glow app. Get it on your other devices below.";
      actions.appendChild(button("Open Glow", "../", true));
      steps([]);
      return;
    }
    if (isIPhone || isIPad) {
      const device = isIPhone ? "iPhone" : "iPad";
      $("for-you-badge").textContent = device;
      $("for-you-title").textContent = `Get Glow on your ${device}: free`;
      $("for-you-text").textContent = isSafari
        ? "Add Glow to your Home Screen. It opens full screen like any app and works offline."
        : "Add Glow to your Home Screen from the Share menu. If you don't see it, open this page in Safari first.";
      steps([
        "Tap the Share button (on iOS 26 it is in the ••• menu).",
        "Choose Add to Home Screen.",
        "Keep Open as Web App on, then tap Add.",
      ]);
      actions.appendChild(button("Show me how", "", true, {
        onClick: () => window.GlowApps && window.GlowApps.showInstallGuide({ force: true }),
      }));
      $("ios-guide-btn").hidden = false;
      return;
    }
    if (isAndroid) {
      $("for-you-badge").textContent = "Android";
      $("for-you-title").textContent = "Get Glow for Android";
      $("for-you-text").textContent = "Download the Glow app, or install Glow straight from Chrome.";
      actions.appendChild(button("⬇ Download the Android app", APK_URL, true));
      steps(["Open the downloaded file.", "Allow “install unknown apps” for your browser once, then tap Install."]);
      return;
    }
    if (isWindows) {
      $("for-you-badge").textContent = "Windows";
      $("for-you-title").textContent = "Get Glow for Windows";
      $("for-you-text").textContent = "One small setup installs every Glow app with Start menu and desktop icons.";
      actions.appendChild(button("⬇ Download Glow for Windows", EXE_URL, true, { download: true }));
      steps(["Open Glow-Setup.exe from your downloads.", "Press Install. If Windows asks, choose More info → Run anyway."]);
      return;
    }
    if (isMac) {
      $("for-you-badge").textContent = "Mac";
      $("for-you-title").textContent = "Get Glow for Mac";
      $("for-you-text").textContent = isSafari
        ? "In Safari, open Glow and choose File → Add to Dock."
        : "Open Glow and click Install in the address bar, or use the button below.";
      steps([]);
      actions.appendChild(button("Open Glow", "../", true));
      return;
    }
    $("for-you-badge").textContent = isChromeOS ? "Chromebook" : isLinux ? "Linux" : "This device";
    $("for-you-title").textContent = "Install Glow from your browser";
    $("for-you-text").textContent = "Open Glow in Chrome or Edge and click Install in the address bar.";
    steps([]);
    actions.appendChild(button("Open Glow", "../", true));
  }

  // Chrome, Edge and Android offer a real install prompt: show an Install button next to the download.
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installEvent = event;
    const actions = $("for-you-actions");
    if (actions.querySelector("[data-install]")) return;
    const install = button("Install Glow app", "", false, {
      onClick: async () => {
        if (!installEvent) return;
        installEvent.prompt();
        await installEvent.userChoice.catch(() => null);
        installEvent = null;
        install.remove();
      },
    });
    install.dataset.install = "1";
    actions.appendChild(install);
  });

  function drawQr(boxId, text) {
    const box = $(boxId);
    if (!box || typeof window.qrcode !== "function") return;
    const code = window.qrcode(0, "M");
    code.addData(text);
    code.make();
    box.innerHTML = code.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
  }

  async function showVersion() {
    try {
      const response = await fetch(`../version.json?t=${Date.now()}`, { cache: "no-store" });
      const info = await response.json();
      $("version-line").textContent = `Version ${info.version} · released ${info.released}`;
    } catch (error) {
      // Offline: keep the version written in the page.
    }
  }

  document.documentElement.dataset.theme = preferredTheme();
  $("ios-guide-btn").addEventListener("click", () => window.GlowApps && window.GlowApps.showInstallGuide({ force: true }));
  recommend();
  drawQr("apk-qr", APK_URL);
  drawQr("page-qr", LIVE_PAGE);
  if (isIPhone || isIPad || isAndroid) $("on-phone").hidden = true;
  showVersion();
  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("../sw.js", { scope: "../" }).catch(() => {});
  }
})();
