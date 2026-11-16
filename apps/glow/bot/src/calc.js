// Unit-checked calculator for /calc. No eval: a small parser over numbers, units and + - * / ^.
//
//   12 kN / (20 mm * 5 mm) to MPa      -> 120 MPa
//   0.5 * 1200 kg * (25 m/s)^2 to kJ   -> 375 kJ
//   sqrt(2 * 9.81 m/s^2 * 3 m)         -> 7.67 m/s
//
// A number directly followed by units binds tighter than * and /, so "12 kN / 20 mm" means (12 kN) / (20 mm).
// Adding or converting quantities with different dimensions is an error, never a silent guess.
// Temperatures are absolute (K) only: degree Celsius has an offset and is left out on purpose.

const MAX_LENGTH = 200;
const BASE = ["m", "kg", "s", "A", "K"];

function dims(m = 0, kg = 0, s = 0, a = 0, k = 0) {
  return [m, kg, s, a, k];
}

const LENGTH = dims(1);
const MASS = dims(0, 1);
const TIME = dims(0, 0, 1);
const FORCE = dims(1, 1, -2);
const PRESSURE = dims(-1, 1, -2);
const ENERGY = dims(2, 1, -2);
const POWER = dims(2, 1, -3);
const CURRENT = dims(0, 0, 0, 1);
const VOLTAGE = dims(2, 1, -3, -1);
const RESISTANCE = dims(2, 1, -3, -2);
const FREQUENCY = dims(0, 0, -1);
const VOLUME = dims(3);
const NONE = dims();
const TEMPERATURE = dims(0, 0, 0, 0, 1);

const UNITS = {
  m: [1, LENGTH], mm: [1e-3, LENGTH], cm: [1e-2, LENGTH], km: [1e3, LENGTH], um: [1e-6, LENGTH],
  in: [0.0254, LENGTH], ft: [0.3048, LENGTH],
  kg: [1, MASS], g: [1e-3, MASS], t: [1e3, MASS], lb: [0.45359237, MASS],
  s: [1, TIME], ms: [1e-3, TIME], min: [60, TIME], h: [3600, TIME],
  N: [1, FORCE], kN: [1e3, FORCE], lbf: [4.4482216152605, FORCE],
  Pa: [1, PRESSURE], kPa: [1e3, PRESSURE], MPa: [1e6, PRESSURE], GPa: [1e9, PRESSURE],
  bar: [1e5, PRESSURE], psi: [6894.757293168, PRESSURE],
  J: [1, ENERGY], kJ: [1e3, ENERGY], Wh: [3600, ENERGY], kWh: [3.6e6, ENERGY],
  W: [1, POWER], kW: [1e3, POWER],
  A: [1, CURRENT], mA: [1e-3, CURRENT], V: [1, VOLTAGE], ohm: [1, RESISTANCE],
  Hz: [1, FREQUENCY], rpm: [1 / 60, FREQUENCY],
  L: [1e-3, VOLUME], mL: [1e-6, VOLUME],
  K: [1, TEMPERATURE], rad: [1, NONE], deg: [Math.PI / 180, NONE],
};
const CONSTANTS = { pi: Math.PI, e: Math.E };
const FUNCTIONS = {
  sqrt: null, sin: Math.sin, cos: Math.cos, tan: Math.tan,
  ln: Math.log, log: Math.log10, exp: Math.exp, abs: null,
};

const key = (value) => value.join(",");
// How a result in SI is named when no target unit is given.
const NAMED = {
  [key(LENGTH)]: "m", [key(MASS)]: "kg", [key(TIME)]: "s", [key(FORCE)]: "N", [key(PRESSURE)]: "Pa",
  [key(ENERGY)]: "J", [key(POWER)]: "W", [key(CURRENT)]: "A", [key(VOLTAGE)]: "V", [key(RESISTANCE)]: "ohm",
  [key(FREQUENCY)]: "Hz", [key(TEMPERATURE)]: "K",
  [key(dims(1, 0, -1))]: "m/s", [key(dims(1, 0, -2))]: "m/s^2", [key(dims(2))]: "m^2", [key(VOLUME)]: "m^3",
  [key(dims(0, 1, -2))]: "N/m", [key(dims(-3, 1))]: "kg/m^3",
};
const PRETTY_PREFIXES = {
  N: ["kN", 1e3], Pa: ["MPa", 1e6], J: ["kJ", 1e3], W: ["kW", 1e3],
};

/** A message that is safe to show the user. */
export class CalcError extends Error {}

class Quantity {
  constructor(value, unitDims = NONE) {
    this.value = value;
    this.dims = [...unitDims];
  }

  sameDims(other, what) {
    if (key(this.dims) !== key(other.dims)) {
      throw new CalcError(`Cannot ${what} ${describe(this.dims)} and ${describe(other.dims)}.`);
    }
  }

  add(other) {
    this.sameDims(other, "add");
    return new Quantity(this.value + other.value, this.dims);
  }

