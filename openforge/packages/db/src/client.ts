import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index.js';

const url = process.env['DATABASE_URL'];
if (!url) {
  throw new Error('DATABASE_URL is required to construct the db client');
}

// postgres-js is the memo-recommended driver: prepared-statement cache, fast,
// and plays nicely with Drizzle's pg-core query builder.
const client = postgres(url, {
  max: Number(process.env['DB_POOL_MAX'] ?? 10),
  idle_timeout: 30,
  prepare: false, // server-side prepared statements conflict with pgbouncer/pooler modes
});

export const db = drizzle(client, { schema, logger: false });
export type Database = typeof db;
