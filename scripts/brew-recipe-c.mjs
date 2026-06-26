/**
 * LIVE BREW — Recipe C. Sends the 4-frame brew sequence and brews real coffee.
 *
 * Safety: frames are regenerated from the Recipe C config via the plugin's own
 * buildBrewFrames(), then EACH is asserted equal to the validated captured bytes
 * before ANY frame is sent. Any mismatch aborts before transmitting.
 *
 * Usage: node scripts/brew-recipe-c.mjs [ADDRESS]
 */
import { BleTransport } from '../dist/ble.js';
import { buildBrewFrames } from '../dist/brew.js';

const address = process.argv[2] ?? 'AA:BB:CC:DD:EE:FF';

// Validated capture (XBLOOM 123456, official app brewing Recipe C).
const EXPECTED = [
  '580101a61f18000000010000000000000000120000007eb5', // SET_BYPASS
  '580101a81f14000000010000dc420000b44221a1', // SET_CUP
  '580101411f2f0000000120375d0000d8003c235f5d0100ec000023555c0200ec000023475c0200fb00002324aa527a', // SEND_AUTO
  '580101421f0c000000017fcf', // EXECUTE
];

const RECIPE_C = {
  name: 'Recipe C', cupType: 'other', doseGrams: 18, grinderSize: 36, rpm: 60, ratio: 17,
  cupMax: 110, cupMin: 90,
  pours: [
    { volume: 55, temperature: 93, flowRate: 3.5, pausing: 40, pattern: 0 },
    { volume: 95, temperature: 93, flowRate: 3.5, pausing: 20, pattern: 1 },
    { volume: 85, temperature: 92, flowRate: 3.5, pausing: 20, pattern: 2 },
    { volume: 71, temperature: 92, flowRate: 3.5, pausing: 5, pattern: 2 },
  ],
};

const log = {
  info: (...a) => console.log('[info]', ...a),
  warn: (...a) => console.warn('[warn]', ...a),
  error: (...a) => console.error('[error]', ...a),
};

// Build + verify before connecting.
const frames = buildBrewFrames(RECIPE_C);
console.log('Verifying frames against validated capture…');
for (let i = 0; i < EXPECTED.length; i++) {
  const got = frames[i].buf.toString('hex');
  const ok = got === EXPECTED[i];
  console.log(`  ${ok ? 'OK ' : 'BAD'} ${frames[i].label.padEnd(26)} ${got}`);
  if (!ok) {
    console.error(`ABORT: frame ${i} mismatch. Expected ${EXPECTED[i]}. Nothing sent.`);
    process.exit(1);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const delays = [500, 500, 2000, 0]; // gaps AFTER each frame (matches app: pause before EXECUTE)

const t = new BleTransport(log, { address, discoverTimeoutSec: 30 });
t.onNotify((n) => {
  const tag = n.state !== 'unknown' ? `  <<< ${n.state.toUpperCase()}` : '';
  if (n.error) console.log(`  FFE2 cmd=${n.command} ERROR: ${n.error}`);
  else if (n.state !== 'unknown') console.log(`  FFE2 cmd=${n.command} state=${n.state}${tag}`);
});

try {
  console.log(`\nConnecting to ${address}…`);
  await t.open();
  console.log('Sending brew sequence:');
  for (let i = 0; i < frames.length; i++) {
    console.log(`  → ${frames[i].label}`);
    await t.send(frames[i].buf);
    if (delays[i]) await sleep(delays[i]);
  }
  console.log('\nBrew started. Watching status for 45s (grind → brew)…');
  await sleep(45000);
  console.log('\n=== done watching (machine continues brewing on its own) ===');
} catch (err) {
  console.error('BREW FAILED:', err?.message ?? err);
  process.exitCode = 1;
} finally {
  await t.close();
  console.log('disconnected.');
}
