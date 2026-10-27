/* AIRIZ camera relay (Cloudflare Worker + Durable Object).
 *
 * Fallback for networks that block WebRTC (company firewalls): the PC console sends
 * JPEG frames over an ordinary HTTPS WebSocket and phones receive them the same way.
 *
 *   wss://<worker>/v1/room/<6-digit code>?role=pc       one PC per room (sends frames)
 *   wss://<worker>/v1/room/<6-digit code>?role=viewer   up to MAX_VIEWERS phones
 *
 * Nothing is stored: frames are forwarded in memory and the room disappears when the
 * PC leaves. Control messages are small JSON strings; frames are binary.
 */
import { DurableObject } from 'cloudflare:workers';

const MAX_VIEWERS = 10;
const MAX_FRAME_BYTES = 512 * 1024;
const CODE_PATTERN = /^\d{6}$/;
const MAX_LABEL = 40;

function cleanLabel(value) {
  return String(value || '').replace(/[^A-Za-z0-9 ._()-]/g, '').slice(0, MAX_LABEL);
}

function allowedOrigin(request, env) {
  const origin = request.headers.get('Origin');
  if (!origin) return true; // native clients and tests without a browser origin
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;
  return String(env.ALLOWED_ORIGINS || '').split(',').map(item => item.trim()).includes(origin);
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/v1/status') return json({ ok: true, app: 'airiz-relay', version: '1.1.0' });

    const match = /^\/v1\/room\/([^/]+)$/.exec(url.pathname);
    if (!match) return json({ error: 'not found' }, 404);
    const code = match[1];
    const role = url.searchParams.get('role');
    if (!CODE_PATTERN.test(code) || !['pc', 'viewer'].includes(role)) return json({ error: 'bad request' }, 400);
    if (request.headers.get('Upgrade') !== 'websocket') return json({ error: 'websocket required' }, 426);
    if (!allowedOrigin(request, env)) return json({ error: 'origin not allowed' }, 403);

    const room = env.ROOMS.get(env.ROOMS.idFromName(code));
    return room.fetch(request);
  },
};

export class Room extends DurableObject {
  async fetch(request) {
    const role = new URL(request.url).searchParams.get('role');
    const viewers = this.ctx.getWebSockets('viewer');
    if (role === 'viewer' && viewers.length >= MAX_VIEWERS) {
      return json({ error: 'room full' }, 429);
    }
    const [client, server] = Object.values(new WebSocketPair());
    if (role === 'pc') {
      // A new PC session replaces an old one (e.g. after a reconnect).
      for (const old of this.ctx.getWebSockets('pc')) {
        try {
          old.close(4000, 'replaced');
        } catch (ignored) { /* already closed */ }
      }
    }
    this.ctx.acceptWebSocket(server, [role]);
    if (role === 'viewer') server.serializeAttachment({ label: '', since: Date.now() });
    if (role === 'viewer') {
      server.send(JSON.stringify({ type: 'status', pc: this.ctx.getWebSockets('pc').length > 0 }));
    } else {
      this.broadcastToViewers(JSON.stringify({ type: 'status', pc: true }));
    }
    this.reportViewers();
    return new Response(null, { status: 101, webSocket: client });
  }

  roleOf(ws) {
    return this.ctx.getTags(ws)[0];
  }

  broadcastToViewers(message) {
    for (const viewer of this.ctx.getWebSockets('viewer')) {
      try {
        viewer.send(message);
      } catch (ignored) { /* closing */ }
    }
  }

  // closing: a socket that is going away but may still be listed by getWebSockets().
  reportViewers(closing = null) {
    const viewers = this.ctx.getWebSockets('viewer').filter(viewer => viewer !== closing);
    const list = viewers.map(viewer => {
      const info = viewer.deserializeAttachment() || {};
      return { label: info.label || '', since: info.since || 0 };
    });
    const message = JSON.stringify({ type: 'viewers', count: viewers.length, list, now: Date.now() });
    for (const pc of this.ctx.getWebSockets('pc')) {
      try {
        pc.send(message);
      } catch (ignored) { /* closing */ }
    }
  }

  async webSocketMessage(ws, message) {
    const role = this.roleOf(ws);
    if (role === 'pc') {
      if (typeof message === 'string') {
        // Small control messages from the PC (e.g. {"type":"ended"}) go to every viewer.
        if (message.length <= 2000) this.broadcastToViewers(message);
        return;
      }
      if (message.byteLength > MAX_FRAME_BYTES) return;
      this.broadcastToViewers(message);
    }
    // Viewers only introduce themselves ({"type":"hello","label":"iPhone (Safari)"}).
    if (role === 'viewer' && typeof message === 'string' && message.length <= 500) {
      try {
        const data = JSON.parse(message);
        if (data && data.type === 'hello') {
          const info = ws.deserializeAttachment() || {};
          ws.serializeAttachment({ label: cleanLabel(data.label), since: info.since || Date.now() });
          this.reportViewers();
        }
      } catch (ignored) { /* not JSON */ }
    }
  }

  async webSocketClose(ws) {
    const role = this.roleOf(ws);
    try {
      ws.close();
    } catch (ignored) { /* already closed */ }
    if (role === 'pc' && this.ctx.getWebSockets('pc').every(other => other === ws)) {
      this.broadcastToViewers(JSON.stringify({ type: 'ended' }));
    }
    this.reportViewers(ws);
  }

  async webSocketError(ws) {
    await this.webSocketClose(ws);
  }
}
