/**
 * Policy checks for morning-brief signoffs (I-1). Run: npm run test:signoff
 */
import assert from "node:assert/strict";
import {
  signoffBandForLocalHour,
  validateSignoffCompliance,
} from "../lib/signoffPolicy";

assert.equal(signoffBandForLocalHour(8), "morning");
assert.equal(signoffBandForLocalHour(12), "midday");
assert.equal(signoffBandForLocalHour(17), "wrap_up");
assert.equal(signoffBandForLocalHour(22), "neutral_off_hours");

assert.notEqual(
  validateSignoffCompliance("Get some rest before tomorrow.", 1).length,
  0
);
assert.equal(
  validateSignoffCompliance("Two items flagged for tomorrow — else can wait.", 1).length,
  0
);

assert.notEqual(
  validateSignoffCompliance("Good morning — recap the desk.", 14).length,
  0
);

assert.equal(
  validateSignoffCompliance("Good morning — recap the desk.", 8).length,
  0
);

console.log("test:signoff — OK");
