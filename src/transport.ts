/**
 * Transport abstraction for talking to the machine.
 *
 * brew.ts and the platform depend only on this interface, so the BLE
 * implementation (node-ble) and the dry-run logger are interchangeable.
 */

import type { Logging } from 'homebridge';
import type { ParsedNotification } from './protocol/parser.js';

export interface Transport {
  /** True for the no-Bluetooth logger. */
  readonly dryRun: boolean;
  /** Connect / ensure ready. */
  open(): Promise<void>;
  /** Write a command frame to FFE1. */
  send(frame: Buffer): Promise<void>;
  /** Subscribe to FFE2 status notifications (set once; survives reconnects). */
  onNotify(cb: (n: ParsedNotification) => void): void;
  /** Disconnect. */
  close(): Promise<void>;
  /** Currently connected? */
  isConnected(): boolean;
}

/** Logs frames instead of sending them. Never touches Bluetooth. */
export class DryRunTransport implements Transport {
  readonly dryRun = true;
  private open_ = false;

  constructor(private readonly log: Logging) {}

  async open(): Promise<void> {
    this.open_ = true;
    this.log.info('[dry-run] transport open (no Bluetooth)');
  }

  async send(frame: Buffer): Promise<void> {
    this.log.info(`[dry-run] would write FFE1: ${frame.toString('hex')}`);
  }

  onNotify(): void {
    // No notifications in dry-run.
  }

  async close(): Promise<void> {
    this.open_ = false;
    this.log.info('[dry-run] transport closed');
  }

  isConnected(): boolean {
    return this.open_;
  }
}
