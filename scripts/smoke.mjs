/**
 * READ-ONLY BLE smoke test. Connects to the machine, subscribes to FFE2 status
 * notifications, observes them for a few seconds, then disconnects.
 * It NEVER writes to FFE1 — no command/brew is ever sent.
 *
 * Usage: node scripts/smoke.mjs [ADDRESS] [SECONDS]
 * Run from the project root after `npm run build`.
 */
import { BleTransport } from '../dist/ble.js';

const address = process.argv[2] ?? 'AA:BB:CC:DD:EE:FF';
const seconds = Number(process.argv[3] ?? 6);

const log = {
  info: (...a) => console.log('[info]', ...a),
  warn: (...a) => console.warn('[warn]', ...a),
  error: (...a) => console.error('[error]', ...a),
};

const t = new BleTransport(log, { address, discoverTimeoutSec: 30 });

let count = 0;
const samples = [];
t.onNotify((n) => {
  count++;
  if (samples.length < 8) samples.push({ command: n.command, state: n.state, hex: n.raw.toString('hex') });
});

try {
  console.log(`Connecting to ${address} (read-only, no writes)…`);
  await t.open();
  console.log('Reading FFE2 (read-only)…');
  let readHex = '';
  try {
    readHex = (await t.probe()).toString('hex');
    console.log(`  FFE2 read returned ${readHex.length / 2} bytes: ${readHex || '(empty)'}`);
  } catch (e) {
    console.log('  FFE2 read not supported / failed:', e?.message ?? e);
  }
  console.log(`Observing FFE2 notifications for ${seconds}s…`);
  await new Promise((r) => setTimeout(r, seconds * 1000));
  console.log(`\n=== RESULT ===`);
  console.log(`notifications received: ${count}`);
  for (const s of samples) console.log(`  cmd=${s.command} state=${s.state}  ${s.hex}`);
  // Success = connected + GATT discovered + subscribed (read path proven). Idle
  // streams nothing, so notifications are a bonus, not the pass condition.
  console.log('\nCONNECT + GATT + SUBSCRIBE OK ✓ (read-only, no writes sent)');
} catch (err) {
  console.error('SMOKE FAILED:', err?.message ?? err);
  process.exitCode = 1;
} finally {
  await t.close();
  console.log('disconnected.');
}
