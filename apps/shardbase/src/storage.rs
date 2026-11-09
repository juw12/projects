//! Row storage layer for ShardBase.
//!
//! Two backends:
//! - `MemoryStore` (default) — in-memory HashMap, always available.
//! - `RocksStore` (feature `rocksdb`) — RocksDB-backed, requires C toolchain.
//!
//! Schema model:
//! - Catalog: `table_name → column definitions`
//! - Rows: `(table_name, pk_bytes) → row_bytes`
//!
//! Encoding: null-byte delimited UTF-8 for the skeleton.

use anyhow::{bail, Result};
use std::collections::HashMap;

/// A column definition in the catalog.
#[derive(Debug, Clone)]
pub struct ColumnDef {
    pub name: String,
    pub data_type: String, // "INT" or "TEXT"
    pub is_primary_key: bool,
}

/// A table schema.
#[derive(Debug, Clone)]
pub struct TableSchema {
    pub name: String,
    pub columns: Vec<ColumnDef>,
}

impl TableSchema {
    pub fn primary_key_col(&self) -> Option<&ColumnDef> {
        self.columns.iter().find(|c| c.is_primary_key)
    }
}

/// Storage backend trait.
pub trait RowStore: Send + Sync {
    fn create_table(&self, schema: &TableSchema) -> Result<()>;
    fn table_exists(&self, name: &str) -> bool;
    fn get_schema(&self, name: &str) -> Option<TableSchema>;
    fn list_tables(&self) -> Vec<String>;
    fn insert_row(&self, table: &str, pk: &str, row: &[String]) -> Result<()>;
    fn get_row(&self, table: &str, pk: &str) -> Option<Vec<String>>;
}

// ---------------------------------------------------------------------------
// In-memory backend (default)
// ---------------------------------------------------------------------------

pub struct MemoryStore {
    catalog: std::sync::Mutex<HashMap<String, TableSchema>>,
    rows: std::sync::Mutex<HashMap<String, HashMap<String, Vec<String>>>>,
}

impl MemoryStore {
    pub fn new() -> Self {
        Self {
            catalog: std::sync::Mutex::new(HashMap::new()),
            rows: std::sync::Mutex::new(HashMap::new()),
        }
    }
}

impl Default for MemoryStore {
    fn default() -> Self {
        Self::new()
    }
}

impl RowStore for MemoryStore {
    fn create_table(&self, schema: &TableSchema) -> Result<()> {
        let mut catalog = self.catalog.lock().unwrap();
        if catalog.contains_key(&schema.name) {
            bail!("table '{}' already exists", schema.name);
        }
        catalog.insert(schema.name.clone(), schema.clone());
        self.rows.lock().unwrap().insert(schema.name.clone(), HashMap::new());
        Ok(())
    }

    fn table_exists(&self, name: &str) -> bool {
        self.catalog.lock().unwrap().contains_key(name)
    }

    fn get_schema(&self, name: &str) -> Option<TableSchema> {
        self.catalog.lock().unwrap().get(name).cloned()
    }

    fn list_tables(&self) -> Vec<String> {
        self.catalog.lock().unwrap().keys().cloned().collect()
    }

    fn insert_row(&self, table: &str, pk: &str, row: &[String]) -> Result<()> {
        let mut tables = self.rows.lock().unwrap();
        let table_rows = tables
            .get_mut(table)
            .ok_or_else(|| anyhow::anyhow!("table '{}' not found", table))?;
        table_rows.insert(pk.to_string(), row.to_vec());
        Ok(())
    }

    fn get_row(&self, table: &str, pk: &str) -> Option<Vec<String>> {
        self.rows.lock().unwrap().get(table)?.get(pk).cloned()
    }
}

// ---------------------------------------------------------------------------
// RocksDB backend (feature-gated)
// ---------------------------------------------------------------------------

#[cfg(feature = "rocksdb")]
pub struct RocksStore {
    db: Arc<rocksdb::DB>,
}

#[cfg(feature = "rocksdb")]
impl RocksStore {
    pub fn open(path: &str) -> Result<Self> {
        let db = rocksdb::DB::open(path)?;
        Ok(Self { db: Arc::new(db) })
    }
}

#[cfg(feature = "rocksdb")]
impl RowStore for RocksStore {
    fn create_table(&self, schema: &TableSchema) -> Result<()> {
        let key = format!("catalog\0{}", schema.name);
        if self.db.get(key.as_bytes())?.is_some() {
            bail!("table '{}' already exists", schema.name);
        }
        let mut cols = Vec::new();
        for c in &schema.columns {
            cols.push(format!("{}:{}:{}", c.name, c.data_type, if c.is_primary_key { "PK" } else { "" }));
        }
        self.db.put(key.as_bytes(), cols.join("|").as_bytes())?;
        Ok(())
    }

    fn table_exists(&self, name: &str) -> bool {
        self.db.get(format!("catalog\0{}", name).as_bytes()).unwrap_or(None).is_some()
    }

    fn get_schema(&self, name: &str) -> Option<TableSchema> {
        let val = self.db.get(format!("catalog\0{}", name).as_bytes()).ok()?.ok()?;
        let s = String::from_utf8(val).ok()?;
        let columns = s
            .split('|')
            .filter(|c| !c.is_empty())
            .map(|c| {
                let parts: Vec<&str> = c.split(':').collect();
                ColumnDef {
                    name: parts[0].to_string(),
                    data_type: parts.get(1).copied().unwrap_or("TEXT").to_string(),
                    is_primary_key: parts.get(2).copied() == Some("PK"),
                }
            })
            .collect();
        Some(TableSchema { name: name.to_string(), columns })
    }

    fn list_tables(&self) -> Vec<String> {
        let mut tables = Vec::new();
        let iterator = self.db.iter(rocksdb::IteratorMode::Start);
        for kv in iterator {
            match kv {
                Ok((k, _)) => {
                    if let Some(rest) = String::from_utf8_lossy(&k).strip_prefix("catalog\0") {
                        tables.push(rest.to_string());
                    }
                }
                Err(_) => break,
            }
        }
        tables
    }

    fn insert_row(&self, table: &str, pk: &str, row: &[String]) -> Result<()> {
        let key = format!("row\0{}\0{}", table, pk);
        let val = row.join("\0");
        self.db.put(key.as_bytes(), val.as_bytes())?;
        Ok(())
    }

    fn get_row(&self, table: &str, pk: &str) -> Option<Vec<String>> {
        let key = format!("row\0{}\0{}", table, pk);
        self.db.get(key.as_bytes()).ok()?.ok().map(|v| {
            String::from_utf8_lossy(&v).split('\0').map(String::from).collect()
        })
    }
}

/// Convenience type alias for the default storage.
pub type DefaultStore = MemoryStore;
