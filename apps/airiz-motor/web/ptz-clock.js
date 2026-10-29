/* AIRIZ Console 1.11.8: steady ticks for Smart detection.
 * Timers of a minimized or hidden page are slowed down to once a minute by the browser; a
 * worker's timer keeps its pace, so motion is still noticed while the window is minimized. */
let timer = null;
onmessage = event => {
  clearInterval(timer);
  const interval = Number(event.data);
  timer = interval > 0 ? setInterval(() => postMessage(0), interval) : null;
};
