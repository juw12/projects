//! Simple SQL query executor.
//!
//! Parses SQL with `sqlparser` 0.63 and dispatches to the storage layer.
//! Supports: CREATE TABLE, INSERT, SELECT (literal, full table, WHERE on PK).

use anyhow::{bail, Result};
use sqlparser::ast::{
    BinaryOperator, ColumnOption, DataType, Expr, ObjectName, ObjectNamePart,
    Query, Select, SelectItem, SetExpr, Statement, TableFactor, TableObject, Value,
};
use sqlparser::dialect::GenericDialect;
use sqlparser::parser::Parser;

use crate::storage::{ColumnDef, RowStore, TableSchema};
use crate::wire::messages::ColumnInfo;

/// Result of executing a SQL statement.
pub enum QueryResult {
    Rows {
        columns: Vec<ColumnInfo>,
        rows: Vec<Vec<Option<String>>>,
        tag: String,
    },
    Command {
        tag: String,
    },
}

pub fn execute(sql: &str, store: &dyn RowStore) -> Result<QueryResult> {
    let dialect = GenericDialect {};
    let statements = Parser::parse_sql(&dialect, sql)
        .map_err(|e| anyhow::anyhow!("SQL parse error: {}", e))?;

    if statements.is_empty() {
        return Ok(QueryResult::Command { tag: String::new() });
    }

    match &statements[0] {
        Statement::CreateTable(ct) => exec_create_table(ct, store),
        Statement::Insert(ins) => exec_insert(ins, store),
        Statement::Query(q) => exec_select(q, store),
        other => bail!("unsupported statement: {}", stmt_kind_str(other)),
    }
}

fn stmt_kind_str(s: &Statement) -> &'static str {
    match s {
        Statement::CreateTable(_) => "CREATE TABLE",
        Statement::Insert(_) => "INSERT",
        Statement::Query(_) => "SELECT",
        _ => "UNKNOWN",
    }
}

// ---------------------------------------------------------------------------
// CREATE TABLE
// ---------------------------------------------------------------------------

fn exec_create_table(
    ct: &sqlparser::ast::CreateTable,
    store: &dyn RowStore,
) -> Result<QueryResult> {
    let table_name = obj_name_to_str(&ct.name);
    let mut columns = Vec::new();

    for col_def in &ct.columns {
        let col_name = col_def.name.value.clone();
        let type_str = data_type_to_str(&col_def.data_type);
        let is_pk = col_def
            .options
            .iter()
            .any(|opt| matches!(opt.option, ColumnOption::PrimaryKey(_)));
        columns.push(ColumnDef {
            name: col_name,
            data_type: type_str,
            is_primary_key: is_pk,
        });
    }

    // Check table-level constraints for PRIMARY KEY
    if columns.iter().all(|c| !c.is_primary_key) {
        if let Some(pk_col) = find_table_level_pk(ct) {
            if let Some(col) = columns.iter_mut().find(|c| c.name == pk_col) {
                col.is_primary_key = true;
            }
        }
    }

    let schema = TableSchema {
        name: table_name.clone(),
        columns,
    };
    store.create_table(&schema)?;
    Ok(QueryResult::Command { tag: "CREATE TABLE".into() })
}

fn find_table_level_pk(ct: &sqlparser::ast::CreateTable) -> Option<String> {
    use sqlparser::ast::TableConstraint;
    for constraint in &ct.constraints {
        if let TableConstraint::PrimaryKey(pk) = constraint {
            if let Some(first) = pk.columns.first() {
                if let Expr::Identifier(ident) = &first.column.expr {
                    return Some(ident.value.clone());
                }
            }
        }
    }
    None
}

// ---------------------------------------------------------------------------
// INSERT
// ---------------------------------------------------------------------------

