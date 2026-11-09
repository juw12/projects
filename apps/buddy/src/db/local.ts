/**
 * Local-only data layer. Single-user, IndexedDB-backed.
 *
 * Implements a chainable query API in the spirit of Supabase's
 * PostgrestQueryBuilder: `.from(table).eq().eq().select()` for read,
 * `.from(table).update({...}).eq().select()` for write. The pending
 * action is queued and executed when `.select()` is called.
 */

import type { UserProfile } from '@shared/types';

const DB_NAME = 'buddy-local';
const DB_VERSION = 1;
const STORES = [
  'profiles',
  'friends',
  'focus_sessions',
  'focus_events',
  'messages',
  'notifications',
  'streak_days',
  'clicky_events',
] as const;
type StoreName = (typeof STORES)[number];

export type Row = {
  id?: string;
  [key: string]: unknown;
};

const CURRENT_USER_ID = 'me';
const CURRENT_USER: UserProfile & Row = {
  id: CURRENT_USER_ID,
  display_name: 'You',
  avatar_url: null,
  bio: null,
  current_streak_days: 4,
  longest_streak_days: 12,
  last_streak_date: new Date().toISOString().slice(0, 10),
  total_focus_seconds: 27_300,
  active_switch_profile: 'cherry-blue',
  active_theme: 'neon',
  last_seen_at: new Date().toISOString(),
  created_at: new Date().toISOString(),
  clicky_count: 7,
  clicky_received_count: 12,
};

let dbInstance: IDBDatabase | null = null;
let openPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbInstance) return Promise.resolve(dbInstance);
  if (openPromise) return openPromise;
  openPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of STORES) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => { dbInstance = req.result; resolve(req.result); };
    req.onerror = () => reject(req.error);
  });
  return openPromise;
}

export async function getAll(store: StoreName): Promise<Row[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve((req.result ?? []) as Row[]);
    req.onerror = () => reject(req.error);
  });
}

export async function getOne(store: StoreName, key: IDBValidKey): Promise<Row | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve((req.result ?? null) as Row | null);
    req.onerror = () => reject(req.error);
  });
}

export async function putOne(store: StoreName, value: Row): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function delOne(store: StoreName, key: IDBValidKey): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

type Filter = (row: Row) => boolean;
type PendingAction = 'select' | 'insert' | 'update' | 'delete';

class Query {
  private filters: Filter[] = [];
  private orderField: string | null = null;
  private orderAsc = true;
  private limitN: number | null = null;
  private action: PendingAction = 'select';
  private payload: Row | Row[] | Partial<Row> | null = null;

  constructor(private store: StoreName) {}

  eq(field: string, value: unknown): this {
    this.filters.push((row) => row[field] === value);
    return this;
  }
  neq(field: string, value: unknown): this {
    this.filters.push((row) => row[field] !== value);
    return this;
  }
  lt(field: string, value: unknown): this {
    this.filters.push((row) => (row[field] as number) < (value as number));
    return this;
  }
  gt(field: string, value: unknown): this {
    this.filters.push((row) => (row[field] as number) > (value as number));
    return this;
  }
  in(field: string, values: unknown[]): this {
    this.filters.push((row) => values.includes(row[field]));
    return this;
  }
  or(filter: string): this {
    const parts = filter.split(',').map((p) => p.trim());
    const conds: Filter[] = parts.map((part) => {
      const match = part.match(/^([\w.]+)\.(eq|neq|lt|gt)\.(.+)$/);
      if (!match) throw new Error(`Unsupported .or() fragment: ${part}`);
      const [, field, op, raw] = match;
      const value: unknown = raw;
      switch (op) {
        case 'eq': return (row) => String(row[field]) === String(value);
        case 'neq': return (row) => String(row[field]) !== String(value);
        case 'lt': return (row) => (row[field] as number) < Number(value);
        case 'gt': return (row) => (row[field] as number) > Number(value);
        default: throw new Error(`Unsupported op: ${op}`);
      }
    });
    this.filters.push((row) => conds.some((c) => c(row)));
    return this;
  }
  order(field: string, opts: { ascending?: boolean } = {}): this {
    this.orderField = field;
    this.orderAsc = opts.ascending !== false;
    return this;
  }
  limit(n: number): this {
    this.limitN = n;
    return this;
  }

