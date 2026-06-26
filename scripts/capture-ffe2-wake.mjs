/**
 * Records FFE2 return data. The machine streams nothing at idle, so this sends
 * ONE benign frame — RD_BACK_TO_HOME (8022), no grind/pour — to elicit the
 * status dump, then logs every returned frame (raw + code/name + decoded values)
 * to console and data/ffe2-capture.log.
 *
 * Only that single benign frame is ever written (asserted before sending).
 * Usage: node scripts/capture-ffe2-wake.mjs [ADDRESS] [SECONDS]
 */
import { BleTransport } from '../dist/ble.js';
import { XBloomCommand } from '../dist/protocol/constants.js';
import { buildCommand } from '../dist/protocol/frame.js';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';

const address = process.argv[2] ?? 'AA:BB:CC:DD:EE:FF';
const seconds = Number(process.argv[3] ?? 20);
const WAKE_EXPECTED = '580101561f0c00000001c015';

const NAMES = {
  8001: 'RECIPE_SEND_AUTO', 8002: 'RECIPE_EXECUTE', 8007: 'RD_BREWER_IN',
  8009: 'RD_MachineSleeping', 8011: 'RD_MachineNotSleeping', 8022: 'RD_BackToHome',
  8023: 'RD_MachineActivity', 8102: 'SET_BYPASS', 8104: 'SET_CUP', 8105: 'RD_GRINDER_SIZE',
  8106: 'RD_GRINDER_SPEED', 8107: 'RD_BREWER_MODE', 8108: 'RD_BREWER_TEMPERATURE',
  8204: 'ERR_bad_dose', 9000: 'at_grinder', 9001: 'at_brewer', 9003: 'grinding',
  9005: 'brewing', 40507: 'grind_done', 40511: 'brew_done', 40512: 'complete',
  40517: 'ERR_no_beans', 40522: 'ERR_tank_empty', 40523: 'RD_grinder?', 40526: 'RD_CurrentGrinder',
  20501: 'telemetry?',
};

mkdirSync('data', { recursive: true });
const LOG = 'data/ffe2-capture.log';
writeFileSync(LOG, `# FFE2 capture ${new Date().toISOString()} ${address}\n`);

const log = { info: (...a) => console.log('[info]', ...a), warn: (...a) => console.warn(...a), error: (...a) => console.error(...a) };
const start = Date.now();
const counts = {};

function record(buf) {
  const cmd = buf.length >= 5 ? buf.readUInt16LE(3) : -1;
  const payload = buf.length > 12 ? buf.subarray(10, -2) : Buffer.alloc(0);
  const vals = [];
  for (let i = 0; i + 4 <= payload.length; i += 4) {
    const u = payload.readUInt32LE(i);
    const f = payload.readFloatLE(i);
    vals.push(Number.isFinite(f) && Math.abs(f) < 1e6 && f !== 0 ? `${u}/${f.toFixed(2)}f` : `${u}`);
  }
  counts[cmd] = (counts[cmd] ?? 0) + 1;
  const t = ((Date.now() - start) / 1000).toFixed(2).padStart(6);
  const line = `${t}s cmd=${String(cmd).padEnd(5)} ${(NAMES[cmd] ?? '?').padEnd(20)} payload=${payload.toString('hex')} ${vals.length ? '[' + vals.join(' ') + ']' : ''}`;
  console.log(line);
  appendFileSync(LOG, buf.toString('hex') + '  ' + line + '\n');
}

const wake = buildCommand(XBloomCommand.RD_BACK_TO_HOME, []);
if (wake.toString('hex') !== WAKE_EXPECTED) {
  console.error(`ABORT: wake frame ${wake.toString('hex')} != ${WAKE_EXPECTED}`);
  process.exit(1);
}

const t = new BleTransport(log, { address, discoverTimeoutSec: 30 });
t.onNotify((n) => record(n.raw));
try {
  console.log(`Connecting to ${address}…`);
  await t.open();
  console.log('Sending benign wake (RD_BACK_TO_HOME) to elicit telemetry…\n');
  await t.send(wake);
  await new Promise((r) => setTimeout(r, seconds * 1000));
  console.log('\n=== SUMMARY (frames per code) ===');
  for (const [cmd, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(cmd).padEnd(6)} ${(NAMES[cmd] ?? '?').padEnd(20)} ${n}`);
  }
  console.log(`\nSaved raw frames → ${LOG}`);
} catch (err) {
  console.error('CAPTURE FAILED:', err?.message ?? err);
  process.exitCode = 1;
} finally {
  await t.close();
  console.log('disconnected.');
}
