import { customType } from 'drizzle-orm/pg-core';

/**
 * Postgres extension types re-exported as Drizzle customTypes.
 * Keeps schema declarations tidy: `citext('email')` instead of `customType(...)`.
 */

export const citext = customType<{ data: string; driverData: string }>({
  dataType: () => 'citext',
});

export const inet = customType<{ data: string; driverData: string }>({
  dataType: () => 'inet',
});

export const ltree = customType<{ data: string; driverData: string }>({
  dataType: () => 'ltree',
});

export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
  toDriver: (v) => v,
  fromDriver: (v) => v,
});
