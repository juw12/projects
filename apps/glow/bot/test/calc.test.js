// /calc: sums with units. The answers below were worked out by hand; the refusals are the exact words
// the chat shows.

import test from "node:test";
import assert from "node:assert/strict";

import { CalcError, calculate } from "../src/calc.js";

const ANSWERS = [
  ["12 kN / (20 mm * 5 mm) to MPa", "120 MPa"],
  ["0.5 * 1200 kg * (25 m/s)^2 to kJ", "375 kJ"],
  ["2 * pi * 1500 rpm * 20 N*m to kW", "3.14159 kW"],
  ["sqrt(2 * 9.81 m/s^2 * 3 m)", "7.67203 m/s"],
  ["1 in to mm", "25.4 mm"],
  ["100 psi to bar", "6.89476 bar"],
  ["5 kN", "5 kN"],
  ["2500 N", "2.5 kN"],
  ["12 kN / 20 mm", "600000 N/m"],
  ["7850 kg / (1 m^3)", "7850 kg/m^3"],
  ["sin(30 deg)", "0.5"],
  ["2^-1", "0.5"],
  ["3 * (4 + 5)", "27"],
  ["1 kWh to J", "3600000 J"],
];

const REFUSALS = [
  ["3 m + 2 s", "Cannot add m and s."],
  ["5 N to mm", "The result is N, which cannot be shown in mm."],
  ["1/0", "Division by zero."],
  ["foo + 2", "Unknown unit or name 'foo'."],
  ["sin(2 m)", "sin() needs a plain number (or an angle in rad/deg)."],
  ["(1 + 2", "Expected ')'."],
  ["2 ^ 50", "Exponent too large."],
  ["__import__(1)", "Unknown unit or name '__import__'."],
  ["", "Give me something to calculate, e.g. /calc 12 kN / (20 mm * 5 mm) to MPa"],
];

for (const [sum, answer] of ANSWERS) {
  test(`calc: ${sum} is ${answer}`, () => {
    assert.equal(calculate(sum), answer);
  });
}

for (const [sum, message] of REFUSALS) {
  test(`calc: "${sum}" is refused in plain words`, () => {
    assert.throws(
      () => calculate(sum),
      (error) => error instanceof CalcError && error.message === message,
    );
  });
}

test("calc: a sum nested too deep is refused, not a crash", () => {
  assert.throws(() => calculate("(".repeat(150) + "1" + ")".repeat(150)), CalcError);
});

test("calc: a very long sum is refused, not a crash", () => {
  assert.throws(() => calculate("1+".repeat(150) + "1"), CalcError);
});