  insert(payload: Row | Row[]): this {
    this.action = 'insert';
    this.payload = payload;
    return this;
  }
  update(patch: Partial<Row>): this {
    this.action = 'update';
    this.payload = patch;
    return this;
  }
  delete(): this {
    this.action = 'delete';
    this.payload = null;
    return this;
  }

  private async fetchAll(): Promise<Row[]> {
    let rows = await getAll(this.store);
    for (const f of this.filters) rows = rows.filter(f);
    if (this.orderField) {
      const field = this.orderField;
      const asc = this.orderAsc;
      rows.sort((a, b) => {
        const av = a[field] as string | number;
        const bv = b[field] as string | number;
        if (av < bv) return asc ? -1 : 1;
        if (av > bv) return asc ? 1 : -1;
        return 0;
      });
    }
    if (this.limitN !== null) rows = rows.slice(0, this.limitN);
    return rows;
  }

  async select(): Promise<{ data: Row[]; error: Error | null }> {
    if (this.action === 'insert') {
      const payload = this.payload as Row | Row[];
      const rows = Array.isArray(payload) ? payload : [payload];
      const out: Row[] = [];
      for (const row of rows) {
        const id = row.id ?? crypto.randomUUID();
        const stored = { ...row, id };
        await putOne(this.store, stored);
        out.push(stored);
      }
      const last = out[out.length - 1]!;
      emit({ store: this.store, row: last });
      return { data: out, error: null };
    }
    if (this.action === 'update') {
      const patch = this.payload as Partial<Row>;
      const all = await getAll(this.store);
      const matches = all.filter((row) => this.filters.every((f) => f(row)));
      for (const row of matches) {
        const updated = { ...row, ...patch };
        await putOne(this.store, updated);
        emit({ store: this.store, row: updated });
      }
      return { data: matches, error: null };
    }
    if (this.action === 'delete') {
      const all = await getAll(this.store);
      const matches = all.filter((row) => this.filters.every((f) => f(row)));
      for (const row of matches) {
        await delOne(this.store, row.id as IDBValidKey);
        emit({ store: this.store, id: row.id });
      }
      return { data: matches, error: null };
    }
    const rows = await this.fetchAll();
    return { data: rows, error: null };
  }

  async maybeSingle(): Promise<{ data: Row | null; error: Error | null }> {
    const r = await this.select();
    return { data: r.data[0] ?? null, error: r.error };
  }

  async single(): Promise<{ data: Row | null; error: Error | null }> {
    const r = await this.select();
    if (r.data.length === 0) return { data: null, error: new Error('No rows') };
    if (r.data.length > 1) return { data: null, error: new Error('Multiple rows') };
    return { data: r.data[0] ?? null, error: null };
  }
}

export type ExposedQuery = {
  eq: (field: string, value: unknown) => ExposedQuery;
  neq: (field: string, value: unknown) => ExposedQuery;
  lt: (field: string, value: unknown) => ExposedQuery;
  gt: (field: string, value: unknown) => ExposedQuery;
  in: (field: string, values: unknown[]) => ExposedQuery;
  or: (filter: string) => ExposedQuery;
  order: (field: string, opts?: { ascending?: boolean }) => ExposedQuery;
  limit: (n: number) => ExposedQuery;
  select: () => Promise<{ data: Row[]; error: Error | null }>;
  insert: (payload: Row | Row[]) => ExposedQuery;
  update: (patch: Partial<Row>) => ExposedQuery;
  delete: () => ExposedQuery;
  maybeSingle: () => Promise<{ data: Row | null; error: Error | null }>;
  single: () => Promise<{ data: Row | null; error: Error | null }>;
};

