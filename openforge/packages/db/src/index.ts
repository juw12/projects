// @openforge/db — public surface for the rest of the monorepo.
// Anything not re-exported here is internal to this package.

export * from './schema/index.js';
export { db, type Database } from './client.js';
export {
  acquireRefLock,
  acquireRepoLock,
  releaseRefLock,
  LockDisposedSignal,
  RepoLockedError,
  type LockHandle,
  type Transaction,
} from './helpers/ref-locking.js';
