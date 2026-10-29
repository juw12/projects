/* Bounded RPC client. A worker loss rejects the operation; the next attempt
 * rehydrates every loaded track from the UI's retained PCM before rendering. */
(function (root) {
  'use strict';
  root.Sped.createEngineClient = function (getTracks, onMode, workerFactory) {
    const H = root.Sped;
    let worker = null;
    let local = null;
    let sequence = 0;
    let generation = 0;
    let restored = new Set();
    const pending = new Map();
    const createWorker = workerFactory || function () {
      return new Worker('worker.js');
    };
    const canWork = !!workerFactory || (typeof Worker !== 'undefined' && /^https?:$/.test(location.protocol));

    function invalidate(reason) {
      generation++;
      if (worker) {
        worker.terminate();
      }
      worker = null;
      restored.clear();
      pending.forEach(function (entry) {
        clearTimeout(entry.timer);
        entry.reject(new Error(reason));
      });
      pending.clear();
    }

    function ensureWorker() {
      if (worker || !canWork) {
        return;
      }
      worker = createWorker();
      worker.onmessage = function (event) {
        const msg = event.data;
        const entry = pending.get(msg.id);
        if (!entry) {
          return;
        }
        if (msg.progress) {
          return;
        }
        clearTimeout(entry.timer);
        pending.delete(msg.id);
        if (msg.ok) {
          entry.resolve(msg.result);
        } else {
          entry.reject(new Error(msg.error || 'Audio processing failed.'));
        }
      };
      worker.onerror = function (event) {
        if (event.preventDefault) {
          event.preventDefault();
        }
        invalidate('Audio worker stopped. Your loaded tracks are retained; retry Render.');
      };
      worker.onmessageerror = function () {
        invalidate('Could not read the worker response. Retry Render.');
      };
      onMode('worker · cancel available');
    }

    function send(cmd, payload, transfer) {
      ensureWorker();
      const id = ++sequence;
      return new Promise(function (resolve, reject) {
        const timer = setTimeout(function () {
          invalidate('Audio task timed out after 90 seconds. Try a shorter edit or fewer tracks.');
        }, 90000);
        pending.set(id, { resolve: resolve, reject: reject, timer: timer });
        try {
          worker.postMessage({ id: id, cmd: cmd, payload: payload }, transfer || []);
        } catch (err) {
          invalidate('Could not send audio to the worker. Retry with a smaller track.');
        }
      });
    }

    function runLocal(cmd, payload) {
      if (!local) {
        local = H.createSession();
      }
      onMode('main thread · may pause UI; serve over HTTP for cancellation');
      getTracks().forEach(function (t) {
        if (t.ready && !local.has(t.id)) {
          local.restoreTrack(t.id, t.channels, t.sampleRate, t.name, t.analysis);
        }
      });
      if (cmd === 'addTrack') {
        return local.addTrack(payload.id, payload.channels, payload.sampleRate, payload.name);
      }
      if (cmd === 'removeTrack') {
        return local.removeTrack(payload.id);
      }
      return local.render(payload.settings, payload.recipe);
    }

    return {
      mode: function () {
        return canWork ? 'worker · cancel available' : 'main thread · may pause UI';
      },
      cancel: function () {
        invalidate('Cancelled. Loaded tracks were kept.');
      },
      call: async function (cmd, payload, transfer) {
        if (!canWork) {
          await new Promise(function (resolve) {
            setTimeout(resolve, 30);
          });
          return runLocal(cmd, payload);
        }
        const epoch = generation;
        if (cmd === 'render') {
          for (const t of getTracks().filter(function (item) { return item.ready; })) {
            if (generation !== epoch) {
              throw new Error('Cancelled.');
            }
            if (!restored.has(t.id)) {
              const copies = t.channels.map(function (c) { return new Float32Array(c); });
              await send('restoreTrack', {
                id: t.id, channels: copies, sampleRate: t.sampleRate, name: t.name, analysis: t.analysis,
              }, copies.map(function (c) { return c.buffer; }));
              restored.add(t.id);
            }
          }
        }
        if (generation !== epoch) {
          throw new Error('Cancelled.');
        }
        const result = await send(cmd, payload, transfer);
        if (cmd === 'addTrack') {
          restored.add(payload.id);
        } else if (cmd === 'removeTrack') {
          restored.delete(payload.id);
        }
        return result;
      },
    };
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
