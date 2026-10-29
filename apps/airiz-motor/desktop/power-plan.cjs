'use strict';

// 1.9.1: while this PC shares the AIRIZ, the Windows power-plan settings that would still put it
// to sleep are switched off, and switched back the moment sharing stops.
//
//   sleep  "Sleep after" and "Hibernate after" -> Never (plugged in and on battery). On Modern
//          Standby laptops Windows ends an app's keep-awake request 5 minutes after the sleep
//          timeout when it runs on battery, so the timeout itself has to be Never while sharing.
//   lid    "When I close the lid" -> Do nothing (plugged in and on battery), so closing the lid
//          no longer sleeps the PC while phones control the AIRIZ through it.
//
// The owner's own values are written to a file BEFORE anything changes. They are put back when
// sharing stops, when the window reloads or closes, when the app quits and, if the app was
// killed, the next time it starts. Settings that IT controls by group policy are left alone.

const GROUPS = Object.freeze({
  sleep: Object.freeze([
    { group: 'SUB_SLEEP', setting: 'STANDBYIDLE', guid: '29f6c1db-86da-48c5-9fdb-f2b67b1f44da', off: 0 },
    { group: 'SUB_SLEEP', setting: 'HIBERNATEIDLE', guid: '9d7815a6-7ee4-497e-8888-515a05f02364', off: 0 },
  ]),
  lid: Object.freeze([
    { group: 'SUB_BUTTONS', setting: 'LIDACTION', guid: '5ca83367-6e45-459f-a27b-476b1d01c936', off: 0 },
  ]),
});

const GUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function parseScheme(text) {
  const match = GUID_PATTERN.exec(String(text || ''));
  return match ? match[0].toLowerCase() : null;
}

// powercfg prints one setting's plugged-in (AC) and battery (DC) values as the last two hex
// numbers; the labels around them are translated, the numbers are not.
function parseValues(text) {
  const numbers = [...String(text || '').matchAll(/0x([0-9a-f]+)/gi)].map(match => parseInt(match[1], 16));
  if (numbers.length < 2 || numbers.some(Number.isNaN)) return null;
  return { ac: numbers[numbers.length - 2], dc: numbers[numbers.length - 1] };
}

// The first block of "powercfg /a" lists the sleep states this PC has: "S0" there means Modern
// Standby (its screen going off can end in standby), S1-S3 classic sleep.
function parseStandby(text) {
  const firstBlock = String(text || '').replace(/\r/g, '').split(/\n\s*\n/)[0] || '';
  if (/\bS0\b/.test(firstBlock)) return 'modern';
  if (/\bS[1-3]\b/.test(firstBlock)) return 'classic';
  return 'unknown';
}

