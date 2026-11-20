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
 *   (1.3.0: 20 controllers and 20 camera viewers per code, was 4 and 10 - AIRIZ Console 1.9.1
 *   lets several phones control one AIRIZ at the same time)
 *
 * Controllers' JSON messages are forwarded to the PC with a "from" id added; the PC's
 * JSON messages go to one controller ("to": id) or to all of them. The PC decides who
 * may control the device (it asks its operator); the relay only forwards text.
 *
 * USB mode result reports (1.4.0) are the one thing that is stored (see src/report.js):
 *
 *   wss://<worker>/v1/report            the console sends one small JSON report, gets {"ok":true}
 *   https://<worker>/v1/reports/usbmode what the reports say per USB mode + the latest reports
 *
 * A report has no address, user or device name: only the mode, what the connection did, whether
 * the device printed an error, and the console version / edition / transport.
 */
import { DurableObject } from 'cloudflare:workers';
import { cleanReport, summarize, MAX_REPORT_ROWS, MAX_REPORTS_PER_DAY } from './report.js';

const MAX_VIEWERS = 20;
const MAX_CONTROLLERS = 20;
const MAX_FRAME_BYTES = 512 * 1024;
const MAX_CONTROL_TO_PC = 8 * 1024;
const MAX_CONTROL_FROM_PC = 32 * 1024;
const CODE_PATTERN = /^\d{6}$/;
const MAX_LABEL = 40;
const MAX_REPORT_SOCKETS = 50;
const RECENT_REPORTS = 200;

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
    if (url.pathname === '/v1/status') return json({ ok: true, app: 'airiz-relay', version: '1.4.0', control: true, reports: true, maxControllers: MAX_CONTROLLERS, maxViewers: MAX_VIEWERS });

    // USB mode result reports: one fixed Durable Object keeps the table.
    if (url.pathname === '/v1/report' || url.pathname === '/v1/reports/usbmode') {
      if (url.pathname === '/v1/report') {
        if (request.headers.get('Upgrade') !== 'websocket') return json({ error: 'websocket required' }, 426);
        if (!allowedOrigin(request, env)) return json({ error: 'origin not allowed' }, 403);
      } else if (request.method !== 'GET') {
        return json({ error: 'method not allowed' }, 405);
      }
      return env.ROOMS.get(env.ROOMS.idFromName('reports')).fetch(request);
    }

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
    if (url.pathname === '/v1/report') return this.acceptReport();
    if (url.pathname === '/v1/reports/usbmode') return this.listReports();
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

  // ---------------------------------------------------------------- USB mode result reports
  reportTable() {
    const sql = this.ctx.storage.sql;
    sql.exec(`CREATE TABLE IF NOT EXISTS usbmode_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rid TEXT NOT NULL UNIQUE,
      at INTEGER NOT NULL,
      received INTEGER NOT NULL,
      mode TEXT NOT NULL,
      set_to INTEGER NOT NULL,
      link TEXT NOT NULL,
      drop_s INTEGER,
      back INTEGER NOT NULL,
      reply TEXT NOT NULL,
      app TEXT NOT NULL,
      edition TEXT NOT NULL,
      transport TEXT NOT NULL
    )`);
    return sql;
  }

  acceptReport() {
    // A sender that never sends its report must not block the others: the oldest ones go.
    const waiting = this.ctx.getWebSockets('report');
    for (const old of waiting.slice(0, Math.max(0, waiting.length - MAX_REPORT_SOCKETS + 1))) {
      try {
        old.close(4001, 'too many');
      } catch (ignored) { /* already closed */ }
    }
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server, ['report']);
    return new Response(null, { status: 101, webSocket: client });
  }

  // true: stored (or already stored: the console sends a report again when the answer got lost).
  storeReport(row) {
    const sql = this.reportTable();
    const now = Date.now();
    const today = sql.exec('SELECT COUNT(*) AS count FROM usbmode_reports WHERE received > ?', now - 24 * 3600 * 1000).one().count;
    if (today >= MAX_REPORTS_PER_DAY) return false;
    sql.exec(
      `INSERT OR IGNORE INTO usbmode_reports (rid, at, received, mode, set_to, link, drop_s, back, reply, app, edition, transport)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      row.rid, row.at, now, row.mode, row.setTo, row.link, row.dropS, row.back, row.reply, row.app, row.edition, row.transport,
    );
    sql.exec('DELETE FROM usbmode_reports WHERE id <= (SELECT MAX(id) FROM usbmode_reports) - ?', MAX_REPORT_ROWS);
    return true;
  }

  reportMessage(ws, message) {
    const row = cleanReport(message);
    let ok = false;
    try {
      ok = !!row && this.storeReport(row);
    } catch (error) {
      console.error('report not stored', error);
    }
    try {
      ws.send(JSON.stringify({ ok }));
      ws.close(1000, 'done');
    } catch (ignored) { /* closing */ }
  }

  listReports() {
    const rows = this.reportTable().exec(
      `SELECT at, mode, set_to, link, drop_s, back, reply, app, edition, transport
       FROM usbmode_reports ORDER BY at DESC`,
    ).toArray();
    const real = rows.filter(row => row.edition !== 'test');
    return json({
      ok: true,
      reports: real.length,
      testReports: rows.length - real.length,
      byMode: summarize(rows),
      meaning: {
        switched: 'the device connection was lost by itself after the command (reboot / USB mode change): the firmware took it',
        refused: 'still connected and the device printed an error',
        noChange: 'still connected, no error text (already in that mode, or nothing happened)',
        closed: 'the connection ended without a detected loss (Disconnect pressed, or Bluetooth)',
      },
      latest: rows.slice(0, RECENT_REPORTS).map(row => ({
        at: new Date(row.at).toISOString(),
        mode: row.mode,
        command: 'diag usbmode set ' + (row.set_to ? 'to ' : '') + row.mode,
        link: row.link,
        dropS: row.drop_s,
        back: !!row.back,
        reply: row.reply,
        app: row.app,
        edition: row.edition,
        transport: row.transport,
      })),
    });
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
    if (role === 'report') {
      this.reportMessage(ws, message);
      return;
    }
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
    if (role === 'report') return;
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
