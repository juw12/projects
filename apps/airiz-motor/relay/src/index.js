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
 *
 * Remote control by code (1.3.0) uses separate rooms on the same worker:
 *
 *   wss://<worker>/v1/control/<6-digit code>?role=pc    the PC that is connected to the AIRIZ by USB
 *   wss://<worker>/v1/control/<6-digit code>?role=ctl   up to MAX_CONTROLLERS phones / browsers
 *
 * Controllers' JSON messages are forwarded to the PC with a "from" id added; the PC's
 * JSON messages go to one controller ("to": id) or to all of them. The PC decides who
 * may control the device (it asks its operator); the relay only forwards text.
 */
import { DurableObject } from 'cloudflare:workers';

const MAX_VIEWERS = 10;
const MAX_CONTROLLERS = 4;
const MAX_FRAME_BYTES = 512 * 1024;
const MAX_CONTROL_TO_PC = 8 * 1024;
const MAX_CONTROL_FROM_PC = 32 * 1024;
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
    if (url.pathname === '/v1/status') return json({ ok: true, app: 'airiz-relay', version: '1.2.0', control: true });

    const match = /^\/v1\/(room|control)\/([^/]+)$/.exec(url.pathname);
    if (!match) return json({ error: 'not found' }, 404);
    const control = match[1] === 'control';
    const code = match[2];
    const role = url.searchParams.get('role');
    const roles = control ? ['pc', 'ctl'] : ['pc', 'viewer'];
    if (!CODE_PATTERN.test(code) || !roles.includes(role)) return json({ error: 'bad request' }, 400);
    if (request.headers.get('Upgrade') !== 'websocket') return json({ error: 'websocket required' }, 426);
    if (!allowedOrigin(request, env)) return json({ error: 'origin not allowed' }, 403);

    const room = env.ROOMS.get(env.ROOMS.idFromName(control ? 'control:' + code : code));
    return room.fetch(request);
  },
};

export class Room extends DurableObject {
  async fetch(request) {
    const url = new URL(request.url);
    const role = url.searchParams.get('role');
    if (url.pathname.startsWith('/v1/control/')) return this.acceptControl(role);
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

  // ---------------------------------------------------------------- remote control rooms
  acceptControl(role) {
    const controllers = this.ctx.getWebSockets('ctl');
    if (role === 'ctl' && controllers.length >= MAX_CONTROLLERS) return json({ error: 'room full' }, 429);
    const [client, server] = Object.values(new WebSocketPair());
    if (role === 'pc') {
      for (const old of this.ctx.getWebSockets('pc')) {
        try {
          old.close(4000, 'replaced');
        } catch (ignored) { /* already closed */ }
      }
      this.ctx.acceptWebSocket(server, ['pc', 'control']);
      this.sendToControllers(JSON.stringify({ type: 'status', pc: true }));
    } else {
      const id = crypto.randomUUID().slice(0, 8);
      this.ctx.acceptWebSocket(server, ['ctl', 'control']);
      server.serializeAttachment({ id });
      server.send(JSON.stringify({ type: 'status', pc: this.ctx.getWebSockets('pc').length > 0 }));
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  sendToControllers(message, onlyId = null) {
    for (const controller of this.ctx.getWebSockets('ctl')) {
      const info = controller.deserializeAttachment() || {};
      if (onlyId && info.id !== onlyId) continue;
      try {
        controller.send(message);
      } catch (ignored) { /* closing */ }
    }
  }

  sendToPc(message) {
    for (const pc of this.ctx.getWebSockets('pc')) {
      try {
        pc.send(message);
      } catch (ignored) { /* closing */ }
    }
  }

  controlMessage(ws, role, message) {
    if (typeof message !== 'string') return;
    if (role === 'ctl') {
      if (message.length > MAX_CONTROL_TO_PC) return;
      let data;
      try {
        data = JSON.parse(message);
      } catch (ignored) {
        return;
      }
      if (!data || typeof data !== 'object' || Array.isArray(data)) return;
      const info = ws.deserializeAttachment() || {};
      data.from = info.id;
      if (this.ctx.getWebSockets('pc').length === 0) {
        ws.send(JSON.stringify({ type: 'status', pc: false }));
        return;
      }
      this.sendToPc(JSON.stringify(data));
      return;
    }
    if (role === 'pc') {
      if (message.length > MAX_CONTROL_FROM_PC) return;
      let data;
      try {
        data = JSON.parse(message);
      } catch (ignored) {
        return;
      }
      if (!data || typeof data !== 'object') return;
      const target = typeof data.to === 'string' ? data.to : null;
      delete data.to;
      this.sendToControllers(JSON.stringify(data), target);
    }
  }

  controlClosed(ws, role) {
    if (role === 'ctl') {
      const info = ws.deserializeAttachment() || {};
      this.sendToPc(JSON.stringify({ type: 'left', from: info.id }));
    } else if (role === 'pc' && this.ctx.getWebSockets('pc').every(other => other === ws)) {
      this.sendToControllers(JSON.stringify({ type: 'ended' }));
    }
  }

  isControl(ws) {
    return this.ctx.getTags(ws).includes('control');
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
    if (this.isControl(ws)) {
      this.controlMessage(ws, role, message);
      return;
    }
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
    if (this.isControl(ws)) {
      this.controlClosed(ws, role);
      return;
    }
    if (role === 'pc' && this.ctx.getWebSockets('pc').every(other => other === ws)) {
      this.broadcastToViewers(JSON.stringify({ type: 'ended' }));
    }
    this.reportViewers(ws);
  }

  async webSocketError(ws) {
    await this.webSocketClose(ws);
  }
}
