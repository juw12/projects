"use strict";
// Old Glow links (/glow/app.html, /glow/mobile.html) now open GlowChat inside the Glow ecosystem.
const destination = new URL(document.currentScript.dataset.target, location.href);
destination.search = location.search;
destination.hash = location.hash;
location.replace(destination.href);
