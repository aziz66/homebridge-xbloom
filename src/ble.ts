/**
 * BLE transport via node-ble (D-Bus / BlueZ client — coexists with bluetoothd).
 *
 * Discovers the machine, opens its vendor GATT service, writes commands to FFE1
 * and subscribes to status notifications on FFE2.
 */

import { createBluetooth } from 'node-ble';
import type { Logging } from 'homebridge';
import { parseNotification, type ParsedNotification } from './protocol/parser.js';
import type { Transport } from './transport.js';

const SERVICE_UUID = '0000e0ff-3c17-d293-8e48-14fe2e4da212';
const WRITE_UUID = '0000ffe1-0000-1000-8000-00805f9b34fb'; // FFE1, write / write-without-response
const NOTIFY_UUID = '0000ffe2-0000-1000-8000-00805f9b34fb'; // FFE2, notify

export interface BleOptions {
  /** BLE MAC, e.g. "AA:BB:CC:DD:EE:FF". Required for connect. */
  address?: string;
  /** Seconds to wait for the device to appear during discovery. */
  discoverTimeoutSec?: number;
  /**
   * Custom D-Bus system bus address (e.g. "unix:path=/run/host-dbus/system_bus_socket").
   * Only needed for Dockerized Homebridge, to reach the HOST's bluetoothd. Applied to
   * this process only — the container's own avahi/D-Bus is left untouched.
   */
  dbusAddress?: string;
}

export class BleTransport implements Transport {
  readonly dryRun = false;
  // node-ble has no bundled types; keep handles loosely typed.
  private bluetooth: ReturnType<typeof createBluetooth>['bluetooth'] | null = null;
  private destroyFn: (() => void) | null = null;
  private device: any = null;
  private writeChar: any = null;
  private notifyChar: any = null;
  private notifyCb: ((n: ParsedNotification) => void) | null = null;
  private connected = false;

  constructor(
    private readonly log: Logging,
    private readonly opts: BleOptions,
  ) {}

  isConnected(): boolean {
    return this.connected;
  }

  async open(): Promise<void> {
    if (this.connected) return;
    if (!this.opts.address) {
      throw new Error('deviceAddress is required for BLE (e.g. AA:BB:CC:DD:EE:FF)');
    }
    const address = this.opts.address.toUpperCase();

    // Point node-ble at a specific system bus if configured (Docker → host bluetoothd).
    // Set on this process only; dbus-next reads it when the bus is created.
    if (this.opts.dbusAddress) {
      process.env.DBUS_SYSTEM_BUS_ADDRESS = this.opts.dbusAddress;
    }

    const { bluetooth, destroy } = createBluetooth();
    this.bluetooth = bluetooth;
    this.destroyFn = destroy;

    // dbus-next's MessageBus emits 'error' on connection failures; without a
    // listener Node turns it into an uncaught exception that crashes the child
    // bridge. Capture it so it surfaces as a normal, catchable failure instead.
    let busError: Error | undefined;
    const bus = (bluetooth as unknown as { dbus?: { on?: (e: string, cb: (e: Error) => void) => void } })?.dbus;
    bus?.on?.('error', (e: Error) => {
      busError = e;
      this.connected = false;
    });

    let adapter;
    try {
      adapter = await bluetooth.defaultAdapter();
    } catch (err) {
      throw this.bluezError(busError ?? err);
    }
    if (!(await adapter.isPowered())) {
      throw new Error('Bluetooth adapter is not powered on (run: bluetoothctl power on)');
    }
    if (!(await adapter.isDiscovering())) await adapter.startDiscovery();

    const timeoutMs = (this.opts.discoverTimeoutSec ?? 30) * 1000;
    this.log.info(`[ble] waiting for ${address} …`);
    this.device = await adapter.waitDevice(address, timeoutMs);
    await this.device.connect();
    this.connected = true;
    this.device.once?.('disconnect', () => {
      this.connected = false;
      this.log.info('[ble] device disconnected');
    });
    this.log.info('[ble] connected');

    const gatt = await this.device.gatt();
    const service = await gatt.getPrimaryService(SERVICE_UUID);
    this.writeChar = await service.getCharacteristic(WRITE_UUID);
    this.notifyChar = await service.getCharacteristic(NOTIFY_UUID);

    await this.notifyChar.startNotifications();
    this.notifyChar.on('valuechanged', (buf: Buffer) => {
      const n = parseNotification(Buffer.from(buf));
      if (n && this.notifyCb) this.notifyCb(n);
    });
    this.log.info('[ble] FFE1 write + FFE2 notify ready');
  }

  async send(frame: Buffer): Promise<void> {
    if (!this.writeChar) throw new Error('BLE not open');
    // write-without-response (matches the official app)
    await this.writeChar.writeValueWithoutResponse(frame);
  }

  onNotify(cb: (n: ParsedNotification) => void): void {
    this.notifyCb = cb;
  }

  /** Read-only diagnostic: read FFE2's current value (it is readable). */
  async probe(): Promise<Buffer> {
    if (!this.notifyChar) throw new Error('BLE not open');
    const v = await this.notifyChar.readValue();
    return Buffer.from(v);
  }

  /** Turn a raw D-Bus failure into actionable guidance. */
  private bluezError(err: unknown): Error {
    const e = err as { message?: string; text?: string };
    const msg = e?.text ?? e?.message ?? String(err);
    if (/AppArmor/i.test(msg)) {
      return new Error(
        'Blocked by AppArmor: the Docker container is not allowed to reach the host Bluetooth. ' +
        'Add `security_opt: ["apparmor=unconfined"]` to the Homebridge service in your ' +
        'docker-compose and recreate the container — see ' +
        'https://github.com/aziz66/homebridge-xbloom#docker-homebridge. ' +
        `[underlying: ${msg}]`,
      );
    }
    if (/org\.bluez|ServiceUnknown|no .*adapter/i.test(msg)) {
      return new Error(
        'Bluetooth (org.bluez) is not reachable on the D-Bus. ' +
        'If Homebridge runs in Docker, mount the host D-Bus socket into the container and set ' +
        '"dbusAddress" in the plugin config — see https://github.com/aziz66/homebridge-xbloom#docker-homebridge. ' +
        'Otherwise ensure BlueZ is running (sudo systemctl start bluetooth). ' +
        `[underlying: ${msg}]`,
      );
    }
    return err instanceof Error ? err : new Error(msg);
  }

  async close(): Promise<void> {
    try {
      if (this.notifyChar) await this.notifyChar.stopNotifications().catch(() => {});
      if (this.device) await this.device.disconnect().catch(() => {});
    } finally {
      this.connected = false;
      this.destroyFn?.();
      this.bluetooth = null;
      this.device = null;
      this.writeChar = null;
      this.notifyChar = null;
    }
  }
}
