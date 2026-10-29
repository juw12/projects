'use strict';

// 1.9.0: keeps Windows awake while the console shares the AIRIZ (phones control it through
// this PC), and stops as soon as sharing stops or the window goes away.
//   'prevent-app-suspension'  the system stays on (always while sharing)
//   'prevent-display-sleep'   the screen stays on - 1.9.1: only where it is needed, i.e. on
//                             Modern Standby PCs, where an idle screen-off can end in standby.
//                             Classic-sleep PCs may turn the screen off; sharing goes on.
// Closing the lid and the sleep timers are handled by power-plan.cjs (1.9.1).
function createPowerKeeper(powerSaveBlocker, options) {
  const settings = options || {};
  const wantsDisplay = typeof settings.display === 'function' ? settings.display : () => true;
  const ids = [];
  let displayHeld = false;

  function started(id) {
    try {
      return powerSaveBlocker.isStarted(id);
    } catch {
      return false;
    }
  }

  function stopAll() {
    while (ids.length) {
      const id = ids.pop();
      try {
        if (started(id)) powerSaveBlocker.stop(id);
      } catch {
        // Already released by the system.
      }
    }
    displayHeld = false;
  }

  return {
    set(flag) {
      if (flag === true) {
        const display = wantsDisplay() !== false;
        // Re-arm if Windows dropped a request, or the screen decision changed.
        if (ids.length && (!ids.every(started) || displayHeld !== display)) stopAll();
        if (!ids.length) {
          ids.push(powerSaveBlocker.start('prevent-app-suspension'));
          if (display) ids.push(powerSaveBlocker.start('prevent-display-sleep'));
          displayHeld = display;
        }
      } else {
        stopAll();
      }
      return this.active;
    },
    get active() {
      return ids.length > 0 && ids.every(started);
    },
    get displayHeld() {
      return this.active && displayHeld;
    },
    stop() {
      stopAll();
    }
  };
}

module.exports = { createPowerKeeper };
