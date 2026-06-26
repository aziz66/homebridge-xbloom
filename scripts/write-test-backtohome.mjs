/**
 * BENIGN WRITE TEST — sends EXACTLY ONE frame: RD_BACK_TO_HOME (8022).
 * This is the same harmless "back to home" command the official app sends.
 * It does NOT grind, pour, or brew. No other frame is ever written.
 *
 * Safety: the frame is rebuilt from the protocol layer and asserted to equal
 * the known-good bytes before anything is sent; mismatch aborts.
 *
 * Usage: node scripts/write-test-backtohome.mjs [ADDRESS]
 */
import { BleTransport } from '../dist/ble.js';
import { XBloomCommand } from '../dist/protocol/constants.js';
import { buildCommand } from '../dist/protocol/frame.js';

const address = process.argv[2] ?? 'AA:BB:CC:DD:EE:FF';
const EXPECTED = '580101561f0c00000001c015'; // RD_BACK_TO_HOME, from the app capture

const log = {
  info: (...a) => console.log('[info]', ...a),
  warn: (...a) => console.warn('[warn]', ...a),
  error: (...a) => console.error('[error]', ...a),
};

const frame = buildCommand(XBloomCommand.RD_BACK_TO_HOME, []);
const hex = frame.toString('hex');
console.log(`Frame to send: ${hex}`);
if (hex !== EXPECTED) {
  console.error(`ABORT: frame ${hex} != expected ${EXPECTED}. Refusing to send.`);
  process.exit(1);
}

const t = new BleTransport(log, { address, discoverTimeoutSec: 30 });
const replies = [];
t.onNotify((n) => replies.push({ command: n.command, state: n.state, hex: n.raw.toString('hex') }));

try {
  console.log(`Connecting to ${address}…`);
  await t.open();
  console.log('Sending the single RD_BACK_TO_HOME frame…');
  await t.send(frame);
  console.log('Sent. Watching FFE2 for a reply (4s)…');
  await new Promise((r) => setTimeout(r, 4000));
  console.log('\n=== RESULT ===');
  console.log(`write accepted (no error thrown): YES`);
  console.log(`FFE2 replies: ${replies.length}`);
  for (const r of replies.slice(0, 10)) console.log(`  cmd=${r.command} state=${r.state}  ${r.hex}`);
  console.log('\nWRITE PATH OK ✓ (one benign frame sent, no grind/brew)');
} catch (err) {
  console.error('WRITE TEST FAILED:', err?.message ?? err);
  process.exitCode = 1;
} finally {
  await t.close();
  console.log('disconnected.');
}
