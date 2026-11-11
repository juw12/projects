// GlowHarness kit: the tools and the brains that plug into glow-harness.js.
//
// Tools (each one exists because language models are unreliable at exactly that thing):
//   calc     exact arithmetic on big integers and fractions, written here from scratch (no eval)
//   text     letter-by-letter work: count, length, words, reverse
//   clock    today's date and exact date arithmetic (a model has no clock)
//   units    unit conversion with exact factors
//   notes    memory between conversations, kept on this device
//   library  the offline library packs Glow already ships (GlowLibrary)
//   tale     GlowSpark, Glow's own tiny story model, used as a tool
//
// Brains:
//   rulesBrain()  no model at all: pattern rules that speak the same TOOL / FINAL protocol. Offline, instant,
//                 English only, and it knows no facts. It exists so the harness works with nothing downloaded.
//   chatBrain()   a free hosted model, with failover between providers.
//
//   const tools = GlowHarnessKit.createTools({ now: () => Date.now(), storage: localStorage });
//   const harness = GlowHarness.createHarness({ brain: GlowHarnessKit.rulesBrain(), tools, confirm });
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module && module.exports) module.exports = api;
  else root.GlowHarnessKit = api;
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";

  const NOTES_KEY = "glow.harness.notes.v1";
  const TEN = 10n;
  const messageOf = (error) => String((error && error.message) || error || "unknown error");

  // ================================================================ exact numbers
  // A value is either an exact fraction { n, d } of BigInts or an approximation { x } (a double).
  const absBig = (value) => (value < 0n ? -value : value);
  function gcdBig(a, b) {
    a = absBig(a);
    b = absBig(b);
    while (b) [a, b] = [b, a % b];
    return a;
  }
  function rat(n, d) {
    if (d === 0n) throw new Error("division by zero");
    if (d < 0n) {
      n = -n;
      d = -d;
    }
    const g = gcdBig(n, d) || 1n;
    return { n: n / g, d: d / g };
  }
  const whole = (value) => rat(BigInt(value), 1n);
  const isExact = (value) => value.x === undefined;
  function approx(x) {
    if (!Number.isFinite(x)) throw new Error("the result is not a finite number");
    return { x };
  }
  function toNumber(value) {
    if (!isExact(value)) return value.x;
    const quotient = value.n / value.d;
    const rest = value.n - quotient * value.d;
    return Number(quotient) + Number((rest * 1000000000000000000n) / value.d) / 1e18;
  }
  function parseDecimal(text) {
    const match = /^(\d*)(?:\.(\d*))?(?:[eE]([-+]?\d+))?$/.exec(text);
    if (!match || !(match[1] || match[2])) throw new Error(`"${text}" is not a number`);
    const fraction = match[2] || "";
    const exponent = (match[3] ? parseInt(match[3], 10) : 0) - fraction.length;
    if (Math.abs(exponent) > 4000) throw new Error("that number is out of range");
    const digits = BigInt((match[1] || "") + fraction || "0");
    return exponent >= 0 ? rat(digits * TEN ** BigInt(exponent), 1n) : rat(digits, TEN ** BigInt(-exponent));
  }
  // "0.0254", "5/18" or "1609.344" -> exact fraction
  function parseFactor(text) {
    const parts = text.split("/");
    return parts.length === 2 ? divide(parseDecimal(parts[0]), parseDecimal(parts[1])) : parseDecimal(text);
  }

  const both = (a, b) => isExact(a) && isExact(b);
  const plus = (a, b) => (both(a, b) ? rat(a.n * b.d + b.n * a.d, a.d * b.d) : approx(toNumber(a) + toNumber(b)));
  const minus = (a, b) => (both(a, b) ? rat(a.n * b.d - b.n * a.d, a.d * b.d) : approx(toNumber(a) - toNumber(b)));
  const times = (a, b) => (both(a, b) ? rat(a.n * b.n, a.d * b.d) : approx(toNumber(a) * toNumber(b)));
  function divide(a, b) {
    if (both(a, b)) return rat(a.n * b.d, a.d * b.n);
    if (toNumber(b) === 0) throw new Error("division by zero");
    return approx(toNumber(a) / toNumber(b));
  }
  const negate = (a) => (isExact(a) ? { n: -a.n, d: a.d } : approx(-a.x));
  const compare = (a, b) => (both(a, b) ? (a.n * b.d < b.n * a.d ? -1 : a.n * b.d > b.n * a.d ? 1 : 0) : Math.sign(toNumber(a) - toNumber(b)));
  function floorOf(a) {
    if (!isExact(a)) return approx(Math.floor(a.x));
    const quotient = a.n / a.d;
    return whole(a.n < 0n && quotient * a.d !== a.n ? quotient - 1n : quotient);
  }
  const ceilOf = (a) => negate(floorOf(negate(a)));
  function roundTo(a, places) {
    if (!isExact(a)) {
      const scale = Math.pow(10, places);
      return approx(Math.round(a.x * scale) / scale);
    }
    if (Math.abs(places) > 1000) throw new Error("too many decimal places");
    const scale = places >= 0 ? whole(TEN ** BigInt(places)) : rat(1n, TEN ** BigInt(-places));
    const scaled = times(a, scale);
    const magnitude = (2n * absBig(scaled.n) + scaled.d) / (2n * scaled.d); // half rounds away from zero
    return divide(whole(scaled.n < 0n ? -magnitude : magnitude), scale);
  }
  function integerOf(a, what) {
    if (!isExact(a) || a.d !== 1n) throw new Error(`${what} needs a whole number`);
    return a.n;
  }
  // floor of the k-th root of a non-negative BigInt, by Newton's method
  function iroot(value, k) {
    if (value < 2n) return value;
    const order = BigInt(k);
    let x = 1n << BigInt(Math.ceil(value.toString(2).length / k));
    for (;;) {
      const y = ((order - 1n) * x + value / x ** (order - 1n)) / order;
      if (y >= x) return x;
      x = y;
    }
  }
  function rootOf(a, k) {
    if (isExact(a)) {
      if (a.n < 0n && k % 2 === 0) throw new Error("that root of a negative number is not a real number");
      const top = iroot(absBig(a.n), k);
      const bottom = iroot(a.d, k);
      if (top ** BigInt(k) === absBig(a.n) && bottom ** BigInt(k) === a.d) return rat(a.n < 0n ? -top : top, bottom);
    }
    const x = toNumber(a);
    if (x < 0 && k % 2 === 0) throw new Error("that root of a negative number is not a real number");
    return approx(x < 0 ? -Math.pow(-x, 1 / k) : Math.pow(x, 1 / k));
  }
  function power(base, exponent) {
    if (both(base, exponent) && exponent.d === 1n) {
      const size = absBig(exponent.n);
      if (base.d === 1n && absBig(base.n) <= 1n) {
        if (base.n === 0n && exponent.n < 0n) throw new Error("division by zero");
        return whole(base.n === -1n && size % 2n === 1n ? -1n : base.n === 0n && size !== 0n ? 0n : 1n);
      }
      const digits = Math.max(base.n.toString().length, base.d.toString().length);
      if (size > 100000n || Number(size) * digits > 20000) throw new Error("that power is too large to work out exactly (over 20,000 digits)");
      return exponent.n >= 0n ? rat(base.n ** size, base.d ** size) : rat(base.d ** size, base.n ** size);
    }
    if (both(base, exponent) && exponent.d === 2n && base.n >= 0n) {
      const root = rootOf(base, 2);
      if (isExact(root)) return power(root, whole(exponent.n));
    }
    const value = Math.pow(toNumber(base), toNumber(exponent));
    if (Number.isNaN(value)) throw new Error("that power is not a real number");
    return approx(value);
  }
  function factorial(a) {
    const n = integerOf(a, "factorial");
    if (n < 0n || n > 1000n) throw new Error("factorial works for whole numbers from 0 to 1000");
    let product = 1n;
    for (let i = 2n; i <= n; i++) product *= i;
    return whole(product);
  }
  function modulo(a, b) {
    if (compare(b, whole(0)) === 0) throw new Error("division by zero");
    return minus(a, times(b, floorOf(divide(a, b))));
  }
  const float1 = (fn) => (a) => approx(fn(toNumber(a)));
  function logOf(a, base) {
    const x = toNumber(a);
    if (x <= 0) throw new Error("a logarithm needs a positive number");
    return approx(base ? Math.log(x) / Math.log(toNumber(base)) : Math.log10(x));
  }
  const FUNCTIONS = {
    sqrt: (a) => rootOf(a, 2),
    cbrt: (a) => rootOf(a, 3),
    abs: (a) => (compare(a, whole(0)) < 0 ? negate(a) : a),
    round: (a, places) => roundTo(a, places ? Number(integerOf(places, "round")) : 0),
    floor: floorOf,
    ceil: ceilOf,
    trunc: (a) => (compare(a, whole(0)) < 0 ? ceilOf(a) : floorOf(a)),
    min: (...list) => list.reduce((best, value) => (compare(value, best) < 0 ? value : best)),
    max: (...list) => list.reduce((best, value) => (compare(value, best) > 0 ? value : best)),
    gcd: (...list) => whole(list.map((value) => integerOf(value, "gcd")).reduce(gcdBig)),
    lcm: (...list) => whole(list.map((value) => integerOf(value, "lcm")).reduce((a, b) => (a === 0n || b === 0n ? 0n : absBig(a * b) / gcdBig(a, b)))),
    mod: modulo,
    pow: power,
    fact: factorial,
    factorial,
    sin: float1(Math.sin),
    cos: float1(Math.cos),
    tan: float1(Math.tan),
    asin: float1(Math.asin),
    acos: float1(Math.acos),
    atan: float1(Math.atan),
    exp: float1(Math.exp),
    ln: (a) => logOf(a, { x: Math.E }),
    log: logOf,
    log10: (a) => logOf(a),
    log2: (a) => logOf(a, whole(2)),
  };
  const CONSTANTS = { pi: Math.PI, e: Math.E, tau: 2 * Math.PI };

  // Words and symbols people (and models) write, turned into operators.
  function normaliseExpression(source) {
    let text = String(source).trim();
    text = text
      .replace(/[\u2212\u2013\u2014]/g, "-")
      .replace(/[\u00d7\u22c5\u00b7\u2217]/g, "*")
      .replace(/\u00f7/g, "/")
      .replace(/\u221a/g, "sqrt ")
      .replace(/\u03c0/g, "pi")
      .replace(/\u00b2/g, "^2")
      .replace(/\u00b3/g, "^3");
    text = text.replace(/[=?]+\s*$/, "").replace(/^[`$\s]+|[`$\s]+$/g, "");
    const words = [
      [/\b(?:multiplied by|times)\b/gi, "*"],
      [/\bdivided by\b/gi, "/"],
      [/\bplus\b/gi, "+"],
      [/\bminus\b/gi, "-"],
      [/\b(?:raised )?to the power(?: of)?\b/gi, "^"],
      [/\bto the (\d+)(?:st|nd|rd|th) power\b/gi, "^$1"],
      [/\bsquared\b/gi, "^2"],
      [/\bcubed\b/gi, "^3"],
      [/\b(?:the )?square root of\b/gi, "sqrt "],
      [/\b(?:the )?cube root of\b/gi, "cbrt "],
      [/\bpercent\b/gi, "%"],
      [/\bmodulo\b/gi, " mod "],
    ];
    for (const [pattern, to] of words) text = text.replace(pattern, to);
    return text.replace(/(\d)\s*x\s*(?=\d)/gi, "$1 * ").replace(/\s+/g, " ").trim();
  }

  function evaluate(source) {
    const text = normaliseExpression(source);
    if (!text) throw new Error("the expression is empty");
    if (text.length > 400) throw new Error("the expression is too long");
    let pos = 0;
    let inArguments = false; // inside f(a, b) a comma separates arguments, so "2,480" is not one number there
    const skip = () => {
      while (text[pos] === " ") pos++;
      return text[pos];
    };
    const unexpected = () => new Error(pos >= text.length ? "the expression ends too early" : `did not expect "${text.slice(pos, pos + 12).trim()}"`);
    const wordAt = () => {
      const match = /^[A-Za-z_]+(?:10|2)?(?![A-Za-z])/.exec(text.slice(pos));
      return match ? match[0] : "";
    };

    function number() {
      const rest = text.slice(pos);
      let match = inArguments ? null : /^\d{1,3}(?:,\d{3})+(?![\d,])(?:\.\d+)?/.exec(rest);
      if (!match) match = /^(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/.exec(rest);
      if (!match) throw unexpected();
      pos += match[0].length;
      return parseDecimal(match[0].replace(/,/g, ""));
    }
    function primary() {
      const ch = skip();
      if (ch === "(") {
        pos++;
        const saved = inArguments;
        inArguments = false;
        const value = expression();
        inArguments = saved;
        if (skip() === ")") pos++;
        else if (pos < text.length) throw unexpected();
        return value;
      }
      if (ch !== undefined && /[\d.]/.test(ch)) return number();
      const name = wordAt();
      if (!name) throw unexpected();
      const key = name.toLowerCase();
      if (key in CONSTANTS) {
        pos += name.length;
        return approx(CONSTANTS[key]);
      }
      const fn = FUNCTIONS[key];
      if (!fn) throw new Error(`"${name}" is not a number or a function I know`);
      pos += name.length;
      let list;
      if (skip() === "(") {
        pos++;
        const saved = inArguments;
        inArguments = true;
        list = [];
        if (skip() === ")") pos++;
        else {
          for (;;) {
            list.push(expression());
            const next = skip();
            if (next === "," || next === ";") pos++;
            else if (next === ")") {
              pos++;
              break;
            } else if (next === undefined) break;
            else throw unexpected();
          }
        }
        inArguments = saved;
      } else {
        list = [unary()];
      }
      if (!list.length) throw new Error(`${key} needs a value`);
      if (fn.length && list.length > Math.max(fn.length, 2)) throw new Error(`${key} got too many values`);
      return fn(...list);
    }
    function postfix() {
      let value = primary();
      for (;;) {
        const ch = skip();
        if (ch === "!" && text[pos + 1] !== "=") {
          pos++;
          value = factorial(value);
        } else if (ch === "%") {
          // "10 % 3" is a remainder; "17.5% of 2480" and "50%" are percentages
          let next = pos + 1;
          while (text[next] === " ") next++;
          if (next < text.length && /[\d(.]/.test(text[next])) return value;
          pos++;
          value = divide(value, whole(100));
        } else {
          return value;
        }
      }
    }
    function powerLevel() {
      const base = postfix();
      skip();
      if (text.startsWith("**", pos)) {
        pos += 2;
        return power(base, unary());
      }
      if (text[pos] === "^") {
        pos++;
        return power(base, unary());
      }
      return base;
    }
    function unary() {
      const ch = skip();
      if (ch === "-") {
        pos++;
        return negate(unary());
      }
      if (ch === "+") {
        pos++;
        return unary();
      }
      return powerLevel();
    }
    function term() {
      let left = unary();
      for (;;) {
        const ch = skip();
        if (ch === "*") {
          pos++;
          left = times(left, unary());
        } else if (ch === "/") {
          pos++;
          left = divide(left, unary());
        } else if (ch === "%") {
          pos++;
          left = modulo(left, unary());
        } else if (ch === "(") {
          left = times(left, unary());
        } else if (ch !== undefined && /[A-Za-z]/.test(ch)) {
          const name = wordAt().toLowerCase();
          if (name === "mod") {
            pos += 3;
            left = modulo(left, unary());
          } else if (name === "of" || name === "x") {
            pos += name.length;
            left = times(left, unary());
          } else if (name in CONSTANTS || name in FUNCTIONS) {
            left = times(left, unary());
          } else {
            throw new Error(`"${wordAt() || text.slice(pos, pos + 12)}" is not something I can calculate with`);
          }
        } else {
          return left;
        }
      }
    }
    function expression() {
      let left = term();
      for (;;) {
        const ch = skip();
        if (ch === "+") {
          pos++;
          left = plus(left, term());
        } else if (ch === "-") {
          pos++;
          left = minus(left, term());
        } else {
          return left;
        }
      }
    }

    const value = expression();
    skip();
    if (pos < text.length) throw unexpected();
    return { value, text };
  }

  // The decimal expansion of an exact fraction, rounded half-up at `places` places.
  function decimalString(value, places) {
    const scale = TEN ** BigInt(places);
    const magnitude = (2n * absBig(value.n) * scale + value.d) / (2n * value.d);
    const digits = magnitude.toString().padStart(places + 1, "0");
    const head = digits.slice(0, digits.length - places);
    const tail = places ? digits.slice(digits.length - places).replace(/0+$/, "") : "";
    const text = tail ? `${head}.${tail}` : head;
    return (value.n < 0n && /[1-9]/.test(text) ? "-" : "") + text;
  }
  function terminatingPlaces(denominator) {
    let d = denominator;
    let twos = 0;
    let fives = 0;
    while (d % 2n === 0n) {
      d /= 2n;
      twos++;
    }
    while (d % 5n === 0n) {
      d /= 5n;
      fives++;
    }
    return d === 1n ? Math.max(twos, fives) : -1;
  }
  // { text, exact, fraction } for a value: whole digits, an exact decimal, or a rounded one.
  function show(value, exactLimit, roundPlaces) {
    if (!isExact(value)) return { text: String(Number(value.x.toPrecision(12))), exact: false, fraction: "" };
    if (value.d === 1n) return { text: value.n.toString(), exact: true, fraction: "" };
    const places = terminatingPlaces(value.d);
    if (places >= 0 && places <= exactLimit) return { text: decimalString(value, places), exact: true, fraction: "" };
    return { text: decimalString(value, roundPlaces), exact: false, fraction: `${value.n}/${value.d}` };
  }

  function calc(expression) {
    const { value, text } = evaluate(expression);
    const shown = show(value, 30, 12);
    if (shown.exact) return { text: `${text} = ${shown.text}`, value: shown.text, exact: true };
    const detail = shown.fraction ? (shown.fraction.length <= 60 ? `exactly ${shown.fraction}` : "rounded to 12 decimal places") : "approximate";
    return { text: `${text} \u2248 ${shown.text} (${detail})`, value: shown.text, exact: false };
  }

  // ================================================================ dates
  const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
  const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const pad2 = (value) => String(value).padStart(2, "0");
  // Days since 1970-01-01 in the proleptic Gregorian calendar, and back (pure integer maths, no Date object).
  function daysFromCivil(year, month, day) {
    const y = month <= 2 ? year - 1 : year;
    const era = Math.floor(y / 400);
    const yearOfEra = y - era * 400;
    const dayOfYear = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
    const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
    return era * 146097 + dayOfEra - 719468;
  }
  function civilFromDays(days) {
    const z = days + 719468;
    const era = Math.floor(z / 146097);
    const dayOfEra = z - era * 146097;
    const yearOfEra = Math.floor((dayOfEra - Math.floor(dayOfEra / 1460) + Math.floor(dayOfEra / 36524) - Math.floor(dayOfEra / 146096)) / 365);
    const dayOfYear = dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
    const mp = Math.floor((5 * dayOfYear + 2) / 153);
    const day = dayOfYear - Math.floor((153 * mp + 2) / 5) + 1;
    const month = mp < 10 ? mp + 3 : mp - 9;
    return { year: yearOfEra + era * 400 + (month <= 2 ? 1 : 0), month, day };
  }
  const isLeap = (year) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const daysInMonth = (year, month) => [31, isLeap(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  const weekdayOf = (days) => WEEKDAYS[(((days + 4) % 7) + 7) % 7];
  function isoOf(days) {
    const { year, month, day } = civilFromDays(days);
    return `${String(year).padStart(4, "0")}-${pad2(month)}-${pad2(day)}`;
  }
  const monthIndex = (word) => MONTHS.findIndex((name) => name === word || (word.length >= 3 && name.startsWith(word) && (word.length === 3 || word === "sept")));

  // The local calendar day and wall time for an injected clock. offsetMinutes is east of UTC (Batam is +420).
  function localNow(env) {
    const ms = env && typeof env.now === "function" ? env.now() : Date.now();
    const offset = env && typeof env.offsetMinutes === "number" ? env.offsetMinutes : -new Date(ms).getTimezoneOffset();
    const local = new Date(ms + offset * 60000);
    const sign = offset < 0 ? "-" : "+";
    return {
      days: daysFromCivil(local.getUTCFullYear(), local.getUTCMonth() + 1, local.getUTCDate()),
      time: `${pad2(local.getUTCHours())}:${pad2(local.getUTCMinutes())}`,
      zone: `UTC${sign}${pad2(Math.floor(Math.abs(offset) / 60))}:${pad2(Math.abs(offset) % 60)}`,
    };
  }

  // Reads a date a person might type. Ambiguous all-number dates are refused instead of guessed.
  function parseDate(input, todayDays) {
    let text = String(input === undefined || input === null ? "" : input).trim().toLowerCase();
    text = text
      .replace(/\b(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday),?\s+/g, "")
      .replace(/(\d)(?:st|nd|rd|th)\b/g, "$1")
      .replace(/\b(?:the|of)\s+/g, "")
      .replace(/[,.]+(?=\s|$)/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!text || text === "today" || text === "now") return todayDays;
    if (text === "tomorrow") return todayDays + 1;
    if (text === "yesterday") return todayDays - 1;
    const build = (year, month, day) => {
      if (!(month >= 1 && month <= 12) || !(day >= 1 && day <= daysInMonth(year, month)) || year < 1 || year > 9999) {
        throw new Error(`"${input}" is not a real calendar date`);
      }
      return daysFromCivil(year, month, day);
    };
    let match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[t ].*)?$/.exec(text);
    if (match) return build(Number(match[1]), Number(match[2]), Number(match[3]));
    match = /^(\d{1,2}) ([a-z]+)(?: (\d{4}))?$/.exec(text);
    if (match && monthIndex(match[2]) >= 0) return build(match[3] ? Number(match[3]) : civilFromDays(todayDays).year, monthIndex(match[2]) + 1, Number(match[1]));
    match = /^([a-z]+) (\d{1,2})(?: (\d{4}))?$/.exec(text);
    if (match && monthIndex(match[1]) >= 0) return build(match[3] ? Number(match[3]) : civilFromDays(todayDays).year, monthIndex(match[1]) + 1, Number(match[2]));
    match = /^([a-z]+) (\d{4})$/.exec(text);
    if (match && monthIndex(match[1]) >= 0) return build(Number(match[2]), monthIndex(match[1]) + 1, 1);
    match = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(text);
    if (match) {
      const first = Number(match[1]);
      const second = Number(match[2]);
      if (first > 12 && second <= 12) return build(Number(match[3]), second, first);
      if (second > 12 && first <= 12) return build(Number(match[3]), first, second);
      if (first === second) return build(Number(match[3]), first, second);
      throw new Error(`"${input}" could be day/month or month/day. Write it as YYYY-MM-DD`);
    }
    throw new Error(`I cannot read "${input}" as a date. Use YYYY-MM-DD, or a form like 15 March 2031`);
  }

  function addToDate(days, amount, unit) {
    if (unit === "days") return days + amount;
    if (unit === "weeks") return days + amount * 7;
    const date = civilFromDays(days);
    const months = date.year * 12 + (date.month - 1) + (unit === "years" ? amount * 12 : amount);
    const year = Math.floor(months / 12);
    const month = months - year * 12 + 1;
    return daysFromCivil(year, month, Math.min(date.day, daysInMonth(year, month)));
  }

  // ================================================================ units
  const UNIT_TABLE = [
    ["length", "m", "1", "m|meter|metre"],
    ["length", "km", "1000", "km|kilometer|kilometre"],
    ["length", "cm", "0.01", "cm|centimeter|centimetre"],
    ["length", "mm", "0.001", "mm|millimeter|millimetre"],
    ["length", "in", "0.0254", 'in|inch|inches|"'],
    ["length", "ft", "0.3048", "ft|foot|feet|'"],
    ["length", "yd", "0.9144", "yd|yard"],
    ["length", "mi", "1609.344", "mi|mile"],
    ["length", "nmi", "1852", "nmi|nautical mile"],
    ["mass", "kg", "1", "kg|kilogram|kilogramme|kilo"],
    ["mass", "g", "0.001", "g|gram|gramme"],
    ["mass", "mg", "0.000001", "mg|milligram"],
    ["mass", "t", "1000", "t|tonne|metric ton"],
    ["mass", "lb", "0.45359237", "lb|lbs|pound"],
    ["mass", "oz", "0.028349523125", "oz|ounce"],
    ["mass", "st", "6.35029318", "st|stone"],
    ["volume", "L", "1", "l|liter|litre"],
    ["volume", "mL", "0.001", "ml|milliliter|millilitre"],
    ["volume", "m3", "1000", "m3|cubic meter|cubic metre"],
    ["volume", "gal", "3.785411784", "gal|gallon|us gallon"],
    ["volume", "qt", "0.946352946", "qt|quart"],
    ["volume", "pt", "0.473176473", "pt|pint"],
    ["volume", "cup", "0.2365882365", "cup"],
    ["volume", "fl oz", "0.0295735295625", "floz|fl oz|fluid ounce"],
    ["volume", "tbsp", "0.01478676478125", "tbsp|tablespoon"],
    ["volume", "tsp", "0.00492892159375", "tsp|teaspoon"],
    ["speed", "m/s", "1", "m/s|mps|meter/second|metre/second"],
    ["speed", "km/h", "5/18", "km/h|kmh|kph|kmph|kilometer/hour|kilometre/hour|km/hour"],
    ["speed", "mph", "0.44704", "mph|mi/h|mile/hour"],
    ["speed", "kn", "463/900", "kn|kt|knot"],
    ["speed", "ft/s", "0.3048", "ft/s|fps|foot/second|feet/second"],
    ["time", "s", "1", "s|sec|second"],
    ["time", "ms", "0.001", "ms|millisecond"],
    ["time", "min", "60", "min|minute"],
    ["time", "h", "3600", "h|hr|hour"],
    ["time", "days", "86400", "d|day"],
    ["time", "weeks", "604800", "wk|week"],
    ["data", "bits", "1/8", "bit"],
    ["data", "bytes", "1", "b|byte"],
    ["data", "kB", "1000", "kb|kilobyte"],
    ["data", "MB", "1000000", "mb|megabyte"],
    ["data", "GB", "1000000000", "gb|gigabyte"],
    ["data", "TB", "1000000000000", "tb|terabyte"],
    ["data", "KiB", "1024", "kib|kibibyte"],
    ["data", "MiB", "1048576", "mib|mebibyte"],
    ["data", "GiB", "1073741824", "gib|gibibyte"],
    ["area", "m2", "1", "m2|sq m|sqm|square meter|square metre"],
    ["area", "km2", "1000000", "km2|sq km|square kilometer|square kilometre"],
    ["area", "cm2", "0.0001", "cm2|square centimeter|square centimetre"],
    ["area", "ft2", "0.09290304", "ft2|sq ft|sqft|square foot|square feet"],
    ["area", "in2", "0.00064516", "in2|sq in|square inch|square inches"],
    ["area", "ha", "10000", "ha|hectare"],
    ["area", "acres", "4046.8564224", "ac|acre"],
    ["area", "mi2", "2589988.110336", "mi2|sq mi|square mile"],
    ["temperature", "\u00b0C", "", "c|celsius|centigrade"],
    ["temperature", "\u00b0F", "", "f|fahrenheit"],
    ["temperature", "K", "", "k|kelvin"],
  ];
  const UNIT_INDEX = new Map();
  for (const [category, id, factor, names] of UNIT_TABLE) {
    for (const name of names.split("|")) UNIT_INDEX.set(name, { category, id, factor });
  }
  const singular = (word) => (word.length > 3 && word.endsWith("s") ? word.slice(0, -1) : word);
  function findUnit(raw) {
    let text = String(raw === undefined || raw === null ? "" : raw).trim().toLowerCase();
    text = text
      .replace(/\u00b0|\bdegrees?\b|\bdeg\b/g, "")
      .replace(/\u00b2|\^2\b/g, "2")
      .replace(/\u00b3|\^3\b/g, "3")
      .replace(/\s+per\s+/g, "/")
      .replace(/\.+$/, "")
      .replace(/\s+/g, " ")
      .trim();
    if (UNIT_INDEX.has(text)) return UNIT_INDEX.get(text);
    const relaxed = text
      .split("/")
      .map((part) => part.trim().split(" ").map(singular).join(" "))
      .join("/");
    return UNIT_INDEX.get(relaxed) || null;
  }
  function convert(valueText, fromText, toText) {
    let amountText = String(valueText).trim();
    let from = fromText;
    const split = /^(-?[\d,]*\.?\d+(?:e[-+]?\d+)?)\s*(.*)$/i.exec(amountText);
    if (!split) throw new Error(`"${valueText}" is not a number`);
    amountText = split[1].replace(/,/g, "");
    if (split[2] && !from) from = split[2];
    const negative = amountText.startsWith("-");
    let amount = parseDecimal(negative ? amountText.slice(1) : amountText);
    if (negative) amount = negate(amount);
    const source = findUnit(from);
    const target = findUnit(toText);
    if (!from) throw new Error('say what unit the value is in, for example {"value": 26.2, "from": "miles", "to": "km"}');
    if (!source) throw new Error(`I do not know the unit "${from}"`);
    if (!target) throw new Error(`I do not know the unit "${toText}"`);
    if (source.category !== target.category) throw new Error(`${source.id} is ${source.category} and ${target.id} is ${target.category}: they cannot be converted`);
    let result;
    if (source.category === "temperature") {
      const offset = parseDecimal("273.15");
      const celsius = source.id === "K" ? minus(amount, offset) : source.id === "\u00b0F" ? divide(times(minus(amount, whole(32)), whole(5)), whole(9)) : amount;
      result = target.id === "K" ? plus(celsius, offset) : target.id === "\u00b0F" ? plus(divide(times(celsius, whole(9)), whole(5)), whole(32)) : celsius;
    } else {
      result = divide(times(amount, parseFactor(source.factor)), parseFactor(target.factor));
    }
    const shown = show(result, 12, 6);
    const given = show(amount, 30, 12).text;
    return `${given} ${source.id} ${shown.exact ? "=" : "\u2248"} ${shown.text} ${target.id}`;
  }

  // ================================================================ notes
  function memoryStorage() {
    const map = new Map();
    return {
      getItem: (key) => (map.has(key) ? map.get(key) : null),
      setItem: (key, value) => void map.set(key, String(value)),
      removeItem: (key) => void map.delete(key),
    };
  }
  const noteId = (key) =>
    String(key)
      .toLowerCase()
      .replace(/['\u2019]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .replace(/^(?:my|the|our|your|a|an)\s+/, "")
      .trim();
  function notesStore(storage) {
    const load = () => {
      try {
        const data = JSON.parse(storage.getItem(NOTES_KEY) || "null");
        return data && Array.isArray(data.items) ? data.items.filter((item) => item && typeof item.id === "string") : [];
      } catch (error) {
        return [];
      }
    };
    const save = (items) => storage.setItem(NOTES_KEY, JSON.stringify({ v: 1, items }));
    const words = (id) => id.split(" ").map(singular).filter(Boolean);
    function find(items, key) {
      const id = noteId(key);
      const exact = items.find((item) => item.id === id);
      if (exact) return exact;
      const wanted = words(id);
      let best = null;
      let bestScore = 0;
      for (const item of items) {
        const have = words(item.id);
        const shared = wanted.filter((word) => have.includes(word)).length;
        const score = shared / Math.max(1, new Set(wanted.concat(have)).size);
        if (score > bestScore) {
          best = item;
          bestScore = score;
        }
      }
      return bestScore >= 0.5 ? best : null;
    }
    return { load, save, find };
  }

  // ================================================================ tools
  function createTools(env) {
    const settings = env || {};
    const storage = settings.storage || memoryStorage();
    const store = notesStore(storage);
    const today = () => localNow(settings).days;

    const calcTool = {
      name: "calc",
      aliases: ["calculator", "calculate", "math", "maths", "compute", "arithmetic", "eval", "evaluate"],
      description: "Exact arithmetic: big whole numbers, fractions, powers, roots, percentages, and round, floor, ceil, abs, min, max, gcd, lcm, sqrt, sin, cos, tan, ln, log, exp.",
      params: { expression: { type: "string", required: true, aliases: ["expr", "input", "query", "formula", "equation", "math", "q", "problem"] } },
      examples: [{ expression: "(1234 + 5678) * 91 - 4321" }, { expression: "round(987654321 / 12345, 3)" }],
      risk: () => "read",
      run: (args) => calc(args.expression).text,
    };

    const textTool = {
      name: "text",
      aliases: ["string", "strings", "letters", "count", "counter", "text_tool", "str"],
      description: "Looks at text exactly, character by character: count how often `find` appears, count letters, characters or words, reverse it, change case.",
      params: {
        op: {
          enum: ["count", "letters", "length", "words", "reverse", "upper", "lower"],
          required: true,
          aliases: ["operation", "action", "mode", "task"],
          enumAliases: { occurrences: "count", count_letter: "count", count_char: "count", letter_count: "letters", count_letters: "letters", len: "length", chars: "length", characters: "length", word_count: "words", count_words: "words", wordcount: "words", reversed: "reverse", uppercase: "upper", lowercase: "lower" },
        },
        text: { type: "string", required: true, aliases: ["string", "input", "word", "sentence", "str", "value", "content", "phrase"] },
        find: { type: "string", aliases: ["letter", "char", "character", "substring", "needle", "target", "pattern", "search"] },
      },
      examples: [
        { op: "count", text: "strawberry", find: "r" },
        { op: "words", text: "the quick brown fox" },
      ],
      risk: () => "read",
      run: (args) => {
        const value = args.text;
        const quoted = JSON.stringify(value.length > 80 ? value.slice(0, 77) + "..." : value);
        let op = args.op;
        if (op === "letters" && args.find) op = "count";
        if (op === "count") {
          if (!args.find) throw new Error('count needs "find": the letter or text to look for. To count every letter, use op "letters"');
          const haystack = value.toLowerCase();
          const needle = args.find.toLowerCase();
          let total = 0;
          for (let at = haystack.indexOf(needle); at >= 0; at = haystack.indexOf(needle, at + needle.length)) total++;
          return `${total} - ${JSON.stringify(args.find)} appears ${total} time${total === 1 ? "" : "s"} in ${quoted} (ignoring case).`;
        }
        const characters = Array.from(value);
        if (op === "letters") {
          const total = characters.filter((ch) => /\p{L}/u.test(ch)).length;
          return `${total} letters in ${quoted}.`;
        }
        if (op === "length") {
          const total = characters.filter((ch) => /\p{L}/u.test(ch)).length;
          return `${characters.length} characters in ${quoted} (${total} of them letters).`;
        }
        if (op === "words") {
          const total = value.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
          return `${total} word${total === 1 ? "" : "s"} in ${quoted}.`;
        }
        if (op === "reverse") return characters.reverse().join("");
        return op === "upper" ? value.toUpperCase() : value.toLowerCase();
      },
    };

    const clockTool = {
      name: "clock",
      aliases: ["date", "dates", "time", "calendar", "datetime", "today", "now", "date_tool"],
      description: 'Today\'s date and time, and exact date arithmetic. Dates are YYYY-MM-DD, "15 March 2031" or "today". diff counts the days from `date` to `to`; add moves `date` by `amount` (negative goes back); weekday names the day.',
      hint: "You do not know today's date or the time. Use the clock tool for them and for every date calculation.",
      params: {
        op: {
          enum: ["now", "diff", "add", "weekday"],
          required: true,
          aliases: ["operation", "action", "mode"],
          enumAliases: { today: "now", date: "now", current: "now", get: "now", difference: "diff", between: "diff", until: "diff", days_between: "diff", days_until: "diff", subtract: "diff", plus: "add", after: "add", offset: "add", day_of_week: "weekday", dayofweek: "weekday", dow: "weekday" },
        },
        date: { type: "string", aliases: ["from", "start", "date1", "from_date", "start_date", "day", "base"] },
        to: { type: "string", aliases: ["end", "until", "date2", "to_date", "end_date", "target"] },
        amount: { type: "number", aliases: ["days", "n", "number", "count", "value", "delta"] },
        unit: { enum: ["days", "weeks", "months", "years"], aliases: ["units"], enumAliases: { day: "days", week: "weeks", month: "months", year: "years", d: "days", w: "weeks", m: "months", y: "years" } },
      },
      examples: [{ op: "now" }, { op: "diff", date: "today", to: "2027-01-01" }, { op: "add", date: "2024-02-29", amount: 1000, unit: "days" }, { op: "weekday", date: "15 March 2031" }],
      risk: () => "read",
      run: (args) => {
        const now = localNow(settings);
        if (args.op === "now") return `${weekdayOf(now.days)}, ${isoOf(now.days)}, ${now.time} local time (${now.zone}).`;
        const from = parseDate(args.date, now.days);
        if (args.op === "weekday") return `${weekdayOf(from)} - ${isoOf(from)} is a ${weekdayOf(from)}.`;
        if (args.op === "diff") {
          if (!args.to) throw new Error('diff needs "to": the second date. Example: {"op": "diff", "date": "today", "to": "2027-01-01"}');
          const to = parseDate(args.to, now.days);
          const days = to - from;
          return `${days} day${Math.abs(days) === 1 ? "" : "s"} from ${isoOf(from)} (${weekdayOf(from)}) to ${isoOf(to)} (${weekdayOf(to)}).`;
        }
        if (args.amount === undefined) throw new Error('add needs "amount": how many days (or weeks, months, years) to move. Negative goes back');
        if (!Number.isInteger(args.amount)) throw new Error("amount must be a whole number");
        const unit = args.unit || "days";
        const moved = addToDate(from, args.amount, unit);
        const size = Math.abs(args.amount);
        return `${isoOf(moved)} (${weekdayOf(moved)}) is ${size} ${size === 1 ? unit.slice(0, -1) : unit} ${args.amount < 0 ? "before" : "after"} ${isoOf(from)}.`;
      },
    };

    const unitsTool = {
      name: "units",
      aliases: ["convert", "unit", "converter", "conversion", "unit_convert", "unit_converter", "convert_units"],
      description: "Converts between units of length, mass, volume, temperature, speed, time, data and area, with exact factors.",
      params: {
        value: { type: "number or text", required: true, aliases: ["amount", "number", "quantity", "x", "input"] },
        from: { type: "string", aliases: ["from_unit", "source", "unit", "src", "in"] },
        to: { type: "string", required: true, aliases: ["to_unit", "target", "into", "dest", "out"] },
      },
      examples: [{ value: 26.2, from: "miles", to: "km" }],
      risk: () => "read",
      run: (args) => convert(args.value, args.from, args.to),
    };

    const notesTool = {
      name: "notes",
      aliases: ["note", "memory", "remember", "memo", "notebook", "store", "recall", "save_note"],
      description: "Your only memory between conversations, kept on this device. save stores a fact under a short key; get reads one back; list shows them all; delete and clear remove them.",
      hint: "You remember nothing between conversations except what is in notes. When asked to remember something, save it there. When the user asks about something personal you were not told in this conversation, get or list notes before answering.",
      params: {
        op: {
          enum: ["save", "get", "list", "delete", "clear"],
          required: true,
          aliases: ["operation", "action", "mode"],
          enumAliases: { set: "save", store: "save", remember: "save", add: "save", write: "save", put: "save", create: "save", read: "get", recall: "get", find: "get", lookup: "get", search: "get", retrieve: "get", fetch: "get", all: "list", show: "list", remove: "delete", forget: "delete", erase: "delete" },
        },
        key: { type: "string", aliases: ["name", "title", "topic", "id", "label", "query", "subject"] },
        value: { type: "string", aliases: ["content", "note", "text", "data", "val", "fact"] },
      },
      examples: [
        { op: "save", key: "locker code", value: "7291" },
        { op: "get", key: "locker code" },
      ],
      risk: (args) => (args.op === "save" ? "write" : args.op === "delete" || args.op === "clear" ? "destructive" : "read"),
      untrusted: (args) => args.op === "get" || args.op === "list",
      describe: (args) => (args.op === "save" ? `Save a note: ${args.key || "?"} = ${args.value || "?"}` : args.op === "delete" ? `Delete the note "${args.key || "?"}"` : args.op === "clear" ? "Delete every saved note" : `Read your notes`),
      run: (args) => {
        const items = store.load();
        const line = (item) => `${item.key} = ${item.value}`;
        if (args.op === "list") return items.length ? `${items.length} note${items.length === 1 ? "" : "s"}: ${items.map(line).join("; ")}` : "No notes are saved yet.";
        if (args.op === "clear") {
          store.save([]);
          return `Cleared ${items.length} note${items.length === 1 ? "" : "s"}.`;
        }
        if (!args.key) throw new Error(`${args.op} needs "key": a short name for the note`);
        if (args.op === "save") {
          if (!args.value) throw new Error('save needs "value": the fact to remember');
          const id = noteId(args.key);
          if (!id) throw new Error("the key must contain letters or digits");
          const key = args.key.trim().replace(/^(?:my|the|our)\s+/i, "").slice(0, 80);
          const kept = items.filter((item) => item.id !== id);
          if (kept.length >= 200) throw new Error("the notebook is full (200 notes). Delete one first");
          kept.push({ id, key, value: args.value.trim().slice(0, 500), at: isoOf(today()) });
          store.save(kept);
          return `Saved: ${key} = ${args.value.trim().slice(0, 500)}`;
        }
        const found = store.find(items, args.key);
        if (!found) {
          return items.length ? `Nothing is saved under "${args.key}". Saved keys: ${items.map((item) => item.key).join("; ")}.` : `Nothing is saved under "${args.key}": no notes are saved yet.`;
        }
        if (args.op === "get") return line(found);
        store.save(items.filter((item) => item !== found));
        return `Deleted the note: ${found.key}`;
      },
    };

    const libraryTool = {
      name: "library",
      aliases: ["search", "lookup", "offline_library", "reference", "search_library", "wiki"],
      description: "Searches the offline library packs installed on this device (first aid, survival and reference articles).",
      params: {
        op: { enum: ["search", "list"], required: true, aliases: ["operation", "action"], enumAliases: { find: "search", query: "search", lookup: "search", packs: "list", installed: "list" } },
        query: { type: "string", aliases: ["q", "text", "question", "topic", "search", "term"] },
      },
      examples: [{ op: "search", query: "treat a burn" }],
      risk: () => "read",
      untrusted: true,
      run: async (args) => {
        const library = settings.library;
        if (!library) throw new Error("the offline library is not available here");
        const packs = (library.installed && library.installed()) || [];
        if (args.op === "list") {
          return packs.length ? `${packs.length} pack${packs.length === 1 ? "" : "s"} installed: ${packs.map((pack) => pack.name || pack.title || pack.id).join("; ")}` : "No library packs are installed. Open GlowChat, then Library, to add one.";
        }
        if (!args.query) throw new Error('search needs "query": what to look for');
        if (!packs.length) return "No library packs are installed, so there is nothing to search. Open GlowChat, then Library, to add one.";
        const results = await library.search(args.query, { limit: 3 });
        if (!results.length) return `No passage in the library matches "${args.query}".`;
        return results.map((result, index) => `[${index + 1}] ${result.title || "Untitled"}${result.section ? " - " + result.section : ""}: ${String(result.text || "").replace(/\s+/g, " ").slice(0, 380)}`).join("\n");
      },
    };

    const taleTool = {
      name: "tale",
      aliases: ["story", "spark", "glowspark", "write_story", "fairy_tale", "storyteller"],
      description: "Asks GlowSpark, Glow's own tiny story model, to continue an opening into a short fairy tale. It knows no facts and follows no instructions: it only continues text.",
      params: {
        opening: { type: "string", required: true, aliases: ["prompt", "text", "start", "beginning", "input", "seed"] },
        length: { type: "integer", aliases: ["words", "tokens", "max_tokens", "size"] },
      },
      examples: [{ opening: "Once upon a time there was a little fox" }],
      timeoutMs: 90000,
      risk: () => (settings.spark && settings.spark.loaded() ? "read" : "download"),
      untrusted: true,
      describe: () => "Download GlowSpark (a small story model, once) and let it write on this device",
      run: async (args, context) => {
        if (!settings.spark) throw new Error("GlowSpark is not available here");
        const length = Math.max(20, Math.min(200, args.length || 90));
        const tale = await settings.spark.write(args.opening, length, context && context.signal);
        return String(tale).trim();
      },
    };

    return [calcTool, textTool, clockTool, unitsTool, notesTool, libraryTool, taleTool];
  }

  // ================================================================ the no-model brain
  // Pattern rules that turn a plain English request into tool calls, one step at a time, speaking the same
  // protocol a model would. It is honest about what it is: no model, no knowledge, English only.
  const MONTH_WORD = "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
  const DATE_SOURCE =
    "\\d{4}-\\d{1,2}-\\d{1,2}|\\d{1,2}(?:st|nd|rd|th)?(?: of)? " + MONTH_WORD + "\\.?,? \\d{4}|" + MONTH_WORD + "\\.? \\d{1,2}(?:st|nd|rd|th)?,? \\d{4}|\\d{1,2}[/.]\\d{1,2}[/.]\\d{4}|today|tomorrow|yesterday|that date|that day";
  const NUMBER_SOURCE = "(-?\\d[\\d,]*(?:\\.\\d+)?|-?\\.\\d+)";
  const PREVIOUS = /\b(?:that number|that result|that value|the result|the answer|the total|that|it)\b/gi;
  const findDates = (text) => text.match(new RegExp("\\b(?:" + DATE_SOURCE + ")\\b", "gi")) || [];

  // What a tool's answer is worth to the next step: a date, or the number after the last "=".
  function valueOf(body) {
    const marks = Math.max(body.lastIndexOf("="), body.lastIndexOf("\u2248"));
    const tail = (marks >= 0 ? body.slice(marks + 1) : body).trim();
    const date = /^(\d{4}-\d{2}-\d{2})\b/.exec(tail);
    if (date) return date[1];
    const number = /-?\d[\d,]*(?:\.\d+)?(?:e[-+]?\d+)?/i.exec(tail);
    return number ? number[0].replace(/,/g, "") : "";
  }

  function splitClauses(task) {
    const kept = [];
    const masked = String(task).replace(/"[^"]*"|\u201c[^\u201d]*\u201d/g, (quote) => {
      kept.push(quote);
      return `\u0001${kept.length - 1}\u0001`;
    });
    const parts = masked.split(
      /\s*(?:[,;]\s*(?:and\s+)?then\s+|\s+and\s+then\s+|[.?!]\s+(?:(?:and\s+)?then\s+)?(?=[A-Z\u0001])|,?\s+and\s+(?=(?:multiply|divide|add|subtract|convert|count|reverse|save|tell|double|remember)\b))/
    );
    return parts
      .map((part) =>
        part
          .replace(/\u0001(\d+)\u0001/g, (all, index) => kept[Number(index)])
          .trim()
          .replace(/[.?!]+$/, "")
          .trim()
      )
      .filter((part) => part && !/^(?:thanks|thank you|please|cheers|ty)\b[\s!.]*$/i.test(part));
  }

  const unquote = (text) => text.trim().replace(/^["'\u201c\u2018]+|["'\u201d\u2019]+$/g, "");
  const call = (name, args) => () => ({ name, args });

  // Each matcher looks at one clause and returns a function (previous values) -> tool call, or null.
  function matchClause(clause, context) {
    const lower = clause.toLowerCase();
    let match;

    // ---- notes ----
    match = /^(?:please\s+)?(?:(?:remember|memori[sz]e|keep in mind|note|don'?t forget|do not forget)(?:\s+that|\s*:)?|(?:save|store|make|add|write|take)(?: down)? (?:a |this )?note(?:\s+that|\s*:|\s+saying)?)\s+(.+)$/i.exec(clause);
    if (match) {
      const fact = match[1].trim();
      const parts = /^(.+?)\s+(?:is|are|was|were|will be|=)\s+(.+)$/i.exec(fact);
      const key = parts ? parts[1] : fact.split(/\s+/).slice(0, 4).join(" ");
      const value = (parts ? parts[2] : fact).replace(/^(?:on|at)\s+(?=\d)/i, "");
      const dates = findDates(value);
      if (dates.length) context.date = dates[0];
      return call("notes", { op: "save", key: key.replace(/^(?:my|the|our)\s+/i, ""), value });
    }
    if (/^(?:forget|clear|delete|erase|wipe) (?:everything|all(?: of)?(?: my| the)? notes|my notes)/i.test(clause)) return call("notes", { op: "clear" });
    match = /^(?:forget|delete|remove|erase)\s+(?:the note (?:about|on|for)\s+)?(?:my\s+|the\s+)?(.+)$/i.exec(clause);
    if (match) return call("notes", { op: "delete", key: match[1] });
    if (/\bwhat (?:do|did|have) you (?:remember|know|saved?)\b|^(?:list|show)(?: me)?(?: all)?(?: my| the)? notes\b|\bwhat have i told you\b/i.test(clause)) return call("notes", { op: "list" });
    match = /^(?:(?:what|when|where|who|which)(?:'s|\s+is|\s+are|\s+was|\s+were)|tell me|do you (?:remember|know)|remind me(?: of| about)?|recall)\s+(?:my|our)\s+(.+)$/i.exec(clause);
    if (match) return call("notes", { op: "get", key: match[1] });

    // ---- clock ----
    if (/\btoday'?s date\b|\bwhat(?:'s| is) the date\b|\bcurrent date\b|\bdate today\b|\bwhat(?:'s| is) today\b|\bwhat time is it\b|\bcurrent time\b/i.test(clause)) return call("clock", { op: "now" });
    const dates = findDates(clause);
    const dateRef = (text, values) => {
      if (!/^that (?:date|day)$/i.test(text)) return text;
      const last = values[values.length - 1] || "";
      return context.date || (/^\d{4}-\d{2}-\d{2}$/.test(last) ? last : "today");
    };
    match = new RegExp(NUMBER_SOURCE + "\\s+(day|week|month|year)s?\\s+(after|from|before|ago|later|earlier|prior to|since)\\b", "i").exec(clause);
    if (match) {
      const back = /before|ago|earlier|prior/i.test(match[3]);
      const amount = Number(match[1].replace(/,/g, "")) * (back ? -1 : 1);
      const anchor = dates.find((text) => clause.indexOf(text) > match.index) || "today";
      return (values) => ({ name: "clock", args: { op: "add", date: dateRef(anchor, values), amount, unit: match[2].toLowerCase() + "s" } });
    }
    if (/\bhow many (?:days|nights)\b|\bdays (?:until|till|to|between|from|since|left|remaining)\b|\bhow long (?:until|till|since|to)\b/i.test(clause) && dates.length) {
      const first = dates.length >= 2 ? dates[0] : /\bsince\b/i.test(clause) ? dates[0] : "today";
      const second = dates.length >= 2 ? dates[1] : /\bsince\b/i.test(clause) ? "today" : dates[0];
      return (values) => ({ name: "clock", args: { op: "diff", date: dateRef(first, values), to: dateRef(second, values) } });
    }
    if (/\b(?:what|which) day\b|\bday of the week\b|\bweekday\b/i.test(clause)) {
      const named = dates.find((text) => !/^today$/i.test(text));
      return named ? (values) => ({ name: "clock", args: { op: "weekday", date: dateRef(named, values) } }) : call("clock", { op: "now" });
    }

    // ---- units ----
    const unitCall = (value, from, to) => {
      const source = findUnit(from);
      const target = findUnit(to);
      if (!source || !target || source.category !== target.category) return null;
      return (values) => ({ name: "units", args: { value: value === null ? values[values.length - 1] : value.replace(/,/g, ""), from: from.trim(), to: to.trim() } });
    };
    match = new RegExp("^(?:please\\s+)?(?:convert|change|what(?:'s| is)|how much is)?\\s*" + NUMBER_SOURCE + "\\s*(.+?)\\s+(?:to|in|into|as)\\s+(.+)$", "i").exec(clause);
    if (match && unitCall(match[1], match[2], match[3])) return unitCall(match[1], match[2], match[3]);
    match = new RegExp("^how many (.+?) (?:is|are|in|make|equals?|are in|is in|are there in)\\s+" + NUMBER_SOURCE + "\\s*(.+)$", "i").exec(clause);
    if (match && unitCall(match[2], match[3], match[1])) return unitCall(match[2], match[3], match[1]);
    match = /^(?:convert|change) (?:that|it|the result|that number) (?:from (.+?) )?(?:to|into) (.+)$/i.exec(clause);
    if (match && match[1] && unitCall(null, match[1], match[2])) return unitCall(null, match[1], match[2]);

    // ---- text ----
    match = /^(?:how many (?:letters|characters) (?:are |is )?(?:there )?in|count (?:the )?(?:number of )?(?:letters|characters) (?:in|of)) (?:the (?:word|text|phrase|name|sentence|string) )?(.+)$/i.exec(clause);
    if (match) return call("text", { op: "letters", text: unquote(match[1]) });
    match = /^how many (?:times )?(?:does |do |is |are )?(?:the )?(?:letter |character )?["'\u201c\u2018]?([A-Za-z])["'\u201d\u2019]?(?:'?s)? (?:appears? |occurs? |shows? up |are there |is there |are |is )?in (?:the (?:word|text|phrase|name|sentence|string) )?(.+)$/i.exec(clause);
    if (match) return call("text", { op: "count", text: unquote(match[2]), find: match[1] });
    match = /^count (?:the )?(?:number of )?(?:times )?(?:the )?(?:letter |character )?["'\u201c\u2018]?([A-Za-z])["'\u201d\u2019]?(?:'?s)? (?:appears |occurs )?in (?:the (?:word|text|phrase|name|sentence|string) )?(.+)$/i.exec(clause);
    if (match) return call("text", { op: "count", text: unquote(match[2]), find: match[1] });
    match = /^(?:how many words (?:are |is )?(?:there )?in|count (?:the )?words in) (?:this |the |that )?(?:sentence|text|phrase|string)?\s*:?\s*(.+)$/i.exec(clause);
    if (match) return call("text", { op: "words", text: unquote(match[1]) });
    match = /^reverse (?:this |the |that )?(?:text|word|string|phrase|sentence)?\s*(?:exactly)?\s*:?\s*(.+)$/i.exec(clause);
    if (match) return call("text", { op: "reverse", text: unquote(match[1]) });

    // ---- tale and library ----
    match = /^(?:please\s+)?(?:write|tell)(?: me)? (?:a |an )?(?:short |little )?(?:fairy ?tale|tale|story)(?: (?:about|that (?:starts|begins)(?: with)?))?\s*:?\s*(.*)$/i.exec(clause);
    if (match) {
      const about = unquote(match[1]);
      const opening = !about ? "Once upon a time there was" : /^(?:a|an|the)\s/i.test(about) && about.split(/\s+/).length <= 5 ? `Once upon a time there was ${about}` : about;
      return call("tale", { opening });
    }
    match = /^(?:search|look up|look in|find in|check)(?: in)?(?: my| the)?(?: offline)? library (?:for|about|on)?\s*(.+)$/i.exec(clause) || /^what does (?:my|the) library say about (.+)$/i.exec(clause);
    if (match) return call("library", { op: "search", query: match[1] });

    // ---- arithmetic ----
    const build = (values) => {
      let text = clause.replace(/^(?:and\s+|then\s+|please\s+|now\s+)+/i, "");
      const previous = values.length ? values[values.length - 1] : "";
      if (previous && /^-?[\d.e+-]+$/i.test(previous)) text = text.replace(PREVIOUS, `(${previous})`);
      const places = /,?\s*(?:and (?:give|round|show|state|express)[^,]*?|rounded |correct |to )(?:to )?(\d+) decimal places?\s*$/i.exec(text);
      if (places) text = text.slice(0, places.index);
      let parts;
      if ((parts = /^multiply (.+?) by (.+)$/i.exec(text))) text = `(${parts[1]}) * (${parts[2]})`;
      else if ((parts = /^divide (.+?) by (.+)$/i.exec(text))) text = `(${parts[1]}) / (${parts[2]})`;
      else if ((parts = /^add (.+?) (?:to|and|with) (.+)$/i.exec(text))) text = `(${parts[1]}) + (${parts[2]})`;
      else if ((parts = /^subtract (.+?) from (.+)$/i.exec(text))) text = `(${parts[2]}) - (${parts[1]})`;
      else if ((parts = /^(?:double|twice) (.+)$/i.exec(text))) text = `2 * (${parts[1]})`;
      else text = text.replace(/^(?:what(?:'s| is| are)|how much is|calculate|compute|work out|evaluate|find|solve|tell me)\s+/i, "");
      text = text.replace(/,(?=\s)/g, " ").replace(/\bthe (?:value|result|sum|product) of\b/gi, "");
      const expression = normaliseExpression(places ? `round(${text}, ${places[1]})` : text);
      return expression;
    };
    if (/\d/.test(clause) || PREVIOUS.test(lower)) {
      PREVIOUS.lastIndex = 0;
      try {
        evaluate(build(["1"]));
        return (values) => ({ name: "calc", args: { expression: build(values) } });
      } catch (error) {
        return null;
      }
    }
    return null;
  }

  function planFor(task) {
    const context = {};
    const steps = [];
    const clauses = splitClauses(task);
    for (const clause of clauses) {
      const step = matchClause(clause, context);
      if (!step) return { steps: [], missed: clause };
      steps.push(step);
    }
    return { steps, missed: "" };
  }

  const RULES_HELP =
    "I am the no-model brain: I follow patterns, I do not understand language and I know no facts. I can calculate exactly, count letters and words, reverse text, tell today's date and do date arithmetic, convert units, remember notes on this device, search your offline library and ask GlowSpark for a tale.";

  function rulesBrain() {
    const brain = {
      last: { provider: "glow", model: "rules" },
      next: async (request) => {
        const messages = request.messages;
        const task = (messages.find((message) => message.role === "user") || { content: "" }).content;
        const bodies = [];
        for (const message of messages.slice(2)) {
          const found = message.role === "user" && /<<<DATA\n([\s\S]*?)\nDATA>>>/.exec(message.content);
          if (found) bodies.push(found[1]);
        }
        brain.last = { provider: "glow", model: "rules" };
        if (/^\s*(?:help|what can you do|what tools|how do(?:es)? (?:this|you|it) work)\b/i.test(task)) return "FINAL " + RULES_HELP;
        const plan = planFor(task);
        if (!plan.steps.length) {
          brain.last = { provider: "glow", model: "rules", unmatched: true };
          const part = plan.missed && plan.missed.length < task.trim().length - 2 ? ` I did not understand this part: "${plan.missed}".` : "";
          return `FINAL I cannot answer that without a language model.${part} ${RULES_HELP} For anything else, switch to the free model, or open this in GlowChat.`;
        }
        const last = bodies[bodies.length - 1];
        if (last !== undefined && /^(?:DENIED|ERROR)\b/.test(last)) {
          const why = last.replace(/^(?:DENIED|ERROR):\s*/, "").split(/\.\s+Do not retry/)[0].replace(/\.$/, "");
          return `FINAL I stopped: ${why}.`;
        }
        if (bodies.length < plan.steps.length) return "TOOL " + JSON.stringify(plan.steps[bodies.length](bodies.map(valueOf)));
        return "FINAL " + last;
      },
    };
    return brain;
  }

  // ================================================================ the free-model brain
  // No keys and no accounts: these endpoints are open. The task and every tool result are sent to whichever
  // one answers, so the page says so before the first run.
  const PROVIDERS = [
    { id: "pollinations", label: "Pollinations", url: "https://text.pollinations.ai/openai/chat/completions", model: "openai-fast" },
    { id: "ovh", label: "OVHcloud", url: "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/chat/completions", model: "Meta-Llama-3_3-70B-Instruct" },
    { id: "llm7", label: "LLM7", url: "https://api.llm7.io/v1/chat/completions", model: "default" },
  ];

  // Some free endpoints answer through the API's own function-call field, although no functions are offered
  // there. That call is written back in the one-line TOOL form, so the engine reads every model the same
  // way. Arguments that arrive as text are passed on as they came: the engine's reader repairs them.
  function readChoice(choice) {
    const message = (choice && choice.message) || {};
    const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
    const call = calls.find((item) => item && item.function && typeof item.function.name === "string" && item.function.name.trim());
    if (call) {
      const raw = call.function.arguments;
      const args = typeof raw === "string" ? raw.trim() || "{}" : raw && typeof raw === "object" ? JSON.stringify(raw) : "{}";
      return { text: `TOOL {"name": ${JSON.stringify(call.function.name.trim())}, "args": ${args}}`, channel: "native" };
    }
    const text = message.content;
    return typeof text === "string" && text.trim() ? { text, channel: "" } : null;
  }

  function chatBrain(options) {
    const settings = options || {};
    const providers = settings.providers || PROVIDERS;
    const send = settings.fetch || ((url, init) => fetch(url, init));
    let preferred = null; // whoever answered last is asked first, so one run stays on one model
    const brain = {
      last: null,
      failures: [],
      next: async (request) => {
        const signal = request.signal;
        const failures = [];
        const order = preferred ? [preferred].concat(providers.filter((provider) => provider !== preferred)) : providers;
        for (const provider of order) {
          if (signal && signal.aborted) throw new Error("stopped");
          const controller = typeof AbortController === "function" ? new AbortController() : null;
          const cancel = () => controller && controller.abort();
          if (signal) signal.addEventListener("abort", cancel, { once: true });
          const timer = setTimeout(cancel, settings.timeoutMs || 45000);
          try {
            const response = await send(provider.url, {
              method: "POST",
              headers: Object.assign({ "Content-Type": "application/json" }, settings.headers),
              body: JSON.stringify({ model: provider.model, messages: request.messages, temperature: settings.temperature === undefined ? 0 : settings.temperature, stream: false }),
              signal: controller ? controller.signal : undefined,
            });
            if (!response.ok) {
              failures.push(`${provider.label}: HTTP ${response.status}`);
              continue;
            }
            const data = await response.json();
            const read = readChoice(data && data.choices && data.choices[0]);
            if (!read && !settings.allowEmpty) {
              failures.push(`${provider.label}: empty reply`);
              continue;
            }
            brain.last = { provider: provider.id, model: String((data && data.model) || provider.model) };
            if (read && read.channel) brain.last.channel = read.channel;
            brain.failures = failures;
            preferred = provider;
            return { text: read ? read.text : "", via: brain.last };
          } catch (error) {
            if (signal && signal.aborted) throw new Error("stopped");
            failures.push(`${provider.label}: ${error && error.name === "AbortError" ? "no answer in time" : messageOf(error)}`);
          } finally {
            clearTimeout(timer);
            if (signal) signal.removeEventListener("abort", cancel);
          }
        }
        brain.failures = failures;
        throw new Error(`No free model answered (${failures.join("; ")})`);
      },
    };
    return brain;
  }

  return {
    NOTES_KEY,
    PROVIDERS,
    RULES_HELP,
    createTools,
    rulesBrain,
    chatBrain,
    readChoice,
    memoryStorage,
    calc,
    convert,
    parseDate,
    isoOf,
    weekdayOf,
    daysFromCivil,
    localNow,
    findUnit,
    planFor,
    splitClauses,
    valueOf,
    noteId,
  };
});