  sub(other) {
    this.sameDims(other, "subtract");
    return new Quantity(this.value - other.value, this.dims);
  }

  mul(other) {
    return new Quantity(this.value * other.value, this.dims.map((power, index) => power + other.dims[index]));
  }

  div(other) {
    if (other.value === 0) {
      throw new CalcError("Division by zero.");
    }
    return new Quantity(this.value / other.value, this.dims.map((power, index) => power - other.dims[index]));
  }

  power(exponent) {
    if (key(exponent.dims) !== key(NONE)) {
      throw new CalcError("An exponent must be a plain number.");
    }
    if (Math.abs(exponent.value) > 12) {
      throw new CalcError("Exponent too large.");
    }
    if (this.value < 0 && exponent.value !== Math.trunc(exponent.value)) {
      throw new CalcError("Fractional power of a negative number.");
    }
    return new Quantity(this.value ** exponent.value, this.dims.map((power) => power * exponent.value + 0));
  }
}

function describe(unitDims) {
  if (key(unitDims) === key(NONE)) {
    return "a plain number";
  }
  return NAMED[key(unitDims)] || siUnit(unitDims);
}

function siUnit(unitDims) {
  const parts = [];
  unitDims.forEach((power, index) => {
    if (power === 0) {
      return;
    }
    parts.push(BASE[index] + (power === 1 ? "" : "^" + numberText(power)));
  });
  return parts.join("*");
}

function numberText(value) {
  if (value === Math.trunc(value)) {
    return String(value);
  }
  return formatG(value, 6);
}

function stripZeros(text) {
  return text.includes(".") ? text.replace(/\.?0+$/, "") : text;
}

function exponentText(exponent) {
  return (exponent < 0 ? "-" : "+") + String(Math.abs(exponent)).padStart(2, "0");
}

/** Python's '{:.Ng}' format. */
export function formatG(value, precision) {
  if (value === 0) {
    return "0";
  }
  const [mantissa, exponentPart] = value.toExponential(precision - 1).split("e");
  const exponent = parseInt(exponentPart, 10);
  if (exponent < -4 || exponent >= precision) {
    return stripZeros(mantissa) + "e" + exponentText(exponent);
  }
  return stripZeros(value.toFixed(Math.max(0, precision - 1 - exponent)));
}

// A token is [kind, value]: ["num", 12], ["word", "mm"], ["op", "*"] or [null, null] at the end.
const TOKEN = /\s*(?:(\d+(?:\.\d*)?(?:[eE][+-]?\d+)?|\.\d+)|([A-Za-z_]+)|(\*\*|[-+*/^()]))/y;

function tokenize(input) {
  const tokens = [];
  const text = input.trim();
  let position = 0;
  while (position < text.length) {
    TOKEN.lastIndex = position;
    const match = TOKEN.exec(text);
    if (!match || TOKEN.lastIndex === position) {
      throw new CalcError(`I do not understand '${text.slice(position, position + 10)}'.`);
    }
    const [, numberPart, word, symbol] = match;
    if (numberPart !== undefined) {
      tokens.push(["num", parseFloat(numberPart)]);
    } else if (word !== undefined) {
      tokens.push(["word", word]);
    } else {
      tokens.push(["op", symbol === "**" ? "^" : symbol]);
    }
    position = TOKEN.lastIndex;
  }
  return tokens;
}

function isUnit(word) {
  return typeof word === "string" && Object.prototype.hasOwnProperty.call(UNITS, word);
}

