/* ------------------------------------------------------- sync: merge model */
// Field-level last-writer-wins. Every record carries `_ts` (last modified, ms) and `_f`, a map of
// path -> ms for each field that changed. Paths are "field", "field.key" for plain objects
// (couple.a.name, program.done.3) and "field#id" for id-lists (goal steps). A path with a timestamp
// but no value means "removed then". So two partners editing different fields - or different steps
// of the same goal - both keep their edit; only edits to the very same field compete.
// Whole-record deletions leave tombstones in `_deleted` and win over older edits.
const SYNCED_COLLECTIONS = ["milestones", "goals", "funds", "checkins", "bucket", "kids", "networth"];
const SYNCED_SINGLETONS = ["couple", "retirement", "program"];
const ID_LIST_FIELDS = new Set(["steps"]);
const META_FIELDS = new Set(["_ts", "_f", "id"]);

function recordBody(record) {
  if (!record || typeof record !== "object") return JSON.stringify(record ?? null);
  const { _ts, _f, ...rest } = record;
  return JSON.stringify(rest);
}
const isPlainObject = value => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** Flatten a record into {path: JSON value} leaves. */
function recordLeaves(record) {
  const leaves = {};
  for (const [field, value] of Object.entries(record || {})) {
    if (META_FIELDS.has(field)) continue;
    if (ID_LIST_FIELDS.has(field) && Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === "object" && item.id !== undefined) leaves[`${field}#${item.id}`] = JSON.stringify(item);
      }
    } else if (isPlainObject(value)) {
      for (const [key, inner] of Object.entries(value)) leaves[`${field}.${key}`] = JSON.stringify(inner);
    } else {
      leaves[field] = JSON.stringify(value ?? null);
    }
  }
  return leaves;
}

/** Give `next` per-field timestamps relative to `previous`. Returns true if anything changed. */
function stampRecord(previous, next, now) {
  if (!next || typeof next !== "object") return false;
  if (!previous) {
    next._ts = now;
    next._f = {};
    return true;
  }
  const fields = { ...(previous._f || {}) };
  const before = recordLeaves(previous);
  const after = recordLeaves(next);
  let changed = false;
  for (const path of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (before[path] !== after[path]) {
      fields[path] = now;
      changed = true;
    }
  }
  next._f = fields;
  next._ts = changed ? now : (next._ts ?? previous._ts ?? 0);
  return changed;
}

