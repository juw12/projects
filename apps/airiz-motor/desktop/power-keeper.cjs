'use strict';

// 1.9.0: keeps Windows awake while the console shares the AIRIZ (phones control it through
// this PC), and stops as soon as sharing stops or the window goes away. Two blockers:
// 'prevent-app-suspension' (system stays on) and 'prevent-display-sleep' (screen stays on;
// on Modern Standby laptops an idle screen-off would otherwise suspend the network too).
// Closing the lid or choosing Sleep still sleeps the PC; the share then recovers on resume.
function createPowerKeeper(powerSaveBlocker) {
  const ids = [];

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
  }

  return {
    set(flag) {
      if (flag === true) {
        // Re-arm if Windows dropped a request.
        if (ids.length && !ids.every(started)) stopAll();
        if (!ids.length) {
          ids.push(powerSaveBlocker.start('prevent-app-suspension'));
          ids.push(powerSaveBlocker.start('prevent-display-sleep'));
        }
      } else {
        stopAll();
      }
      return this.active;
    },
    get active() {
      return ids.length > 0 && ids.every(started);
    },
    stop() {
      stopAll();
    }
  };
}

module.exports = { createPowerKeeper };
