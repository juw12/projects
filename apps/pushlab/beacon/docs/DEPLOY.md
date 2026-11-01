# Deploying Beacon for real users

Browsers only allow Web Push from pages served over **HTTPS**, so real users need Beacon on a public HTTPS URL.
(For testing on your own phone you don't. Push Lab + Tether reach a local Beacon through `adb reverse`.)

## Option A: Cloudflare Tunnel (free, no server, quickest)

```bash
python apps/pushlab/beacon/server/server.py --public-url https://<your-name>.trycloudflare.com
cloudflared tunnel --url http://localhost:8780          # prints the https URL
```

A quick tunnel's URL changes on every restart. That's fine for demos, but for production create a named tunnel on your domain (`cloudflared tunnel create beacon`). Run Beacon on an always-on machine, because subscriptions only receive messages while Beacon is running.

## Option B: Any VPS with Docker + Caddy (automatic HTTPS)

```bash
cd apps/pushlab/beacon
docker build -t beacon .
docker run -d --name beacon --restart unless-stopped -p 127.0.0.1:8780:8780 \
  -v beacon-data:/data -e BEACON_PUBLIC_URL=https://push.example.com beacon
docker logs beacon        # first start prints the ADMIN TOKEN once
```

`/etc/caddy/Caddyfile`:

```
push.example.com {
    reverse_proxy 127.0.0.1:8780
}
```

## After deploying

1. Open `https://push.example.com/`, sign in with the admin token, and create one app per product.
2. Under **Settings → Allowed origins**, add your app's origin (e.g. `https://juw12.github.io`).
3. Add the two-line snippet from **Setup** to the app, and `importScripts('beacon-sw.js')` to its `sw.js`.
4. Back up the `/data` volume. It holds your VAPID keys. If you lose them, every subscriber has to subscribe again.

Behind a corporate proxy, set `BEACON_PROXY=http://proxy:3128` (or rely on the system proxy).
