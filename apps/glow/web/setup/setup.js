// Glow setup guide: copy buttons, the Android download QR code, theme and the "installed" banner.
(function () {
  "use strict";

  const APK_URL = "https://github.com/juw12/projects/releases/download/glow-android/Glow-android.apk";

  function preferredTheme() {
    const own = localStorage.getItem("glow.home.theme");
    if (own === "light" || own === "dark") return own;
    try {
      const chatTheme = ((JSON.parse(localStorage.getItem("mufakat.v1") || "{}") || {}).settings || {}).theme;
      if (chatTheme === "light" || chatTheme === "dark") return chatTheme;
    } catch (error) {
      // Unreadable GlowChat settings: fall back to the device theme.
    }
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }

  function setupCopyButtons() {
    document.querySelectorAll("[data-copy]").forEach((button) => {
      button.addEventListener("click", async () => {
        const source = document.getElementById(button.dataset.copy);
        const text = source ? source.textContent.trim() : "";
        try {
          await navigator.clipboard.writeText(text);
        } catch (error) {
          const range = document.createRange();
          range.selectNodeContents(source);
          const selection = window.getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
          document.execCommand("copy");
        }
        const label = button.textContent;
        button.textContent = "Copied ✓";
        setTimeout(() => {
          button.textContent = label;
        }, 1600);
      });
    });
  }

  function drawApkQr() {
    const box = document.getElementById("apk-qr");
    if (!box || typeof window.qrcode !== "function") return;
    const code = window.qrcode(0, "M");
    code.addData(APK_URL);
    code.make();
    box.innerHTML = code.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
  }

  document.documentElement.dataset.theme = preferredTheme();
  if (new URLSearchParams(location.search).get("installed") === "1") {
    document.getElementById("installed-banner").hidden = false;
  }
  setupCopyButtons();
  drawApkQr();
})();
