/* --------------------------------------------- bank statement CSV (on-device) */
/** Minimal RFC 4180 CSV parser with delimiter sniffing (, ; tab) and BOM handling. */
function parseCsv(text) {
  const source = String(text || "").replace(/^\uFEFF/, "");
  const firstLine = source.split(/\r?\n/, 1)[0] || "";
  const delimiter = [",", ";", "\t"].map(d => [d, firstLine.split(d).length]).sort((x, y) => y[1] - x[1])[0][0];
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"' && source[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && source[i + 1] === "\n") i++;
      row.push(field);
      if (row.some(cell => cell.trim() !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  row.push(field);
  if (row.some(cell => cell.trim() !== "")) rows.push(row);
  return rows.map(r => r.map(cell => cell.trim()));
}

/** "1,234.56", "1.234,56", "(12.00)", "-€12", "12.00-", "45 CR" -> number (NaN if not a number). */
function parseAmount(raw) {
  let text = String(raw ?? "").trim();
  if (!text) return NaN;
  let sign = 1;
  if (/^\(.*\)$/.test(text)) {
    sign = -1;
    text = text.slice(1, -1);
  }
  if (/\b(DR|D)$/i.test(text)) sign = -1;
  text = text.replace(/\b(CR|DR|C|D)$/i, "").trim();
  if (/-$/.test(text)) {
    sign = -sign;
    text = text.slice(0, -1);
  }
  if (/^-/.test(text.replace(/[^\d.,-]/g, ""))) sign = -sign;
  text = text.replace(/[^\d.,]/g, "");
  if (!/\d/.test(text)) return NaN;
  const lastComma = text.lastIndexOf(",");
  const lastDot = text.lastIndexOf(".");
  if (lastComma > lastDot) {
    // comma is the decimal mark if exactly 1-2 digits follow it; otherwise it's a thousands separator
    text = /,\d{1,2}$/.test(text) ? text.replace(/\./g, "").replace(",", ".") : text.replace(/,/g, "");
  } else {
    text = text.replace(/,/g, "");
  }
  const value = Number(text);
  return Number.isFinite(value) ? sign * value : NaN;
}

const MONTH_NAMES = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
/** Parse one date cell; `dayFirst` resolves 03/04/2026. Returns "YYYY-MM-DD" or "". */
function parseStatementDate(raw, dayFirst = true) {
  const text = String(raw || "").trim();
  let m = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return isoParts(+m[1], +m[2], +m[3]);
  m = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (m) {
    const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return dayFirst ? isoParts(year, +m[2], +m[1]) : isoParts(year, +m[1], +m[2]);
  }
  m = text.match(/^(\d{1,2})[\s-]([A-Za-z]{3})[A-Za-z]*[\s-,]+(\d{2,4})/);
  if (m && MONTH_NAMES.includes(m[2].toLowerCase())) {
    const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return isoParts(year, MONTH_NAMES.indexOf(m[2].toLowerCase()) + 1, +m[1]);
  }
  m = text.match(/^([A-Za-z]{3})[A-Za-z]*\s+(\d{1,2}),?\s+(\d{4})/);
  if (m && MONTH_NAMES.includes(m[1].toLowerCase())) return isoParts(+m[3], MONTH_NAMES.indexOf(m[1].toLowerCase()) + 1, +m[2]);
  return "";
}
function isoParts(year, month, day) {
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1990 || year > 2100) return "";
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const DATE_HEADER = /date|datum|fecha|data|tanggal|日期|booked|posted|transaction/i;
const AMOUNT_HEADER = /amount|betrag|importe|montant|jumlah|value|sum|金额/i;
const DEBIT_HEADER = /debit|withdraw|paid out|money out|spent|outflow|ausgang|charge/i;
const CREDIT_HEADER = /credit|deposit|paid in|money in|received|inflow|eingang/i;

/**
 * Turn a bank-statement CSV into monthly income / spending / net. Runs only on this device;
 * transactions are never stored or uploaded — only the monthly totals are shown.
 */
function analyzeStatement(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) return { error: "That file doesn't look like a statement (fewer than 2 rows)." };
  const headerIndex = Math.max(0, rows.slice(0, 10).findIndex(r => r.some(c => DATE_HEADER.test(c)) && r.some(c => AMOUNT_HEADER.test(c) || DEBIT_HEADER.test(c) || CREDIT_HEADER.test(c))));
  const header = rows[headerIndex].map(c => c.toLowerCase());
  const body = rows.slice(headerIndex + 1);
  const columnCount = Math.max(...body.map(r => r.length));
  const share = (col, ok) => body.filter(r => ok(r[col] ?? "")).length / body.length;
  const looksLikeDate = cell => Boolean(parseStatementDate(cell, true) || parseStatementDate(cell, false));
  let dateCol = header.findIndex((h, i) => DATE_HEADER.test(h) && share(i, looksLikeDate) > 0.6);
  if (dateCol < 0) dateCol = [...Array(columnCount).keys()].find(col => share(col, looksLikeDate) > 0.6) ?? -1;
  if (dateCol < 0) return { error: "Couldn't find a date column." };
  const numeric = col => col >= 0 && col !== dateCol && share(col, c => c === "" || Number.isFinite(parseAmount(c))) > 0.8;
  let debitCol = header.findIndex((h, i) => DEBIT_HEADER.test(h) && numeric(i));
  let creditCol = header.findIndex((h, i) => CREDIT_HEADER.test(h) && numeric(i) && i !== debitCol);
  let amountCol = header.findIndex((h, i) => AMOUNT_HEADER.test(h) && numeric(i) && !/balance|saldo/i.test(h));
  if (amountCol < 0 && (debitCol < 0 || creditCol < 0)) {
    amountCol = [...Array(columnCount).keys()].reverse().find(col => numeric(col) && !/balance|saldo/i.test(header[col] || "")) ?? -1;
    if (debitCol >= 0 && creditCol < 0) amountCol = -1;
  }
  if (amountCol < 0 && (debitCol < 0 || creditCol < 0)) return { error: "Couldn't find an amount column (or debit/credit columns)." };
  // Day-first unless some date only makes sense month-first (e.g. 04/23/2026).
  const dayFirst = !body.some(r => {
    const m = String(r[dateCol] || "").match(/^(\d{1,2})[-/.](\d{1,2})[-/.]\d{2,4}/);
    return m && Number(m[2]) > 12;
  });
  const months = new Map();
  let used = 0;
  let skipped = 0;
  for (const r of body) {
    const date = parseStatementDate(r[dateCol], dayFirst);
    let value;
    if (amountCol >= 0 && (debitCol < 0 || creditCol < 0)) {
      value = parseAmount(r[amountCol]);
    } else {
      const credit = parseAmount(r[creditCol]);
      const debit = parseAmount(r[debitCol]);
      value = (Number.isFinite(credit) ? Math.abs(credit) : 0) - (Number.isFinite(debit) ? Math.abs(debit) : 0);
      if (!Number.isFinite(credit) && !Number.isFinite(debit)) value = NaN;
    }
    if (!date || !Number.isFinite(value)) {
      skipped++;
      continue;
    }
    used++;
    const key = date.slice(0, 7);
    const month = months.get(key) || { month: key, income: 0, spending: 0, net: 0, count: 0 };
    if (value >= 0) month.income += value;
    else month.spending += -value;
    month.net = month.income - month.spending;
    month.count++;
    months.set(key, month);
  }
  if (!used) return { error: "No rows with both a date and an amount." };
  const list = [...months.values()].sort((x, y) => x.month.localeCompare(y.month));
  const average = field => list.reduce((sum, m) => sum + m[field], 0) / list.length;
  return {
    months: list,
    avgIncome: average("income"),
    avgSpending: average("spending"),
    avgNet: average("net"),
    used,
    skipped,
    columns: { date: rows[headerIndex][dateCol], amount: amountCol >= 0 && (debitCol < 0 || creditCol < 0) ? rows[headerIndex][amountCol] : `${rows[headerIndex][creditCol]} − ${rows[headerIndex][debitCol]}` },
  };
}

/** Net-worth history CSV with columns like Date, Assets, Debts. Returns [{date, assets, debts}]. */
function parseNetWorthCsv(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const header = rows[0].map(c => c.toLowerCase());
  const dateCol = header.findIndex(h => DATE_HEADER.test(h));
  const assetsCol = header.findIndex(h => /asset|own|savings|vermögen|total/i.test(h));
  const debtsCol = header.findIndex(h => /debt|liabilit|owe|loan|schulden/i.test(h));
  if (dateCol < 0 || assetsCol < 0) return [];
  return rows.slice(1).map(r => ({
    date: parseStatementDate(r[dateCol]),
    assets: parseAmount(r[assetsCol]),
    debts: debtsCol >= 0 ? Math.abs(parseAmount(r[debtsCol]) || 0) : 0,
  })).filter(e => e.date && Number.isFinite(e.assets));
}