fn exec_insert(
    ins: &sqlparser::ast::Insert,
    store: &dyn RowStore,
) -> Result<QueryResult> {
    // Extract table name from TableObject
    let table_name = match &ins.table {
        TableObject::TableName(name) => obj_name_to_str(name),
        _ => bail!("INSERT target must be a table name"),
    };

    if !store.table_exists(&table_name) {
        bail!("table '{}' does not exist", table_name);
    }
    let schema = store.get_schema(&table_name).unwrap();

    // Extract VALUES from the source query (Option<Box<Query>>)
    let source = ins
        .source
        .as_ref()
        .ok_or_else(|| anyhow::anyhow!("INSERT requires a source (VALUES clause)"))?;
    let values_rows = extract_values(source)?;
    if values_rows.is_empty() {
        bail!("INSERT requires at least one VALUES row");
    }

    for row_vals in &values_rows {
        let mut full_row: Vec<String> = Vec::new();

        if ins.columns.is_empty() {
            // Values are in schema column order
            for (i, col) in schema.columns.iter().enumerate() {
                if let Some(v) = row_vals.get(i) {
                    full_row.push(expr_to_string(v, &col.data_type)?);
                } else {
                    full_row.push(String::new());
                }
            }
        } else {
            // Explicit column list: ins.columns is Vec<ObjectName>
            let named: Vec<(String, &Expr)> = ins.columns
                .iter()
                .enumerate()
                .filter_map(|(i, col_name)| {
                    row_vals.get(i).map(|v| (obj_name_to_str(col_name), v))
                })
                .collect();
            for col in &schema.columns {
                if let Some((_, v)) = named.iter().find(|(n, _)| n == &col.name) {
                    full_row.push(expr_to_string(v, &col.data_type)?);
                } else {
                    full_row.push(String::new());
                }
            }
        }

        let pk_idx = schema
            .primary_key_col()
            .and_then(|pk| schema.columns.iter().position(|c| c.name == pk.name));
        let pk_val = pk_idx
            .and_then(|i| full_row.get(i).cloned())
            .ok_or_else(|| anyhow::anyhow!("table '{}' has no primary key", table_name))?;

        store.insert_row(&table_name, &pk_val, &full_row)?;
    }

    let n = values_rows.len();
    Ok(QueryResult::Command { tag: format!("INSERT 0 {}", n) })
}

fn extract_values(source: &Query) -> Result<Vec<Vec<Expr>>> {
    match source.body.as_ref() {
        SetExpr::Values(vals) => {
            // vals.rows is Vec<Parens<Vec<Expr>>>, each Parens has .content
            Ok(vals.rows.iter().map(|p| p.content.clone()).collect())
        }
        _ => bail!("INSERT source must be a VALUES clause"),
    }
}

// ---------------------------------------------------------------------------
// SELECT
// ---------------------------------------------------------------------------

fn exec_select(query: &Query, store: &dyn RowStore) -> Result<QueryResult> {
    let select = match query.body.as_ref() {
        SetExpr::Select(s) => s,
        _ => bail!("unsupported SELECT form"),
    };

    if select.from.is_empty() {
        return exec_select_literal(select, store);
    }
    exec_select_from(select, store)
}

fn exec_select_literal(select: &Select, _store: &dyn RowStore) -> Result<QueryResult> {
    let mut columns = Vec::new();
    let mut row: Vec<Option<String>> = Vec::new();

    for item in &select.projection {
        match item {
            SelectItem::UnnamedExpr(expr) => {
                let val = expr_to_string(expr, "INT")?;
                columns.push(ColumnInfo {
                    name: "?column?".into(),
                    type_oid: 23,
                    type_size: 4,
                });
                row.push(Some(val));
            }
            _ => bail!("unsupported projection in literal SELECT"),
        }
    }

    let count = row.len();
    Ok(QueryResult::Rows {
        columns,
        rows: vec![row],
        tag: format!("SELECT {}", count),
    })
}

fn exec_select_from(select: &Select, store: &dyn RowStore) -> Result<QueryResult> {
    let table_name = extract_table_name(&select.from)?;

    if !store.table_exists(&table_name) {
        bail!("table '{}' does not exist", table_name);
    }
    let schema = store.get_schema(&table_name).unwrap();

    let all_columns = &schema.columns;
    let projected: Vec<usize> = if select.projection.len() == 1
        && matches!(select.projection[0], SelectItem::Wildcard(_))
    {
        (0..all_columns.len()).collect()
    } else {
        let mut idxs = Vec::new();
        for item in &select.projection {
            if let SelectItem::UnnamedExpr(Expr::Identifier(ident)) = item {
                match all_columns.iter().position(|c| c.name == ident.value) {
                    Some(i) => idxs.push(i),
                    None => bail!("column '{}' not found in table '{}'", ident.value, table_name),
                }
            } else {
                bail!("unsupported projection in SELECT FROM");
            }
        }
        idxs
    };

    let pk_filter: Option<String> = if let Some(where_expr) = &select.selection {
        extract_pk_filter(where_expr, &schema)?
    } else {
        None
    };

    let col_info: Vec<ColumnInfo> = projected
        .iter()
        .map(|&i| {
            let c = &all_columns[i];
            ColumnInfo {
                name: c.name.clone(),
                type_oid: type_to_oid(&c.data_type),
                type_size: type_to_size(&c.data_type),
            }
        })
        .collect();

    let mut rows: Vec<Vec<Option<String>>> = Vec::new();
    match &pk_filter {
        Some(pk_val) => {
            if let Some(row_data) = store.get_row(&table_name, pk_val) {
                let projected_row: Vec<Option<String>> =
                    projected.iter().map(|&i| row_data.get(i).cloned()).collect();
                rows.push(projected_row);
            }
        }
        None => {
            for pk in 0..1000 {
                let pk_str = pk.to_string();
                if let Some(row_data) = store.get_row(&table_name, &pk_str) {
                    let projected_row: Vec<Option<String>> =
                        projected.iter().map(|&i| row_data.get(i).cloned()).collect();
                    rows.push(projected_row);
                }
            }
        }
    }

    let count = rows.len();
    Ok(QueryResult::Rows {
        columns: col_info,
        rows,
        tag: format!("SELECT {}", count),
    })
}

