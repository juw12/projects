# ShardBase — Test 2: PG Wire Protocol Validation

Minimal PostgreSQL wire protocol v3 frontend in Rust. Validates that the PG
protocol is implementable end-to-end and that `psql` can connect and run CRUD.

## Run

```bash
cargo run
```

Listens on `127.0.0.1:5432`. In-memory storage by default.

To use RocksDB (requires CMake + C compiler):

```bash
cargo run --features rocksdb
```

## Test with psql

```bash
psql -h 127.0.0.1 -p 5432 -U postgres -d shardbase
```

Password: `postgres` (SCRAM-SHA-256) or any password (cleartext fallback).

### Expected session

```sql
CREATE TABLE t (id INT PRIMARY KEY, name TEXT);
-- CREATE TABLE

INSERT INTO t VALUES (1, 'alice');
-- INSERT 0 1

INSERT INTO t VALUES (2, 'bob');
-- INSERT 0 1

SELECT * FROM t;
--  id | name
-- ----+------
--   1 | alice
--   2 | bob
-- (2 rows)

SELECT * FROM t WHERE id = 1;
--  id | name
-- ----+------
--   1 | alice
-- (1 row)

SELECT 1;
-- ?column?
-- --------
--        1
-- (1 row)
```

## Architecture

```
src/
  main.rs          TCP listener, connection lifecycle, query dispatch
  wire/
    frame.rs       Byte-level framing (Int32/Int16/CString read/write)
    messages.rs    PG message encode/decode (Q, X, R, S, K, Z, T, D, C, E)
    auth.rs        Auth state machine: cleartext + SCRAM-SHA-256
  storage.rs       RowStore trait + MemoryStore + RocksStore (feature-gated)
  sql/
    exec.rs        sqlparser AST → RowStore operations
```

## Protocol details

- Wire protocol v3 (PG 7.4+), no TLS
- Simple Query protocol only (no extended query: Parse/Bind/Execute)
- SCRAM-SHA-256 authentication (SASL mechanism under auth code 10)
- `'p'` byte disambiguated by auth phase state
- `MAX_STARTUP_PACKET_LENGTH` = 10,000 bytes enforced
- BackendKeyData sent after AuthenticationOk (PID + random secret)

## Known limitations

- Single-connection only (no concurrency)
- No TLS (refuses with `'N'`)
- No extended query protocol (Parse/Bind/Describe/Execute/Sync/Close)
- No COPY protocol
- No transactions (autocommit)
- WHERE clause: `= ` on PK only
- Full table scan limited to PKs 0..999 (skeleton)
- Auth: hardcoded password `postgres`, skeleton salt
- No `pg_dump` support yet (requires catalog queries like `\d`)
