// Glow Offline worker: keeps the on-device AI off the page's main thread so GlowChat stays smooth.
import { createHost } from "./glow-offline-engine.js";

const host = createHost((message) => self.postMessage(message));
self.addEventListener("message", (event) => host.handle(event.data));
