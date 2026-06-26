/**
 * Validates the config → brew-frames path: a RecipeConfig for Recipe C must
 * produce exactly the four frames captured from the real machine.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildBrewFrames } from '../src/brew.js';
import type { RecipeConfig } from '../src/config.js';

const CAPTURED = [
  '580101a61f18000000010000000000000000120000007eb5', // SET_BYPASS
  '580101a81f14000000010000dc420000b44221a1', // SET_CUP (110/90)
  '580101411f2f0000000120375d0000d8003c235f5d0100ec000023555c0200ec000023475c0200fb00002324aa527a', // SEND_AUTO
  '580101421f0c000000017fcf', // EXECUTE
];

const RECIPE_C: RecipeConfig = {
  name: 'Recipe C',
  cupType: 'other',
  doseGrams: 18,
  grinderSize: 36,
  rpm: 60,
  ratio: 17,
  cupMax: 110,
  cupMin: 90,
  pours: [
    { volume: 55, temperature: 93, flowRate: 3.5, pausing: 40, pattern: 0 },
    { volume: 95, temperature: 93, flowRate: 3.5, pausing: 20, pattern: 1 },
    { volume: 85, temperature: 92, flowRate: 3.5, pausing: 20, pattern: 2 },
    { volume: 71, temperature: 92, flowRate: 3.5, pausing: 5, pattern: 2 },
  ],
};

test('buildBrewFrames(Recipe C config) matches the captured brew', () => {
  const hex = buildBrewFrames(RECIPE_C).map((f) => f.buf.toString('hex'));
  assert.deepEqual(hex, CAPTURED);
});
