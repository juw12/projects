/* AIRIZ iPhone page (1.11.18).
 * Older guides and links pointed here to open the console in the Bluefy browser for
 * Bluetooth. Remote by code works in Safari and Chrome on iPhone, so this page now just
 * opens the console (a #control=123456 share link is kept).
 */
(function () {
  'use strict';

  const target = new URL('./', location.href);
  target.hash = location.hash;
  document.getElementById('open-console').href = target.href;
  location.replace(target.href);
})();
