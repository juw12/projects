/* AIRIZ camera full screen for phones (1.11.14).
 *
 * The shared camera reaches phones two ways: WebRTC video, or JPEG frames through the AIRIZ relay
 * (company networks). Browsers differ in what they allow:
 *   - Android Chrome, desktop browsers, iPad: real full screen of the camera box (Fullscreen API);
 *     a landscape picture also locks the phone to landscape where the browser allows it.
 *   - iPhone Safari has no Fullscreen API for page elements, only for <video>:
 *       video  -> the native iPhone video player (true full screen),
 *       relay  -> the camera box covers the whole screen inside the page ("fill screen").
 * Double-tap the picture to switch too. In every mode a "✕ Exit full screen" button is shown.
 *
 * Usage: AirizFullscreen.attach({ container, button, video, image, iconButton })
 */
(function () {
  'use strict';

  const STYLE_ID = 'airiz-fs-style';
  const DOUBLE_TAP_MS = 320;
  const CSS = `
.airiz-fs-target:fullscreen, .airiz-fs-target:-webkit-full-screen {
  background: #000; display: flex; align-items: center; justify-content: center; width: 100%; height: 100%;
}
.airiz-fs-target.airiz-fs-on {
  position: fixed !important; inset: 0 !important; width: 100vw !important; height: 100vh !important;
  height: 100dvh !important; max-width: none !important; max-height: none !important; margin: 0 !important;
  aspect-ratio: auto !important; border-radius: 0 !important; z-index: 2147483000 !important; background: #000 !important;
  display: flex !important; align-items: center !important; justify-content: center !important; box-sizing: border-box;
  padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left) !important;
}
.airiz-fs-target:fullscreen video, .airiz-fs-target:fullscreen img,
.airiz-fs-target:-webkit-full-screen video, .airiz-fs-target:-webkit-full-screen img,
.airiz-fs-target.airiz-fs-on video, .airiz-fs-target.airiz-fs-on img {
  width: 100% !important; height: 100% !important; max-width: none !important; max-height: none !important;
  object-fit: contain !important; background: #000; border-radius: 0 !important;
}
.airiz-fs-target video[hidden], .airiz-fs-target img[hidden] { display: none !important; }
.airiz-fs-exit {
  position: absolute; top: calc(env(safe-area-inset-top) + 10px); right: calc(env(safe-area-inset-right) + 10px);
  z-index: 2147483001; padding: 8px 14px; border-radius: 999px; border: 1px solid rgba(255, 255, 255, 0.35);
  background: rgba(0, 0, 0, 0.55); color: #fff; font: 600 14px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  cursor: pointer;
}
.airiz-fs-exit[hidden] { display: none !important; }
.airiz-fs-hint {
  position: absolute; left: 50%; bottom: calc(env(safe-area-inset-bottom) + 14px); transform: translateX(-50%);
  z-index: 2147483001; padding: 6px 12px; border-radius: 999px; background: rgba(0, 0, 0, 0.55); color: #e6edf3;
  font: 13px/1.3 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; white-space: nowrap; pointer-events: none;
}
.airiz-fs-hint[hidden] { display: none !important; }
@media (orientation: landscape) { .airiz-fs-hint { display: none !important; } }
html.airiz-fs-lock, html.airiz-fs-lock body { overflow: hidden !important; overscroll-behavior: none; }
`;

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.append(style);
  }

  function nativeElement() {
    return document.fullscreenElement || document.webkitFullscreenElement || null;
  }

  function nativeAllowed(element) {
    const enabled = document.fullscreenEnabled || document.webkitFullscreenEnabled;
    return !!enabled && !!(element.requestFullscreen || element.webkitRequestFullscreen);
  }

  function attach(options) {
    const { container, button, video, image } = options;
    if (!container) return null;
    injectStyle();
    container.classList.add('airiz-fs-target');
    const state = { pseudo: false, lastTap: 0 };

    const exitButton = document.createElement('button');
    exitButton.type = 'button';
    exitButton.className = 'airiz-fs-exit';
    exitButton.textContent = '✕ Exit full screen';
    exitButton.hidden = true;
    container.append(exitButton);
    const hint = document.createElement('div');
    hint.className = 'airiz-fs-hint';
    hint.textContent = 'Turn the phone sideways for a bigger picture';
    hint.hidden = true;
    container.append(hint);

    const active = () => state.pseudo || nativeElement() === container;
    const showingVideo = () => !!(video && !video.hidden && video.srcObject);

    function pictureIsLandscape() {
      if (showingVideo()) return video.videoWidth >= video.videoHeight;
      if (image && !image.hidden && image.naturalWidth) return image.naturalWidth >= image.naturalHeight;
      return true;
    }

    function update() {
      const on = active();
      exitButton.hidden = !on;
      hint.hidden = !(on && pictureIsLandscape());
      container.classList.toggle('airiz-fs-active', on);
      if (!button) return;
      const label = on ? 'Exit full screen' : 'Full screen';
      if (options.iconButton) {
        button.title = label;
        button.setAttribute('aria-label', label);
      } else {
        button.textContent = label;
      }
      button.setAttribute('aria-pressed', on ? 'true' : 'false');
    }

    function lockLandscape() {
      const orientation = window.screen && window.screen.orientation;
      if (!orientation || typeof orientation.lock !== 'function' || !pictureIsLandscape()) return;
      orientation.lock('landscape').catch(() => {});
    }

    function unlockOrientation() {
      const orientation = window.screen && window.screen.orientation;
      if (orientation && typeof orientation.unlock === 'function') {
        try {
          orientation.unlock();
        } catch {
          // not supported here
        }
      }
    }

    function enterPseudo() {
      state.pseudo = true;
      container.classList.add('airiz-fs-on');
      document.documentElement.classList.add('airiz-fs-lock');
      update();
    }

    async function enter() {
      if (active()) return;
      if (nativeAllowed(container)) {
        try {
          const request = container.requestFullscreen || container.webkitRequestFullscreen;
          await request.call(container, { navigationUI: 'hide' });
          lockLandscape();
          update();
          return;
        } catch {
          // fall through to the iPhone ways
        }
      }
      if (showingVideo() && typeof video.webkitEnterFullscreen === 'function') {
        try {
          video.webkitEnterFullscreen();
          return;
        } catch {
          // fall back to filling the screen
        }
      }
      enterPseudo();
    }

    function exit() {
      if (state.pseudo) {
        state.pseudo = false;
        container.classList.remove('airiz-fs-on');
        document.documentElement.classList.remove('airiz-fs-lock');
      } else if (nativeElement() === container) {
        const leave = document.exitFullscreen || document.webkitExitFullscreen;
        if (leave) {
          const result = leave.call(document);
          if (result && typeof result.catch === 'function') result.catch(() => {});
        }
      }
      unlockOrientation();
      update();
    }

    function toggle() {
      if (active()) exit();
      else enter();
    }

    if (button) button.addEventListener('click', toggle);
    exitButton.addEventListener('click', event => {
      event.stopPropagation();
      exit();
    });
    // Double-tap / double-click the picture (not the buttons on it).
    container.addEventListener('dblclick', event => {
      if (event.target.closest('button')) return;
      toggle();
    });
    container.addEventListener('touchend', event => {
      if (event.target.closest('button') || event.changedTouches.length !== 1) return;
      const now = Date.now();
      if (now - state.lastTap < DOUBLE_TAP_MS) {
        event.preventDefault();
        state.lastTap = 0;
        toggle();
      } else {
        state.lastTap = now;
      }
    }, { passive: false });
    document.addEventListener('fullscreenchange', update);
    document.addEventListener('webkitfullscreenchange', update);
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && state.pseudo) exit();
    });
    update();
    return {
      toggle,
      enter,
      exit,
      get active() {
        return active();
      },
      get mode() {
        if (state.pseudo) return 'fill';
        return nativeElement() === container ? 'native' : null;
      }
    };
  }

  window.AirizFullscreen = Object.freeze({ attach });
})();
