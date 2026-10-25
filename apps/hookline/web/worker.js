/* Hookline worker: runs analysis and rendering off the UI thread. */
importScripts('engine.js');

const session = self.Hookline.createSession();

self.onmessage = function (event) {
  const message = event.data;
  const args = message.payload || {};
  try {
    let result;
    let transfer = [];
    if (message.cmd === 'addTrack') {
      result = session.addTrack(args.id, args.channels, args.sampleRate, args.name);
    } else if (message.cmd === 'restoreTrack') {
      result = session.restoreTrack(args.id, args.channels, args.sampleRate, args.name, args.analysis);
    } else if (message.cmd === 'removeTrack') {
      result = session.removeTrack(args.id);
    } else if (message.cmd === 'render') {
      const rendered = session.render(args.settings, args.recipe);
      result = {
        channels: rendered.channels,
        sampleRate: rendered.sampleRate,
        plan: rendered.plan,
        score: rendered.score,
      };
      transfer = rendered.channels.map(function (c) {
        return c.buffer;
      });
    } else {
      throw new Error('Unknown command ' + message.cmd);
    }
    self.postMessage({ id: message.id, ok: true, result: result }, transfer);
  } catch (err) {
    self.postMessage({ id: message.id, ok: false, error: String((err && err.message) || err) });
  }
};
