/* Off-main-thread NSFW classification for scan.js (keeps the app responsive on phones without WebGL). */
/* global nsfwjs */
importScripts('vendor/nsfw/nsfwjs.min.js');

let modelPromise = null;

self.onmessage = async (event) => {
  const { id, frames } = event.data;
  try {
    if (!modelPromise) {
      modelPromise = self.nsfwjs.load(new URL('vendor/nsfw/model/', self.location.href).href, { size: 224 });
    }
    const model = await modelPromise;
    const results = [];
    for (const frame of frames) {
      results.push(await model.classify(frame, 5));
    }
    self.postMessage({ id, results });
  } catch (err) {
    modelPromise = null;
    self.postMessage({ id, error: String((err && err.message) || err) });
  }
};
