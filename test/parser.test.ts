/**
 * Validates the FFE2 parser against REAL frames captured during a Recipe C brew
 * (data/brew-telemetry.log).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseNotification, BrewState } from '../src/protocol/parser.js';

const f = (hex: string) => parseNotification(Buffer.from(hex, 'hex'));

test('decodes scale weight (20501)', () => {
  const p = f('580207155010000000c11d5a243f8680');
  assert.equal(p?.command, 20501);
  assert.equal(p?.name, 'weight');
  assert.ok(typeof p?.weightG === 'number' && p.weightG >= 0);
});

test('decodes water dispensed (40523) → 306 ml', () => {
  const p = f('5802074b9e10000000c1006a954863ed');
  assert.equal(p?.command, 40523);
  assert.equal(p?.dispensedMl, 306);
});

test('decodes pour index (40510) and marks Brewing', () => {
  for (let i = 0; i <= 3; i++) {
    // real captured frames for exact bytes:
    const real = [
      '5802073e9e10000000c100000000f367',
      '5802073e9e10000000c101000000487b',
      '5802073e9e10000000c102000000855e',
      '5802073e9e10000000c1030000003e42',
    ][i];
    const p = f(real);
    assert.equal(p?.command, 40510);
    assert.equal(p?.pourIndex, i);
    assert.equal(p?.state, BrewState.Brewing);
  }
});

test('maps lifecycle states', () => {
  assert.equal(f('5802073b9e0c000000c13993')?.state, BrewState.Grinding); // grind_done
  assert.equal(f('5802073f9e0c000000c14ffc')?.state, BrewState.Brewing); // brew_done
  assert.equal(f('580207409e0c000000c1f7f4')?.state, BrewState.Done); // complete
  assert.equal(f('580207409e0c000000c1f7f4')?.name, 'complete');
});

test('flags errors', () => {
  // synthesise a tank-empty (40522) header
  const b = Buffer.alloc(5);
  b.writeUInt8(0x58, 0); b.writeUInt8(0x07, 1); b.writeUInt8(0x02, 2);
  b.writeUInt16LE(40522, 3);
  const p = parseNotification(b);
  assert.equal(p?.state, BrewState.Error);
  assert.equal(p?.error, 'water tank empty');
});