fn extract_table_name(from: &[sqlparser::ast::TableWithJoins]) -> Result<String> {
    if from.len() != 1 {
        bail!("JOIN not supported in skeleton");
    }
    match &from[0].relation {
        TableFactor::Table { name, .. } => Ok(obj_name_to_str(name)),
        _ => bail!("unsupported FROM clause"),
    }
}

fn extract_pk_filter(expr: &Expr, schema: &TableSchema) -> Result<Option<String>> {
    let pk_col = schema
        .primary_key_col()
        .ok_or_else(|| anyhow::anyhow!("table has no primary key"))?
        .name
        .clone();

    match expr {
        Expr::BinaryOp { left, op, right } => {
            if *op != BinaryOperator::Eq {
                bail!("only '=' is supported in WHERE (skeleton)");
            }
            let col_name = if let Expr::Identifier(ident) = left.as_ref() {
                ident.value.clone()
            } else {
                bail!("WHERE must be 'column = value'");
            };
            if col_name != pk_col {
                bail!("WHERE can only filter on primary key '{}' (skeleton)", pk_col);
            }
            let val = expr_to_string(right, "INT")?;
            Ok(Some(val))
        }
        _ => bail!("unsupported WHERE expression"),
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn obj_name_to_str(name: &ObjectName) -> String {
    name.0.last()
        .and_then(|part| match part {
            ObjectNamePart::Identifier(ident) => Some(ident.value.clone()),
            _ => None,
        })
        .unwrap_or_default()
}

fn data_type_to_str(dt: &DataType) -> String {
    match dt {
        DataType::Int(_) | DataType::Integer(_) => "INT".into(),
        DataType::BigInt(_) => "INT8".into(),
        DataType::SmallInt(_) => "INT2".into(),
        DataType::Text => "TEXT".into(),
        DataType::Varchar(_) => "TEXT".into(),
        DataType::Float(_) => "FLOAT8".into(),
        DataType::Double { .. } => "FLOAT8".into(),
        DataType::Boolean => "BOOL".into(),
        other => format!("{:?}", other),
    }
}

fn type_to_oid(ty: &str) -> i32 {
    match ty {
        "INT" | "INT4" => 23,
        "INT8" => 20,
        "INT2" => 21,
        "TEXT" => 25,
        "FLOAT8" => 701,
        "BOOL" => 16,
        _ => 25,
    }
}

fn type_to_size(ty: &str) -> i16 {
    match ty {
        "INT" | "INT4" => 4,
        "INT8" => 8,
        "INT2" => 2,
        "FLOAT8" => 8,
        "BOOL" => 1,
        _ => -1,
    }
}

fn expr_to_string(expr: &Expr, _expected_type: &str) -> Result<String> {
    match expr {
        Expr::Value(vws) => {
            let v = &vws.value;
            match v {
                Value::Number(s, _) => Ok(s.clone()),
                Value::SingleQuotedString(s) => Ok(s.clone()),
                Value::EscapedStringLiteral(s) => Ok(s.clone()),
                Value::UnicodeStringLiteral(s) => Ok(s.clone()),
                Value::SingleQuotedByteStringLiteral(s) => Ok(s.clone()),
                other => bail!("unsupported value: {:?}", other),
            }
        }
        Expr::Identifier(ident) => Ok(ident.value.clone()),
        Expr::UnaryOp { op, expr: inner } => {
            let inner_str = expr_to_string(inner, _expected_type)?;
            match op {
                sqlparser::ast::UnaryOperator::Minus => {
                    if let Ok(n) = inner_str.parse::<i64>() {
                        Ok((-n).to_string())
                    } else {
                        Ok(format!("-{}", inner_str))
                    }
                }
                _ => Ok(inner_str),
            }
        }
        _ => bail!("unsupported expression in value position"),
    }
}