function createPowerPlan(options) {
  const run = options.run;
  const runSync = options.runSync;
  const store = options.store;
  const policyManaged = options.policyManaged || (async () => false);
  const log = options.log || (() => {});

  let saved = [];
  try {
    const loaded = store.load();
    if (Array.isArray(loaded)) saved = loaded.filter(validEntry);
  } catch (error) {
    log('power plan: could not read the saved settings', error);
  }
  const status = { sleep: 'off', lid: 'off' };
  let standby = 'unknown';
  let queue = Promise.resolve();

  function validEntry(entry) {
    return entry && GUID_PATTERN.test(String(entry.scheme)) && typeof entry.kind === 'string'
      && /^[A-Z_]+$/.test(String(entry.group)) && /^[A-Z_]+$/.test(String(entry.setting))
      && Number.isInteger(entry.ac) && Number.isInteger(entry.dc) && entry.ac >= 0 && entry.dc >= 0;
  }

  function persist() {
    try {
      if (saved.length) store.save(saved);
      else store.clear();
    } catch (error) {
      log('power plan: could not write the saved settings', error);
    }
  }

  async function query(scheme, item) {
    for (const verb of ['/qh', '/q']) {
      const result = await run([verb, scheme, item.group, item.setting]);
      const values = result.code === 0 ? parseValues(result.stdout) : null;
      if (values) return values;
    }
    return null;
  }

  async function setValues(scheme, item, values) {
    const ac = await run(['/setacvalueindex', scheme, item.group, item.setting, String(values.ac)]);
    const dc = await run(['/setdcvalueindex', scheme, item.group, item.setting, String(values.dc)]);
    return ac.code === 0 && dc.code === 0;
  }

  async function applyGroup(kind) {
    const scheme = parseScheme((await run(['/getactivescheme'])).stdout);
    if (!scheme) return 'failed';
    let managed = false;
    let failed = false;
    let changed = false;
    for (const item of GROUPS[kind]) {
      if (await policyManaged(item.guid)) {
        managed = true;
        continue;
      }
      const current = await query(scheme, item);
      if (!current) {
        failed = true;
        continue;
      }
      if (current.ac === item.off && current.dc === item.off) continue;
      // Keep the owner's value from the first change only (a second apply must not save "off").
      if (!saved.some(entry => entry.scheme === scheme && entry.setting === item.setting)) {
        saved.push({ kind, scheme, group: item.group, setting: item.setting, ac: current.ac, dc: current.dc });
        persist();
      }
      if (await setValues(scheme, item, { ac: item.off, dc: item.off })) changed = true;
      else failed = true;
    }
    if (changed) await run(['/setactive', scheme]);
    for (const item of GROUPS[kind]) {
      if (!saved.some(entry => entry.kind === kind && entry.setting === item.setting)) continue;
      const now = await query(scheme, item);
      if (!now || now.ac !== item.off || now.dc !== item.off) failed = true;
    }
    if (failed) {
      await releaseGroup(kind);
      return 'failed';
    }
    return managed ? 'managed' : 'on';
  }

  async function releaseGroup(kind) {
    const entries = saved.filter(entry => entry.kind === kind);
    if (!entries.length) return true;
    let ok = true;
    for (const entry of entries) {
      let restored = await setValues(entry.scheme, entry, entry);
      if (!restored) {
        // The change itself may have failed earlier: nothing to put back if the value is unchanged.
        const current = await query(entry.scheme, entry);
        restored = !!current && current.ac === entry.ac && current.dc === entry.dc;
      }
      if (restored) saved = saved.filter(other => other !== entry);
      else ok = false;
    }
    await run(['/setactive', 'SCHEME_CURRENT']);
    persist();
    return ok;
  }

  function releaseAllSync() {
    if (!saved.length) return true;
    let ok = true;
    for (const entry of [...saved]) {
      const ac = runSync(['/setacvalueindex', entry.scheme, entry.group, entry.setting, String(entry.ac)]);
      const dc = runSync(['/setdcvalueindex', entry.scheme, entry.group, entry.setting, String(entry.dc)]);
      if (ac.code === 0 && dc.code === 0) saved = saved.filter(other => other !== entry);
      else ok = false;
    }
    runSync(['/setactive', 'SCHEME_CURRENT']);
    persist();
    status.sleep = 'off';
    status.lid = 'off';
    return ok;
  }

  function snapshot() {
    return { sleep: status.sleep, lid: status.lid, standby, changed: saved.map(entry => entry.setting) };
  }

  function enqueue(task) {
    const next = queue.then(task, task);
    queue = next.catch(error => log('power plan', error));
    return next;
  }

  return {
    // wanted: { sleep?: boolean, lid?: boolean } -> the new status of both groups.
    update(wanted) {
      return enqueue(async () => {
        for (const kind of ['sleep', 'lid']) {
          if (typeof wanted[kind] !== 'boolean') continue;
          if (wanted[kind]) {
            if (status[kind] !== 'on' && status[kind] !== 'managed') status[kind] = await applyGroup(kind);
          } else {
            await releaseGroup(kind);
            status[kind] = 'off';
          }
        }
        return snapshot();
      });
    },
    // At start: the app was killed while sharing -> put the owner's values back.
    recover() {
      return enqueue(async () => {
        if (saved.length) {
          await releaseGroup('sleep');
          await releaseGroup('lid');
          for (const kind of [...new Set(saved.map(entry => entry.kind))]) await releaseGroup(kind);
        }
        return snapshot();
      });
    },
    detectStandby() {
      return enqueue(async () => {
        const result = await run(['/a']);
        standby = result.code === 0 ? parseStandby(result.stdout) : 'unknown';
        return standby;
      });
    },
    releaseAllSync,
    get status() {
      return snapshot();
    },
    get pending() {
      return saved.length;
    },
  };
}

// The real Windows wiring: powercfg.exe, reg.exe and a JSON file in the app's data folder.
function windowsPowerPlan(options) {
  const childProcess = options.childProcess || require('node:child_process');
  const fs = options.fs || require('node:fs');
  const stateFile = options.stateFile;
  const windowsHide = { windowsHide: true, timeout: 15000, encoding: 'utf8' };

  function run(args) {
    return new Promise(resolve => {
      childProcess.execFile('powercfg.exe', args, windowsHide, (error, stdout) => {
        resolve({ code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, stdout: String(stdout || '') });
      });
    });
  }

  function runSync(args) {
    try {
      const stdout = childProcess.execFileSync('powercfg.exe', args, windowsHide);
      return { code: 0, stdout: String(stdout || '') };
    } catch (error) {
      return { code: typeof error.status === 'number' ? error.status : 1, stdout: String(error.stdout || '') };
    }
  }

  function policyManaged(guid) {
    return new Promise(resolve => {
      const key = 'HKLM\\SOFTWARE\\Policies\\Microsoft\\Power\\PowerSettings\\' + guid;
      childProcess.execFile('reg.exe', ['query', key], windowsHide, error => resolve(!error));
    });
  }

  const store = {
    load() {
      if (!fs.existsSync(stateFile)) return [];
      return JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    },
    save(entries) {
      fs.writeFileSync(stateFile, JSON.stringify(entries, null, 2), 'utf8');
    },
    clear() {
      if (fs.existsSync(stateFile)) fs.unlinkSync(stateFile);
    },
  };

  return createPowerPlan({ run, runSync, store, policyManaged, log: options.log });
}

module.exports = { createPowerPlan, windowsPowerPlan, parseScheme, parseValues, parseStandby, GROUPS };
