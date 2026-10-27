/* Short, privacy-friendly name for this device, e.g. "iPhone (Bluefy)" or
 * "Windows PC (AIRIZ app)". Shown to the PC sharing the camera and to the AIRIZ
 * Bluetooth bridge so people can see who is connected. Only letters, digits,
 * spaces and ._()- are used (the bridge accepts nothing else).
 */
(function (root) {
  'use strict';

  function browserName(ua) {
    if (/Bluefy/i.test(ua)) return 'Bluefy';
    if (/EdgA?\/|EdgiOS/i.test(ua)) return 'Edge';
    if (/SamsungBrowser/i.test(ua)) return 'Samsung Internet';
    if (/Firefox|FxiOS/i.test(ua)) return 'Firefox';
    if (/Chrome|CriOS/i.test(ua)) return 'Chrome';
    if (/Safari/i.test(ua)) return 'Safari';
    return 'browser';
  }

  function deviceLabel(options) {
    const env = options || {};
    const ua = String(env.userAgent !== undefined ? env.userAgent : (root && root.navigator ? root.navigator.userAgent : ''));
    const touchPoints = env.maxTouchPoints !== undefined ? env.maxTouchPoints
      : (root && root.navigator ? root.navigator.maxTouchPoints || 0 : 0);
    const desktopApp = env.desktopApp !== undefined ? env.desktopApp : !!(root && root.airizDesktop);
    const mobileApp = env.mobileApp !== undefined ? env.mobileApp : !!(root && root.airizMobile);

    let device = 'Device';
    if (/iPhone|iPod/i.test(ua)) device = 'iPhone';
    else if (/iPad/i.test(ua) || (/Macintosh/i.test(ua) && touchPoints > 1)) device = 'iPad';
    else if (/Android/i.test(ua)) device = 'Android';
    else if (/Windows/i.test(ua)) device = 'Windows PC';
    else if (/Macintosh|Mac OS X/i.test(ua)) device = 'Mac';
    else if (/CrOS/i.test(ua)) device = 'Chromebook';
    else if (/Linux/i.test(ua)) device = 'Linux PC';

    const app = desktopApp || mobileApp ? 'AIRIZ app' : browserName(ua);
    return (device + ' (' + app + ')').replace(/[^A-Za-z0-9 ._()-]/g, '').slice(0, 40);
  }

  if (typeof module === 'object' && module.exports) module.exports = { deviceLabel };
  if (root) root.AirizDeviceLabel = deviceLabel;
}(typeof window !== 'undefined' ? window : null));
