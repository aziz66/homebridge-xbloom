/**
 * Validates the ported protocol layer by reproducing the real frames captured
 * from XBLOOM 123456 (Android HCI snoop of the official app brewing Recipe C).
 * If every assertion passes, the TS port is byte-for-byte identical to what the
 * machine actually accepts.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { XBloomCommand, crc16 } from '../src/protocol/constants.js';
import { buildCommand, buildCommandRaw, floatBits } from '../src/protocol/frame.js';
import { encodeRecipe, type XBloomRecipe } from '../src/protocol/recipe.js';
import { parseNotification, BrewState } from '../src/protocol/parser.js';

// ── Captured frames (host → machine), hex ───────────────────────────────────
const CAPTURED = {
  SET_BYPASS: '580101a61f18000000010000000000000000120000007eb5',
  SET_CUP: '580101a81f14000000010000dc420000b44221a1',
  SEND_AUTO:
    '580101411f2f0000000120375d0000d8003c235f5d0100ec000023555c0200ec000023475c0200fb00002324aa527a',
  EXECUTE: '580101421f0c000000017fcf',
};

// ── Decoded Recipe C ────────────────────────────────────────────────────────
const RECIPE_C: XBloomRecipe = {
  grinderSize: 36,
  ratio: 17,
  rpm: 60,
  pours: [
    { volume: 55, temperature: 93, flowRate: 3.5, pausing: 40, pattern: 0 }, // bloom, center
    { volume: 95, temperature: 93, flowRate: 3.5, pausing: 20, pattern: 1 }, // circular
    { volume: 85, temperature: 92, flowRate: 3.5, pausing: 20, pattern: 2 }, // spiral
    { volume: 71, temperature: 92, flowRate: 3.5, pausing: 5, pattern: 2 }, // spiral
  ],
};
const DOSE_GRAMS = 18;

const hex = (b: Buffer) => b.toString('hex');

test('crc16 matches every captured frame', () => {
  for (const [name, h] of Object.entries(CAPTURED)) {
    const buf = Buffer.from(h, 'hex');
    const body = buf.subarray(0, -2);
    const actual = buf.readUInt16LE(buf.length - 2);
    assert.equal(crc16(body), actual, `CRC mismatch for ${name}`);
  }
});

test('SET_BYPASS frame (dose=18g) reproduces capture', () => {
  const frame = buildCommand(XBloomCommand.APP_SET_BYPASS, [0, 0, DOSE_GRAMS]);
  assert.equal(hex(frame), CAPTURED.SET_BYPASS);
});

test('SET_CUP frame (bounds 110/90) reproduces capture', () => {
  const frame = buildCommand(XBloomCommand.APP_SET_CUP, [floatBits(110), floatBits(90)]);
  assert.equal(hex(frame), CAPTURED.SET_CUP);
});

test('encodeRecipe(C) payload reproduces captured recipe body', () => {
  const capturedPayload = Buffer.from(CAPTURED.SEND_AUTO, 'hex').subarray(10, -2);
  assert.equal(hex(encodeRecipe(RECIPE_C)), hex(capturedPayload));
});

test('RECIPE_SEND_AUTO full frame reproduces capture', () => {
  const frame = buildCommandRaw(XBloomCommand.APP_RECIPE_SEND_AUTO, encodeRecipe(RECIPE_C));
  assert.equal(hex(frame), CAPTURED.SEND_AUTO);
});

test('RECIPE_EXECUTE frame reproduces capture', () => {
  const frame = buildCommand(XBloomCommand.APP_RECIPE_EXECUTE, []);
  assert.equal(hex(frame), CAPTURED.EXECUTE);
});

test('full brew sequence equals the four captured frames in order', () => {
  const seq = [
    buildCommand(XBloomCommand.APP_SET_BYPASS, [0, 0, DOSE_GRAMS]),
    buildCommand(XBloomCommand.APP_SET_CUP, [floatBits(110), floatBits(90)]),
    buildCommandRaw(XBloomCommand.APP_RECIPE_SEND_AUTO, encodeRecipe(RECIPE_C)),
    buildCommand(XBloomCommand.APP_RECIPE_EXECUTE, []),
  ].map(hex);
  assert.deepEqual(seq, [
    CAPTURED.SET_BYPASS,
    CAPTURED.SET_CUP,
    CAPTURED.SEND_AUTO,
    CAPTURED.EXECUTE,
  ]);
});

test('notification parser maps status codes', () => {
  // synthesise a "brewing" (9005) and a "no beans" (40517) inbound frame header
  const mk = (cmd: number) => {
    const b = Buffer.alloc(5);
    b.writeUInt8(0x58, 0);
    b.writeUInt8(0x07, 1);
    b.writeUInt8(0x01, 2);
    b.writeUInt16LE(cmd, 3);
    return b;
  };
  assert.equal(parseNotification(mk(9005))?.state, BrewState.Brewing);
  assert.equal(parseNotification(mk(40512))?.state, BrewState.Done);
  const err = parseNotification(mk(40517));
  assert.equal(err?.state, BrewState.Error);
  assert.equal(err?.error, 'no beans detected');
});