/** Merge two versions of one record path-by-path; newest timestamp wins, ties resolve deterministically. */
function mergeRecord(x, y) {
  if (!x) return y;
  if (!y) return x;
  const leavesX = recordLeaves(x);
  const leavesY = recordLeaves(y);
  // Stamped records: unlisted paths are unchanged since creation (0). Legacy records: whole-record `_ts`.
  const stamp = (record, path, leaves) => record._f
    ? record._f[path] ?? (path in leaves ? 0 : -1)
    : (path in leaves ? record._ts || 0 : -1);
  const newer = (y._ts || 0) > (x._ts || 0) ? y : x;
  const older = newer === x ? y : x;
  const result = {};
  for (const [field, value] of Object.entries({ ...older, ...newer })) {
    if (META_FIELDS.has(field) && field !== "id") continue;
    result[field] = ID_LIST_FIELDS.has(field) && Array.isArray(value) ? [] : isPlainObject(value) ? {} : value;
  }
  const fields = {};
  const paths = new Set([...Object.keys(leavesX), ...Object.keys(leavesY), ...Object.keys(x._f || {}), ...Object.keys(y._f || {})]);
  const listItems = {};
  for (const path of paths) {
    const tx = stamp(x, path, leavesX);
    const ty = stamp(y, path, leavesY);
    let value;
    if (tx !== ty) value = tx > ty ? leavesX[path] : leavesY[path];
    else value = [leavesX[path] ?? "", leavesY[path] ?? ""].sort().pop() || undefined;
    if (Math.max(tx, ty) > 0) fields[path] = Math.max(tx, ty);
    if (value === undefined) continue;
    const listMatch = path.match(/^([^.#]+)#(.+)$/);
    const objectMatch = path.match(/^([^.#]+)\.(.+)$/);
    if (listMatch && ID_LIST_FIELDS.has(listMatch[1])) {
      (listItems[listMatch[1]] ||= {})[listMatch[2]] = JSON.parse(value);
    } else if (objectMatch && isPlainObject(result[objectMatch[1]])) {
      result[objectMatch[1]][objectMatch[2]] = JSON.parse(value);
    } else if (!objectMatch && !listMatch) {
      result[path] = JSON.parse(value);
    }
  }
  for (const [field, items] of Object.entries(listItems)) {
    // Keep the newer side's order, then the other side's, then anything else.
    const order = [...(newer[field] || []), ...(older[field] || [])].map(item => String(item?.id));
    const ids = [...new Set([...order, ...Object.keys(items)])].filter(id => id in items);
    result[field] = ids.map(id => items[id]);
  }
  result._f = fields;
  result._ts = Math.max(x._ts || 0, y._ts || 0);
  return result;
}

/** Stamp per-field changes since `previous` and tombstone deleted ids. Mutates and returns `next`. */
function stampChanges(previous, next, now = Date.now()) {
  previous = previous || {};
  next._deleted = { ...(next._deleted || {}) };
  for (const key of SYNCED_COLLECTIONS) {
    const before = new Map((previous[key] || []).map(record => [record.id, record]));
    const present = new Set();
    for (const record of next[key] || []) {
      present.add(record.id);
      if (stampRecord(before.get(record.id), record, now)) delete next._deleted[record.id];
    }
    for (const id of before.keys()) {
      if (!present.has(id)) next._deleted[id] = now;
    }
  }
  for (const key of SYNCED_SINGLETONS) {
    if (next[key]) stampRecord(previous[key] || null, next[key], now);
  }
  const previousTalks = previous.talks || {};
  for (const [topicId, entry] of Object.entries(next.talks || {})) {
    const copy = { ...entry };
    stampRecord(previousTalks[topicId] || null, copy, now);
    next.talks[topicId] = copy;
  }
  return next;
}

/** Merge two plans field-by-field (see the model above). Pure: inputs are not modified. */
function mergeStates(local, remote, now = Date.now()) {
  const a = migrate(JSON.parse(JSON.stringify(local)));
  const b = migrate(JSON.parse(JSON.stringify(remote)));
  const deleted = { ...a._deleted };
  for (const [id, ts] of Object.entries(b._deleted || {})) deleted[id] = Math.max(deleted[id] || 0, ts);
  for (const key of SYNCED_COLLECTIONS) {
    const byId = new Map();
    const order = [];
    for (const record of [...a[key], ...b[key]]) {
      const existing = byId.get(record.id);
      if (!existing) order.push(record.id);
      byId.set(record.id, existing ? mergeRecord(existing, record) : record);
    }
    a[key] = order.map(id => byId.get(id)).filter(record => !(deleted[record.id] !== undefined && deleted[record.id] >= (record._ts || 0)));
  }
  for (const key of SYNCED_SINGLETONS) {
    a[key] = mergeRecord(a[key], b[key]);
  }
  for (const [topicId, entry] of Object.entries(b.talks || {})) {
    a.talks[topicId] = mergeRecord(a.talks[topicId], entry);
  }
  a.lastBackupAt = [local.lastBackupAt, remote.lastBackupAt].filter(Boolean).sort().pop() || null;
  const cutoff = now - 180 * 864e5;
  a._deleted = Object.fromEntries(Object.entries(deleted).filter(([, ts]) => ts > cutoff));
  return a;
}

/** Order-insensitive fingerprint used to decide whether two plans differ. */
function canonical(value) {
  if (Array.isArray(value)) {
    const items = value.map(canonical);
    if (items.every(item => item && typeof item === "object" && "id" in item)) {
      items.sort((x, y) => String(x.id).localeCompare(String(y.id)));
    }
    return items;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
}
function planFingerprint(plan) {
  const { updatedAt, ...rest } = plan || {};
  return JSON.stringify(canonical(rest));
}

