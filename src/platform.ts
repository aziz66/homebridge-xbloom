/**
 * xBloom dynamic platform.
 *
 * Connection model (solves the single-central contention):
 *  - No persistent connection. Each brew connects on demand, streams status,
 *    then disconnects — so the machine is free for your phone between brews.
 *  - Optional "xBloom Bluetooth" switch (hold/release) as a manual override.
 */

import type {
  API,
  Characteristic as CharacteristicClass,
  DynamicPlatformPlugin,
  Logging,
  PlatformAccessory,
  Service as ServiceClass,
} from 'homebridge';

import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';
import { type XBloomConfig, type RecipeConfig } from './config.js';
import { RecipeAccessory } from './recipeSwitch.js';
import { StopAccessory } from './stopSwitch.js';
import { ConnectionAccessory } from './connectionSwitch.js';
import { BrewingSensor } from './statusSensor.js';
import { DryRunTransport, type Transport } from './transport.js';
import { BleTransport } from './ble.js';
import { sendBrew, stopFrame } from './brew.js';
import { BrewState, type ParsedNotification } from './protocol/parser.js';

export class XBloomPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof ServiceClass;
  public readonly Characteristic: typeof CharacteristicClass;
  public readonly transport: Transport;

  // status sinks (set by their accessory classes)
  public brewingSensor?: BrewingSensor;
  public connectionAcc?: ConnectionAccessory;

  private readonly accessories = new Map<string, PlatformAccessory>();
  private readonly config: XBloomConfig;
  private readonly brewTimeoutMs: number;

  private busy = false; // a brew is in progress
  private held = false; // user toggled the connection switch ON
  private resolveComplete?: () => void;
  private readonly holdTimeoutMs: number;
  private holdTimer?: ReturnType<typeof setTimeout>;

  constructor(
    public readonly log: Logging,
    config: XBloomConfig,
    public readonly api: API,
  ) {
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;
    this.config = config;
    this.brewTimeoutMs = (config.brewTimeoutSec ?? 300) * 1000;
    this.holdTimeoutMs = (config.holdTimeoutSec ?? 300) * 1000;

    this.transport = config.dryRun
      ? new DryRunTransport(log)
      : new BleTransport(log, { address: config.deviceAddress, discoverTimeoutSec: 30 });
    this.transport.onNotify((n) => this.handleNotify(n));

    this.api.on('didFinishLaunching', () => this.discoverDevices());
  }

  configureAccessory(accessory: PlatformAccessory): void {
    this.accessories.set(accessory.UUID, accessory);
  }

  isBusy(): boolean {
    return this.busy;
  }

  // ── Brew orchestration (connect-on-demand) ─────────────────────────────
  async startBrew(recipe: RecipeConfig, onChar: { updateOn(v: boolean): void }): Promise<void> {
    if (this.busy) {
      this.log.warn(`Busy — ignoring "${recipe.name}"`);
      onChar.updateOn(false);
      return;
    }
    this.busy = true;
    this.brewingSensor?.setFault(false);
    this.brewingSensor?.setBrewing(true);
    onChar.updateOn(true);
    this.log.info(`Starting brew: ${recipe.name}`);
    try {
      await this.ensureConnected();
      await sendBrew(recipe, this.transport, this.log);
      if (!this.transport.dryRun) {
        const done = await this.waitForComplete(this.brewTimeoutMs);
        this.log.info(done
          ? `Brew "${recipe.name}" complete`
          : `Brew "${recipe.name}" watch timed out (machine continues on its own)`);
      }
    } catch (err) {
      this.log.error(`Brew "${recipe.name}" failed:`, err);
      this.brewingSensor?.setFault(true);
    } finally {
      this.busy = false;
      onChar.updateOn(false);
      this.brewingSensor?.setBrewing(false);
      this.resolveComplete = undefined;
      if (!this.held) await this.release();
    }
  }

  async stopBrew(): Promise<void> {
    try {
      await this.ensureConnected();
      this.log.info('Stop → BREW_STOP');
      await this.transport.send(stopFrame());
    } catch (err) {
      this.log.error('Stop failed:', err);
    } finally {
      if (!this.held && !this.busy) await this.release();
    }
  }

  /** Connection hold/release switch handler. */
  async setHeld(on: boolean): Promise<void> {
    if (this.holdTimer) {
      clearTimeout(this.holdTimer);
      this.holdTimer = undefined;
    }
    this.held = on;
    if (on) {
      try {
        await this.ensureConnected();
        if (this.holdTimeoutMs > 0) {
          this.holdTimer = setTimeout(() => {
            this.log.info(`Hold timeout (${this.holdTimeoutMs / 1000}s) — releasing Bluetooth`);
            void this.setHeld(false);
          }, this.holdTimeoutMs);
        }
      } catch (err) {
        this.log.error('Hold connect failed:', err);
        this.held = false;
        this.connectionAcc?.updateOn(false);
      }
    } else {
      this.connectionAcc?.updateOn(false);
      if (!this.busy) await this.release();
    }
  }

  private async ensureConnected(): Promise<void> {
    if (!this.transport.isConnected()) {
      this.log.info('[ble] connecting on demand…');
      await this.transport.open();
    }
  }

  private async release(): Promise<void> {
    if (this.transport.isConnected()) {
      await this.transport.close();
      this.connectionAcc?.updateOn(false);
    }
  }

  private waitForComplete(timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        this.resolveComplete = undefined;
        resolve(ok);
      };
      this.resolveComplete = () => finish(true);
      setTimeout(() => finish(false), timeoutMs);
    });
  }

  private handleNotify(n: ParsedNotification): void {
    if (n.error) {
      this.log.error(`xBloom: ${n.error}`);
      this.brewingSensor?.setFault(true);
    }
    if (n.state === BrewState.Grinding || n.state === BrewState.Brewing) {
      this.brewingSensor?.setBrewing(true);
    }
    if (n.pourIndex !== undefined) this.log.info(`Pour ${n.pourIndex + 1}`);
    if (n.name === 'grind_done') this.log.info('Grind done');
    if (n.command === 40523 && n.dispensedMl !== undefined) {
      this.logProgress(n.dispensedMl);
    }
    if (n.state === BrewState.Done) {
      this.log.info('Brew complete');
      this.resolveComplete?.();
    }
  }

  private lastLoggedMl = -100;
  private logProgress(ml: number): void {
    if (ml - this.lastLoggedMl >= 50) {
      this.lastLoggedMl = ml;
      this.log.info(`…${ml} ml dispensed`);
    }
  }

  // ── Accessory discovery ────────────────────────────────────────────────
  private discoverDevices(): void {
    const recipes = this.config.recipes ?? [];
    if (recipes.length === 0) this.log.warn('No recipes configured.');
    const seen = new Set<string>();

    for (const recipe of recipes) {
      if (!this.validateRecipe(recipe)) continue;
      const uuid = this.api.hap.uuid.generate(`${PLUGIN_NAME}:recipe:${recipe.name}`);
      seen.add(uuid);
      new RecipeAccessory(this, this.getOrCreate(uuid, recipe.name, { recipe }), recipe);
    }

    if (this.config.exposeStopSwitch) {
      const uuid = this.api.hap.uuid.generate(`${PLUGIN_NAME}:stop`);
      seen.add(uuid);
      new StopAccessory(this, this.getOrCreate(uuid, 'Stop Brew', { stop: true }));
    }

    if (this.config.exposeConnectionSwitch === true) {
      const uuid = this.api.hap.uuid.generate(`${PLUGIN_NAME}:connection`);
      seen.add(uuid);
      this.connectionAcc = new ConnectionAccessory(
        this, this.getOrCreate(uuid, 'xBloom Bluetooth', { connection: true }));
    }

    if (this.config.exposeBrewingSensor !== false) {
      const uuid = this.api.hap.uuid.generate(`${PLUGIN_NAME}:brewing`);
      seen.add(uuid);
      this.brewingSensor = new BrewingSensor(
        this, this.getOrCreate(uuid, 'xBloom Brewing', { brewing: true }));
    }

    for (const [uuid, accessory] of this.accessories) {
      if (!seen.has(uuid)) {
        this.log.info(`Removing stale accessory: ${accessory.displayName}`);
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        this.accessories.delete(uuid);
      }
    }
  }

  private getOrCreate(uuid: string, displayName: string, context: Record<string, unknown>): PlatformAccessory {
    const existing = this.accessories.get(uuid);
    if (existing) {
      existing.context = context;
      this.api.updatePlatformAccessories([existing]);
      return existing;
    }
    this.log.info(`Adding accessory: ${displayName}`);
    const accessory = new this.api.platformAccessory(displayName, uuid);
    accessory.context = context;
    this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    this.accessories.set(uuid, accessory);
    return accessory;
  }

  private validateRecipe(r: RecipeConfig): boolean {
    if (!r?.name) {
      this.log.error('Skipping recipe with no name.');
      return false;
    }
    if (!Array.isArray(r.pours) || r.pours.length < 1) {
      this.log.error(`Recipe "${r.name}" has no pours — skipping.`);
      return false;
    }
    return true;
  }
}
