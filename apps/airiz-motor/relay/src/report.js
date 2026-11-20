/* USB mode result reports (relay 1.4.0): checking one report and adding reports up.
 *
 * The console (web/usbmode-report.js) sends one small JSON message after a USB mode command was
 * sent to a real AIRIZ. Only the fields below are kept; anything else is refused. No address, user
 * or device name is stored. Pure functions: also used by the Node tests (test/report.test.js).
 */
export const MAX_REPORT_BYTES = 600;
export const MAX_REPORT_ROWS = 2000;
export const MAX_REPORTS_PER_DAY = 300;
export const MAX_AGE_S = 30 * 24 * 3600;

const CHOICES = {
  mode: ['cdc', 'eth', 'uvc'],
  link: ['dropped', 'closed', 'kept'],
  reply: ['none', 'text', 'error'],
  edition: ['web', 'desktop', 'mobile', 'test'],
  transport: ['usb', 'bluetooth'],
};

// Returns the row to store, or null when the message is not a valid report.
export function cleanReport(message, now = Date.now()) {
  if (typeof message !== 'string' || message.length > MAX_REPORT_BYTES) return null;
  let data;
  try {
    data = JSON.parse(message);
  } catch (ignored) {
    return null;
  }
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.v !== 1) return null;
  for (const [field, allowed] of Object.entries(CHOICES)) {
    if (!allowed.includes(data[field])) return null;
  }
  if (typeof data.to !== 'boolean' || typeof data.back !== 'boolean') return null;
  if (typeof data.app !== 'string' || !/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(data.app)) return null;
  if (typeof data.rid !== 'string' || !/^[0-9a-f]{12}$/.test(data.rid)) return null;
  const kept = data.link === 'kept';
  if (kept) {
    if (data.dropS !== null || data.back) return null;
  } else if (!Number.isInteger(data.dropS) || data.dropS < 0 || data.dropS > 600) {
    return null;
  }
  const agoS = Number.isFinite(data.agoS) ? Math.min(Math.max(0, Math.round(data.agoS)), MAX_AGE_S) : 0;
  return {
    rid: data.rid,
    at: now - agoS * 1000,
    mode: data.mode,
    setTo: data.to ? 1 : 0,
    link: data.link,
    dropS: kept ? null : data.dropS,
    back: data.back ? 1 : 0,
    reply: data.reply,
    app: data.app,
    edition: data.edition,
    transport: data.transport,
  };
}

/* What the reports say for each USB mode (test rows are left out):
 *   switched  the device connection was lost by itself after the command: the AIRIZ rebooted or
 *             changed its USB mode, so the firmware took the command
 *   refused   still connected and the device printed an error (unknown command, usage: ...)
 *   noChange  still connected and no error text (already in that mode, or nothing happened)
 *   closed    the connection ended without a detected loss (Disconnect pressed, or Bluetooth)
 */
export function summarize(rows) {
  const byMode = {};
  for (const mode of CHOICES.mode) {
    byMode[mode] = { reports: 0, switched: 0, refused: 0, noChange: 0, closed: 0 };
  }
  for (const row of rows) {
    if (row.edition === 'test' || !byMode[row.mode]) continue;
    const entry = byMode[row.mode];
    entry.reports += 1;
    if (row.link === 'dropped') entry.switched += 1;
    else if (row.link === 'closed') entry.closed += 1;
    else if (row.reply === 'error') entry.refused += 1;
    else entry.noChange += 1;
  }
  return byMode;
}
