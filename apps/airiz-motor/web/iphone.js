/* AIRIZ iPhone launcher.
 * - Already inside Bluefy  → go straight to the console and start connecting.
 * - Safari / Chrome on iOS → open this console in Bluefy (bluefy:// URL scheme).
 *   A tap on "Open in Bluefy" falls back to the App Store when Bluefy does not
 *   open (not installed). The automatic attempt on page load never bounces to
 *   the store, because iOS browsers may silently block app launches that were
 *   not started by a tap, which would look exactly like "not installed".
 * - Other devices          → explain; Chrome/Edge there have Web Bluetooth.
 */
(function () {
  'use strict';

  const STORE_URL = 'https://apps.apple.com/app/id1492822055';
  const BLUEFY_OPEN = 'bluefy://open?url=';
  const INSTALLED_KEY = 'airiz.bluefyInstalled';
  const FALLBACK_MS = 2500;

  const $ = id => document.getElementById(id);
  const status = text => {
    $('status').textContent = text;
  };

  const ua = navigator.userAgent;
  const isIos = /iPhone|iPad|iPod/.test(ua)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const inBluefy = /Bluefy/i.test(ua) || (isIos && !!navigator.bluetooth);
  const consoleUrl = new URL('./?ble=connect', location.href).href;
  const bluefyUrl = BLUEFY_OPEN + consoleUrl;

  function remembered() {
    try {
      return localStorage.getItem(INSTALLED_KEY) === '1';
    } catch (error) {
      return false;
    }
  }

  function remember() {
    try {
      localStorage.setItem(INSTALLED_KEY, '1');
    } catch (error) { /* private mode */ }
  }

  // Try to switch to Bluefy. If storeFallback and nothing happened (page stayed
  // visible and focused: no app switch, no "Open in Bluefy?" sheet), go to the store.
  function openBluefy(storeFallback) {
    let interrupted = false;
    const onHidden = () => {
      if (document.hidden) {
        interrupted = true;
        remember();
      }
    };
    const onBlur = () => {
      interrupted = true;
    };
    document.addEventListener('visibilitychange', onHidden);
    window.addEventListener('pagehide', onHidden);
    window.addEventListener('blur', onBlur);
    status('Opening Bluefy…');
    window.location.href = bluefyUrl;

    setTimeout(() => {
      document.removeEventListener('visibilitychange', onHidden);
      window.removeEventListener('pagehide', onHidden);
      window.removeEventListener('blur', onBlur);
      if (interrupted || document.hidden) {
        status('');
        return;
      }
      if (storeFallback && !remembered()) {
        status('Bluefy is not installed. Opening the App Store…');
        window.location.href = STORE_URL;
        return;
      }
      status('Bluefy did not open. Tap "Open in Bluefy", or get it from the App Store.');
    }, FALLBACK_MS);
  }

  if (inBluefy) {
    status('Opening the AIRIZ console…');
    location.replace(consoleUrl);
    return;
  }

  if (!isIos) {
    $('intro').textContent = 'Bluefy is only needed on iPhone. On Android, Windows and Mac, '
      + 'open the console in Chrome or Edge and tap "Connect Bluetooth".';
    $('open-bluefy').hidden = true;
    return;
  }

  $('open-bluefy').href = bluefyUrl;
  $('open-bluefy').addEventListener('click', event => {
    event.preventDefault();
    openBluefy(true);
  });

  // Automatic attempt after the page has loaded (no store bounce, see header).
  const autoOpen = () => setTimeout(() => openBluefy(false), 300);
  if (document.readyState === 'complete') {
    autoOpen();
  } else {
    window.addEventListener('load', autoOpen, { once: true });
  }
})();
