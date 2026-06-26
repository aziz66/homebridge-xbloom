/**
 * Validates recipe consistency checks: dose × ratio must equal total pour water,
 * and ratio must be 1:5–1:25 in 0.5 steps.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { checkRecipe, recipeErrors, targetWaterMl, totalPourMl, type RecipeConfig } from '../src/config.js';

const base: RecipeConfig = {
  name: 'C', cupType: 'other', doseGrams: 18, grinderSize: 36, rpm: 60, ratio: 17,
  pours: [
    { volume: 55, temperature: 93, flowRate: 3.5, pausing: 40, pattern: 0 },
    { volume: 95, temperature: 93, flowRate: 3.5, pausing: 20, pattern: 1 },
    { volume: 85, temperature: 92, flowRate: 3.5, pausing: 20, pattern: 2 },
    { volume: 71, temperature: 92, flowRate: 3.5, pausing: 5, pattern: 2 },
  ],
};

test('consistent recipe (18g × 17 = 306 ml = pours) → no warnings', () => {
  assert.equal(targetWaterMl(base), 306);
  assert.equal(totalPourMl(base), 306);
  assert.deepEqual(checkRecipe(base), []);
});

test('water mismatch warns and reports the actual ratio', () => {
  const r = { ...base, pours: base.pours.map((p, i) => (i === 0 ? { ...p, volume: 20 } : p)) };
  // total now 271, target 306
  const w = checkRecipe(r);
  assert.equal(w.length, 1);
  assert.match(w[0], /271 ml ≠ dose × ratio/);
  assert.match(w[0], /306 ml/);
});

test('ratio out of range warns', () => {
  assert.ok(checkRecipe({ ...base, ratio: 30, doseGrams: 10, pours: [{ volume: 300, temperature: 93, flowRate: 3.5, pausing: 0, pattern: 0 }] })
    .some((w) => /outside the supported/.test(w)));
});

test('ratio off the 0.5 step warns', () => {
  assert.ok(checkRecipe({ ...base, ratio: 17.3 }).some((w) => /0\.5 steps/.test(w)));
});

test('recipeErrors: valid recipe has none', () => {
  assert.deepEqual(recipeErrors(base), []);
});

test('recipeErrors: out-of-range fields are caught', () => {
  const bad: RecipeConfig = {
    ...base, doseGrams: 99, grinderSize: 200, rpm: 65,
    pours: [{ volume: 500, temperature: 200, flowRate: 30, pausing: -5, pattern: 9 as 0 }],
  };
  const errs = recipeErrors(bad);
  assert.ok(errs.some((e) => /doseGrams/.test(e)));
  assert.ok(errs.some((e) => /grinderSize/.test(e)));
  assert.ok(errs.some((e) => /rpm/.test(e)));
  assert.ok(errs.some((e) => /volume/.test(e)));
  assert.ok(errs.some((e) => /temperature/.test(e)));
  assert.ok(errs.some((e) => /flowRate/.test(e)));
  assert.ok(errs.some((e) => /pattern/.test(e)));
  assert.ok(errs.some((e) => /pausing/.test(e)));
});