class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.index = 0;
  }

  peek() {
    return this.index < this.tokens.length ? this.tokens[this.index] : [null, null];
  }

  isOp(symbol) {
    const [kind, value] = this.peek();
    return kind === "op" && value === symbol;
  }

  take() {
    const token = this.peek();
    this.index += 1;
    return token;
  }

  expect(symbol) {
    const [kind, value] = this.take();
    if (kind !== "op" || value !== symbol) {
      throw new CalcError(`Expected '${symbol}'.`);
    }
  }

  parse() {
    const result = this.expr();
    if (this.index !== this.tokens.length) {
      throw new CalcError("Something is left over at the end. Check the brackets.");
    }
    return result;
  }

  expr() {
    let result = this.term();
    while (this.isOp("+") || this.isOp("-")) {
      const operator = this.take()[1];
      const right = this.term();
      result = operator === "+" ? result.add(right) : result.sub(right);
    }
    return result;
  }

  term() {
    let result = this.unary();
    while (this.isOp("*") || this.isOp("/")) {
      const operator = this.take()[1];
      const right = this.unary();
      result = operator === "*" ? result.mul(right) : result.div(right);
    }
    return result;
  }

  unary() {
    if (this.isOp("-")) {
      this.take();
      const value = this.unary();
      return new Quantity(-value.value, value.dims);
    }
    if (this.isOp("+")) {
      this.take();
    }
    return this.power();
  }

  power() {
    const base = this.atom();
    if (this.isOp("^")) {
      this.take();
      return base.power(this.unary()); // right-associative, allows 2^-1
    }
    return base;
  }

  atom() {
    const [kind, value] = this.take();
    if (kind === "num") {
      let quantity = new Quantity(value);
      // "20 mm", "9.81 m/s^2" style: units that follow a number belong to it.
      while (this.peek()[0] === "word" && isUnit(this.peek()[1])) {
        quantity = quantity.mul(this.unitPower());
        if (this.isOp("/") && this.nextIsUnit()) {
          this.take();
          quantity = quantity.div(this.unitPower());
        }
      }
      return quantity;
    }
    if (kind === "word") {
      const word = value;
      if (Object.prototype.hasOwnProperty.call(FUNCTIONS, word)) {
        this.expect("(");
        const inner = this.expr();
        this.expect(")");
        return applyFunction(word, inner);
      }
      if (Object.prototype.hasOwnProperty.call(CONSTANTS, word)) {
        return new Quantity(CONSTANTS[word]);
      }
      if (isUnit(word)) {
        this.index -= 1;
        return this.unitPower();
      }
      throw new CalcError(`Unknown unit or name '${word}'.`);
    }
    if (kind === "op" && value === "(") {
      const inner = this.expr();
      this.expect(")");
      return inner;
    }
    throw new CalcError("The expression is incomplete.");
  }

  nextIsUnit() {
    const following = this.index + 1 < this.tokens.length ? this.tokens[this.index + 1] : [null, null];
    return following[0] === "word" && isUnit(following[1]);
  }

  unitPower() {
    const [factor, unitDims] = UNITS[this.take()[1]];
    let unit = new Quantity(factor, unitDims);
    if (this.isOp("^")) {
      this.take();
      let sign = 1;
      if (this.isOp("-")) {
        this.take();
        sign = -1;
      }
      const [kind, exponent] = this.take();
      if (kind !== "num") {
        throw new CalcError("A unit power must be a number, like mm^2.");
      }
      unit = unit.power(new Quantity(sign * exponent));
    }
    return unit;
  }
}

function applyFunction(name, quantity) {
  if (name === "sqrt") {
    if (quantity.value < 0) {
      throw new CalcError("Square root of a negative number.");
    }
    return new Quantity(Math.sqrt(quantity.value), quantity.dims.map((power) => power / 2));
  }
  if (name === "abs") {
    return new Quantity(Math.abs(quantity.value), quantity.dims);
  }
  if (key(quantity.dims) !== key(NONE)) {
    throw new CalcError(`${name}() needs a plain number (or an angle in rad/deg).`);
  }
  const result = FUNCTIONS[name](quantity.value);
  if (!Number.isFinite(result)) {
    throw new CalcError(`${name}() is not defined there.`);
  }
  return new Quantity(result);
}

function evaluate(text) {
  if (text.length > MAX_LENGTH) {
    throw new CalcError(`Keep it under ${MAX_LENGTH} characters.`);
  }
  return new Parser(tokenize(text)).parse();
}

export function fmt(value) {
  if (value === 0) {
    return "0";
  }
  const size = Math.abs(value);
  if (size >= 1e-3 && size < 1e7) {
    let text = formatG(value, 6);
    if (text.includes("e")) {
      // 3600000 reads better than 3.6e+06 in this range
      text = value.toFixed(0);
    }
    return text;
  }
  const [mantissa, exponentPart] = value.toExponential(4).split("e");
  return mantissa + "e" + exponentText(parseInt(exponentPart, 10));
}

/** 'expression [to unit]' -> result text. Throws CalcError. */
export function calculate(input) {
  const text = input.trim();
  if (!text) {
    throw new CalcError("Give me something to calculate, e.g. /calc 12 kN / (20 mm * 5 mm) to MPa");
  }
  let expression = text;
  let target = "";
  const split = /\s+(?:to|->)\s+/.exec(text);
  if (split) {
    expression = text.slice(0, split.index);
    target = text.slice(split.index + split[0].length);
  }
  const result = evaluate(expression);
  if (target) {
    const unit = evaluate(target);
    if (key(unit.dims) !== key(result.dims)) {
      throw new CalcError(`The result is ${describe(result.dims)}, which cannot be shown in ${target.trim()}.`);
    }
    return `${fmt(result.value / unit.value)} ${target.trim()}`;
  }
  if (key(result.dims) === key(NONE)) {
    return fmt(result.value);
  }
  const name = NAMED[key(result.dims)];
  if (name && PRETTY_PREFIXES[name]) {
    const [pretty, factor] = PRETTY_PREFIXES[name];
    if (Math.abs(result.value) >= factor) {
      return `${fmt(result.value / factor)} ${pretty}`;
    }
  }
  return `${fmt(result.value)} ${name || siUnit(result.dims)}`;
}
