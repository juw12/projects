/* Where the toolkit is running. A static host (e.g. GitHub Pages) has no private data pack and no vault API,
   so index.html and app.js skip those probes there. server/vault_server.py and desktop/merd_app.py answer
   this same path with their own value, so private packs and the vault keep working when they serve the app. */
window.ME_RUNTIME = window.ME_RUNTIME || "static";
