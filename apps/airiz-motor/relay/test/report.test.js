// Relay 1.4.0: only complete, plain USB mode reports are stored, and they add up correctly.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanReport, summarize, MAX_AGE_S, MAX_REPORT_BYTES } from '../src/report.js';

const NOW = Date.UTC(2026, 10, 20, 12, 0, 0);
const good = {
  v: 1, rid: '0123456789ab', mode: 'eth', to: true, link: 'dropped', dropS: 2, back: false,
  reply: 'text', app: '1.11.28', edition: 'desktop', transport: 'usb', agoS: 60,
};
const clean = change => cleanReport(JSON.stringify({ ...good, ...change }), NOW);

test('a complete report becomes one row with the time it happened', () => {
  assert.deepEqual(clean({}), {
    rid: '0123456789ab', at: NOW - 60000, mode: 'eth', setTo: 1, link: 'dropped', dropS: 2, back: 0,
    reply: 'text', app: '1.11.28', edition: 'desktop', transport: 'usb',
  });
  assert.equal(clean({ link: 'kept', dropS: null, mode: 'uvc', to: false }).setTo, 0);
  assert.equal(clean({ agoS: undefined }).at, NOW);
  assert.equal(clean({ agoS: 10 * MAX_AGE_S }).at, NOW - MAX_AGE_S * 1000);
});

test('anything that is not a plain report is refused', () => {
  for (const change of [
    { v: 2 }, { mode: 'hid' }, { link: 'gone' }, { reply: 'diag usbmode: unknown' }, { edition: 'aicc' },
    { transport: 'remote' }, { to: 'yes' }, { back: 1 }, { app: '1.11.28-beta' }, { app: 11128 },
    { rid: 'juwen_lie' }, { rid: undefined }, { dropS: -1 }, { dropS: 2.5 }, { dropS: 9999 }, { dropS: null },
    { link: 'kept', dropS: 3 }, { link: 'kept', dropS: null, back: true },
  ]) {
    assert.equal(clean(change), null, JSON.stringify(change));
  }
  assert.equal(cleanReport('not json', NOW), null);
  assert.equal(cleanReport('[1]', NOW), null);
  assert.equal(cleanReport(JSON.stringify({ ...good, extra: 'x'.repeat(MAX_REPORT_BYTES) }), NOW), null);
  assert.equal(cleanReport(new ArrayBuffer(8), NOW), null);
});

test('extra fields such as device text never reach the row', () => {
  const row = clean({ text: 'serial 12345', user: 'someone' });
  assert.deepEqual(Object.keys(row).sort(), [
    'app', 'at', 'back', 'dropS', 'edition', 'link', 'mode', 'reply', 'rid', 'setTo', 'transport',
  ]);
});

test('the summary counts switched / refused / no change / closed per mode and skips test rows', () => {
  const rows = [
    { mode: 'eth', link: 'dropped', reply: 'text', edition: 'desktop' },
    { mode: 'eth', link: 'dropped', reply: 'none', edition: 'web' },
    { mode: 'eth', link: 'kept', reply: 'error', edition: 'desktop' },
    { mode: 'cdc', link: 'kept', reply: 'text', edition: 'desktop' },
    { mode: 'cdc', link: 'closed', reply: 'none', edition: 'mobile' },
    { mode: 'uvc', link: 'dropped', reply: 'none', edition: 'test' },
  ];
  assert.deepEqual(summarize(rows), {
    cdc: { reports: 2, switched: 0, refused: 0, noChange: 1, closed: 1 },
    eth: { reports: 3, switched: 2, refused: 1, noChange: 0, closed: 0 },
    uvc: { reports: 0, switched: 0, refused: 0, noChange: 0, closed: 0 },
  });
});