function exposeQueryMethods(q: Query): ExposedQuery {
  return {
    select: () => q.select(),
    insert: (payload) => { q.insert(payload); return exposeQueryMethods(q); },
    update: (patch) => { q.update(patch); return exposeQueryMethods(q); },
    delete: () => { q.delete(); return exposeQueryMethods(q); },
    eq: (field, value) => { q.eq(field, value); return exposeQueryMethods(q); },
    neq: (field, value) => { q.neq(field, value); return exposeQueryMethods(q); },
    lt: (field, value) => { q.lt(field, value); return exposeQueryMethods(q); },
    gt: (field, value) => { q.gt(field, value); return exposeQueryMethods(q); },
    in: (field, values) => { q.in(field, values); return exposeQueryMethods(q); },
    or: (filter) => { q.or(filter); return exposeQueryMethods(q); },
    order: (field, opts) => { q.order(field, opts); return exposeQueryMethods(q); },
    limit: (n) => { q.limit(n); return exposeQueryMethods(q); },
    maybeSingle: () => q.maybeSingle(),
    single: () => q.single(),
  };
}

type Listener = (event: { store: StoreName; row?: Row; id?: unknown }) => void;
const listeners = new Set<Listener>();

function emit(event: { store: StoreName; row?: Row; id?: unknown }) {
  for (const l of listeners) l(event);
}

export function onChange(cb: Listener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export const CURRENT_USER_ID_VALUE = CURRENT_USER_ID;

export function getCurrentUser(): UserProfile {
  return CURRENT_USER as UserProfile;
}

export const supabase = {
  from(store: StoreName): ExposedQuery {
    return exposeQueryMethods(new Query(store));
  },

  async rpc(name: string, args: { p_to_user_id?: string; p_source?: string }) {
    if (name === 'give_clicky') {
      const toUserId = args.p_to_user_id!;
      const source = args.p_source ?? 'manual';
      const event: Row = {
        id: crypto.randomUUID(),
        from_user_id: CURRENT_USER_ID,
        to_user_id: toUserId,
        source,
        created_at: new Date().toISOString(),
      };
      await putOne('clicky_events', event);

      const myProfile = (await getOne('profiles', CURRENT_USER_ID)) ?? CURRENT_USER;
      await putOne('profiles', {
        ...myProfile,
        clicky_count: ((myProfile.clicky_count as number) ?? 0) + 1,
      });

      const theirProfile = await getOne('profiles', toUserId);
      if (theirProfile) {
        await putOne('profiles', {
          ...theirProfile,
          clicky_received_count: ((theirProfile.clicky_received_count as number) ?? 0) + 1,
        });
        emit({ store: 'profiles', row: theirProfile });
      }

      emit({ store: 'clicky_events', row: event });
      emit({ store: 'profiles', row: myProfile });
      return { data: null, error: null };
    }
    return { data: null, error: new Error(`Unknown RPC: ${name}`) };
  },

  auth: {
    async getSession() {
      return {
        data: { session: { user: CURRENT_USER }, access_token: 'local', refresh_token: 'local' },
        error: null,
      };
    },
    async getUser() {
      return { data: { user: CURRENT_USER }, error: null };
    },
    onAuthStateChange(cb: (event: string, session: { user: UserProfile } | null) => void) {
      cb('INITIAL_SESSION', { user: CURRENT_USER });
      return { data: { subscription: { unsubscribe: () => {} } } };
    },
    async signInWithPassword() { return { data: { user: CURRENT_USER }, error: null }; },
    async signInWithOAuth() { return { data: { user: null }, error: null }; },
    async signUp() { return { data: { user: CURRENT_USER }, error: null }; },
    async signOut() { return { error: null }; },
  },
};
