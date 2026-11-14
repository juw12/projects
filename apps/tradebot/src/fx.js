// Rupiah. The owner thinks in rupiah, but every coin market prices in USDT, so the books stay in
// USDT and only the words change: amounts are shown in rupiah and typed amounts are read as rupiah.
//
// The rate is how many rupiah one USDT costs. It is read from Indodax (the USDT/IDR market in
// Indonesia), then CoinGecko, then the open.er-api.com dollar rate, kept for an hour, and the last
// good rate is kept if all three are down. Until a first rate arrives the bot simply talks in
// dollars, so a missing rate can never turn into a wrong amount.

export const FX_TTL_MS = 60 * 60 * 1000; // read the rate again after an hour
const TIMEOUT_MS = 8000;
const SANE = { min: 5000, max: 100000 }; // rupiah per USDT; anything outside is a broken answer

export const FX_SOURCES = [
  {
    name: "Indodax",
    url: "https://indodax.com/api/ticker/usdtidr",
    read: (body) => Number(body && body.ticker && body.ticker.last),
  },
  {
    name: "CoinGecko",
    url: "https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=idr",
    read: (body) => Number(body && body.tether && body.tether.idr),
  },
  {
    name: "open.er-api.com",
    url: "https://open.er-api.com/v6/latest/USD",
    read: (body) => Number(body && body.rates && body.rates.IDR),
  },
];

export function saneRate(rate) {
  return Number.isFinite(rate) && rate >= SANE.min && rate <= SANE.max;
}

// The first source that answers with a believable rate: { rate, source }. Throws if none does.
export async function fetchRate({ fetch, sources = FX_SOURCES }) {
  const problems = [];
  for (const source of sources) {
    try {
      const response = await fetch(source.url, {
        headers: { Accept: "application/json", "User-Agent": "TradeBot (+https://trade-bot.juw12.workers.dev)" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const rate = source.read(await response.json());
      if (!saneRate(rate)) throw new Error(`unbelievable rate ${rate}`);
      return { rate, source: source.name };
    } catch (error) {
      problems.push(`${source.name}: ${error && error.message ? error.message : error}`);
    }
  }
  throw new Error("no rupiah rate: " + problems.join("; "));
}

// Keeps state.fx fresh ({ rate, source, at }). Never throws: an old rate beats no rate.
export async function refreshRate(state, { fetch, now, force = false }) {
  const known = state.fx;
  if (!force && known && saneRate(known.rate) && now - known.at < FX_TTL_MS) return known;
  try {
    const { rate, source } = await fetchRate({ fetch });
    state.fx = { rate, source, at: now };
  } catch (error) {
    console.log(String(error && error.message ? error.message : error).slice(0, 300));
  }
  return state.fx || null;
}

export function rateOfState(state) {
  return state && state.fx && saneRate(state.fx.rate) ? state.fx.rate : null;
}

// Reads a typed amount: "500000", "500.000", "500rb", "1,5jt", "2 juta", "1m" (miliar), "$50".
// Returns { value, unit } with unit "idr" or "usd", or null when it is not a number.
export function readAmount(text) {
  let raw = String(text || "").trim().toLowerCase().replace(/\s+/g, "");
  if (!raw) return null;
  let unit = null;
  if (raw.startsWith("$") || raw.endsWith("usd") || raw.endsWith("usdt")) {
    unit = "usd";
    raw = raw.replace(/^\$/, "").replace(/usdt?$/, "");
  } else if (raw.startsWith("rp")) {
    unit = "idr";
    raw = raw.slice(2);
  }
  let factor = 1;
  const suffix = raw.match(/(rb|ribu|k|jt|juta|m|miliar)$/);
  if (suffix) {
    factor = { rb: 1e3, ribu: 1e3, k: 1e3, jt: 1e6, juta: 1e6, m: 1e9, miliar: 1e9 }[suffix[1]];
    raw = raw.slice(0, -suffix[1].length);
    unit = unit || "idr";
  }
  // Dots and commas: "500.000" and "1.000.000" are thousands; "1,5" is a decimal comma;
  // a single dot followed by 1 or 2 digits ("12.5") is a decimal point.
  let number;
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(raw)) number = Number(raw.replace(/\./g, "").replace(",", "."));
  else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(raw)) number = Number(raw.replace(/,/g, ""));
  else if (/^\d+,\d+$/.test(raw)) number = Number(raw.replace(",", "."));
  else if (/^\d+(\.\d+)?$/.test(raw)) number = Number(raw);
  else return null;
  if (!Number.isFinite(number)) return null;
  return { value: number * factor, unit };
}

// A typed amount in USDT. With a rate, a plain number is rupiah; "$" or "usdt" forces dollars.
// Without a rate everything is dollars, as before.
export function toUsdt(text, rate) {
  const amount = readAmount(text);
  if (!amount) return NaN;
  if (amount.unit === "usd" || !rate) {
    if (amount.unit === "idr" && !rate) return NaN; // rupiah typed, but no rate to convert with
    return amount.value;
  }
  return amount.value / rate;
}
