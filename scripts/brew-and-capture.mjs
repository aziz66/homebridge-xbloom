/**
 * LIVE BREW + full FFE2 telemetry capture. Starts Recipe C and records every
 * status/telemetry frame through grind -> brew -> complete, to console and
 * data/brew-telemetry.log. Frames are asserted against the validated capture
 * before any send. Stops on `complete` (40512) or after maxSeconds.
 *
 * Usage: node scripts/brew-and-capture.mjs [ADDRESS] [MAX_SECONDS]
 */
import { BleTransport } from '../dist/ble.js';
import { buildBrewFrames } from '../dist/brew.js';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';

const address = process.argv[2] ?? 'AA:BB:CC:DD:EE:FF';
const maxSeconds = Number(process.argv[3] ?? 270);

const EXPECTED = [
  '580101a61f18000000010000000000000000120000007eb5',
  '580101a81f14000000010000dc420000b44221a1',
  '580101411f2f0000000120375d0000d8003c235f5d0100ec000023555c0200ec000023475c0200fb00002324aa527a',
  '580101421f0c000000017fcf',
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
const NAMES = {
  8001: 'RECIPE_SEND_AUTO', 8002: 'RECIPE_EXECUTE', 8007: 'RD_BREWER_IN',
  8009: 'RD_MachineSleeping', 8011: 'RD_MachineNotSleeping', 8022: 'RD_BackToHome',
  8023: 'RD_MachineActivity', 8102: 'SET_BYPASS', 8104: 'SET_CUP', 8105: 'RD_GRINDER_SIZE',
  8106: 'RD_GRINDER_SPEED', 8107: 'RD_BREWER_MODE', 8108: 'RD_BREWER_TEMPERATURE',
  8204: 'ERR_bad_dose', 9000: 'at_grinder', 9001: 'at_brewer', 9003: 'grinding',
  9005: 'brewing', 40507: 'grind_done', 40511: 'brew_done', 40512: 'complete',
  40517: 'ERR_no_beans', 40522: 'ERR_tank_empty', 40523: 'RD_grinder?', 40526: 'RD_CurrentGrinder',
  20501: 'telemetry',
};

const log = { info: (...a) => console.log('[info]', ...a), warn: (...a) => console.warn(...a), error: (...a) => console.error(...a) };
mkdirSync('data', { recursive: true });
const LOG = 'data/brew-telemetry.log';
writeFileSync(LOG, `# brew telemetry ${new Date().toISOString()} ${address}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// verify frames first
const frames = buildBrewFrames(RECIPE_C);
for (let i = 0; i < EXPECTED.length; i++) {
  if (frames[i].buf.toString('hex') !== EXPECTED[i]) {
    console.error(`ABORT: frame ${i} mismatch. Nothing sent.`); process.exit(1);
  }
}
console.log('Frames verified against capture. OK to send.');

const start = Date.now();
const counts = {};
let complete = false;
let resolveComplete;
const completePromise = new Promise((r) => (resolveComplete = r));

function record(buf) {
  const cmd = buf.length >= 5 ? buf.readUInt16LE(3) : -1;
  const payload = buf.length > 12 ? buf.subarray(10, -2) : Buffer.alloc(0);
  const vals = [];
  for (let i = 0; i + 4 <= payload.length; i += 4) {
    const u = payload.readUInt32LE(i), f = payload.readFloatLE(i);
    vals.push(Number.isFinite(f) && Math.abs(f) < 1e6 && f !== 0 ? `${u}/${f.toFixed(1)}f` : `${u}`);
  }
  counts[cmd] = (counts[cmd] ?? 0) + 1;
  const t = ((Date.now() - start) / 1000).toFixed(1).padStart(6);
  const name = NAMES[cmd] ?? '?';
  const line = `${t}s cmd=${String(cmd).padEnd(5)} ${name.padEnd(20)} ${vals.length ? '[' + vals.join(' ') + ']' : ''}`;
  appendFileSync(LOG, buf.toString('hex') + '  ' + line + '\n');
  // Print state transitions + first few telemetry, not every repeat.
  if (name !== 'telemetry' || counts[cmd] % 10 === 1) console.log(line);
  if (cmd === 40512) { complete = true; resolveComplete(); }
}

async function openWithRetry(t, tries = 3) {
  for (let i = 1; i <= tries; i++) {
    try { await t.open(); return; }
    catch (e) {
      log.warn(`connect attempt ${i} failed: ${e?.message ?? e}`);
      if (i === tries) throw e;
      await sleep(3000);
    }
  }
}

const t = new BleTransport(log, { address, discoverTimeoutSec: 30 });
t.onNotify((n) => record(n.raw));
try {
  console.log(`Connecting to ${address}…`);
  await openWithRetry(t);
  console.log('Sending brew sequence:');
  const delays = [500, 500, 2000, 0];
  for (let i = 0; i < frames.length; i++) {
    console.log(`  -> ${frames[i].label}`);
    await t.send(frames[i].buf);
    if (delays[i]) await sleep(delays[i]);
  }
  console.log(`\nBrew started. Recording telemetry (up to ${maxSeconds}s, or until complete)…\n`);
  await Promise.race([completePromise, sleep(maxSeconds * 1000)]);
  console.log(`\n=== ${complete ? 'BREW COMPLETE (40512)' : 'watch window ended'} ===`);
  console.log('frames per code:');
  for (const [cmd, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(cmd).padEnd(6)} ${(NAMES[cmd] ?? '?').padEnd(20)} ${n}`);
  }
  console.log(`\nfull log -> ${LOG}`);
} catch (err) {
  console.error('BREW+CAPTURE FAILED:', err?.message ?? err);
  process.exitCode = 1;
} finally {
  await t.close();
  console.log('disconnected.');
}
