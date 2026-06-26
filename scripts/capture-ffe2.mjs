/**
 * READ-ONLY FFE2 recorder. Connects, subscribes to status notifications, and
 * logs EVERY frame (raw hex + command code/name + decoded payload values) to
 * console and data/ffe2-capture.log. Never writes to FFE1.
 *
 * Usage: node scripts/capture-ffe2.mjs [ADDRESS] [SECONDS]
 */
import { createBluetooth } from 'node-ble';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';

const address = (process.argv[2] ?? 'AA:BB:CC:DD:EE:FF').toUpperCase();
const seconds = Number(process.argv[3] ?? 30);

const SERVICE = '0000e0ff-3c17-d293-8e48-14fe2e4da212';
const NOTIFY = '0000ffe2-0000-1000-8000-00805f9b34fb';

// Known command/status codes (PyBloom + xbloom-ai-brew + our captures).
const NAMES = {
  8001: 'RECIPE_SEND_AUTO', 8002: 'RECIPE_EXECUTE', 8004: 'RECIPE_SEND_MANUAL',
  8007: 'RD_BREWER_IN', 8009: 'RD_MachineSleeping', 8011: 'RD_MachineNotSleeping',
  8022: 'RD_BackToHome', 8023: 'RD_MachineActivity', 8102: 'SET_BYPASS', 8104: 'SET_CUP',
  8105: 'RD_GRINDER_SIZE', 8106: 'RD_GRINDER_SPEED', 8107: 'RD_BREWER_MODE',
  8108: 'RD_BREWER_TEMPERATURE', 8204: 'ERR_bad_dose',
  9000: 'at_grinder', 9001: 'at_brewer', 9003: 'grinding', 9005: 'brewing',
  40507: 'grind_done', 40511: 'brew_done', 40512: 'complete',
  40517: 'ERR_no_beans', 40522: 'ERR_tank_empty', 40523: 'RD_grinder?', 40526: 'RD_CurrentGrinder',
  20501: 'telemetry?',
};

mkdirSync('data', { recursive: true });
const LOG = 'data/ffe2-capture.log';
writeFileSync(LOG, `# FFE2 capture ${new Date().toISOString()} ${address}\n`);

function decode(buf) {
  // inbound: 58 | devid | type | cmd(LE16) | len(LE32) | const | payload | crc(LE16)
  const cmd = buf.length >= 5 ? buf.readUInt16LE(3) : -1;
  const payload = buf.length > 12 ? buf.subarray(10, -2) : Buffer.alloc(0);
  const vals = [];
  for (let i = 0; i + 4 <= payload.length; i += 4) {
    const u = payload.readUInt32LE(i);
    const f = payload.readFloatLE(i);
    vals.push(Number.isFinite(f) && Math.abs(f) < 1e6 && f !== 0 ? `${u}/${f.toFixed(2)}f` : `${u}`);
  }
  return { cmd, name: NAMES[cmd] ?? '?', payload: payload.toString('hex'), vals };
}

const start = Date.now();
const counts = {};
function record(buf) {
  const d = decode(buf);
  counts[d.cmd] = (counts[d.cmd] ?? 0) + 1;
  const t = ((Date.now() - start) / 1000).toFixed(2).padStart(6);
  const line = `${t}s cmd=${String(d.cmd).padEnd(5)} ${d.name.padEnd(20)} payload=${d.payload} ${d.vals.length ? '[' + d.vals.join(' ') + ']' : ''}`;
  console.log(line);
  appendFileSync(LOG, buf.toString('hex') + '  ' + line + '\n');
}

const { bluetooth, destroy } = createBluetooth();
let device;
try {
  const adapter = await bluetooth.defaultAdapter();
  if (!(await adapter.isDiscovering())) await adapter.startDiscovery();
  console.log(`Connecting to ${address} (read-only)…`);
  device = await adapter.waitDevice(address, 30000);
  await device.connect();
  const gatt = await device.gatt();
  const svc = await gatt.getPrimaryService(SERVICE);
  const ch = await svc.getCharacteristic(NOTIFY);
  await ch.startNotifications();
  ch.on('valuechanged', (b) => record(Buffer.from(b)));
  console.log(`Subscribed. Recording FFE2 for ${seconds}s → ${LOG}\n`);
  await new Promise((r) => setTimeout(r, seconds * 1000));
  console.log('\n=== SUMMARY (frames per code) ===');
  for (const [cmd, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(cmd).padEnd(6)} ${(NAMES[cmd] ?? '?').padEnd(20)} ${n}`);
  }
} catch (err) {
  console.error('CAPTURE FAILED:', err?.message ?? err);
  process.exitCode = 1;
} finally {
  try { if (device) await device.disconnect(); } catch {}
  destroy();
  console.log('disconnected.');
}
