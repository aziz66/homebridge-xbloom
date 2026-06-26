/** Plugin configuration shapes (mirror of config.schema.json). */

import type { PlatformConfig } from 'homebridge';
import type { PourStep, XBloomRecipe } from './protocol/recipe.js';

export type CupType = 'xdripper' | 'xpod' | 'other';

/** A single user-defined recipe → one HomeKit switch. */
export interface RecipeConfig {
  name: string;
  cupType: CupType;
  doseGrams: number;
  grinderSize: number;
  rpm: number;
  ratio: number;
  /** Optional explicit cup weight bounds (g); default from cupType if omitted. */
  cupMax?: number;
  cupMin?: number;
  pours: PourStep[];
}

export interface XBloomConfig extends PlatformConfig {
  /** BLE address, e.g. "AA:BB:CC:DD:EE:FF". Optional — falls back to deviceName scan. */
  deviceAddress?: string;
  /** BLE advertised name prefix, default "XBLOOM ". */
  deviceName?: string;
  /**
   * Custom D-Bus system bus address — only for Dockerized Homebridge, to reach the
   * host's bluetoothd (e.g. "unix:path=/run/host-dbus/system_bus_socket").
   */
  dbusAddress?: string;
  /** When true, never touch Bluetooth — just log the frames that would be sent. */
  dryRun?: boolean;
  /** Expose a global "Stop Brew" switch. */
  exposeStopSwitch?: boolean;
  /** Expose the "xBloom Bluetooth" hold/release switch (default false). */
  exposeConnectionSwitch?: boolean;
  /** Auto-release the link this many seconds after a manual hold (default 300). */
  holdTimeoutSec?: number;
  /** Expose the "xBloom Brewing" status sensor (default true). */
  exposeBrewingSensor?: boolean;
  /** How long to watch a brew for completion before releasing (default 300s). */
  brewTimeoutSec?: number;
  recipes?: RecipeConfig[];
}

/** Default cup weight bounds (g) per cup type. */
export const CUP_BOUNDS: Record<CupType, { max: number; min: number }> = {
  xpod: { max: 80, min: 40 },
  xdripper: { max: 90, min: 40 },
  other: { max: 90, min: 40 },
};

export function cupBounds(r: RecipeConfig): { max: number; min: number } {
  const fallback = CUP_BOUNDS[r.cupType] ?? CUP_BOUNDS.xdripper;
  return {
    max: r.cupMax ?? fallback.max,
    min: r.cupMin ?? fallback.min,
  };
}

/** Project the config recipe onto the protocol-layer recipe shape. */
export function toProtocolRecipe(r: RecipeConfig): XBloomRecipe {
  return {
    grinderSize: r.grinderSize,
    ratio: r.ratio,
    rpm: r.rpm,
    pours: r.pours,
  };
}

/** Allowed brew ratio range and step. */
export const RATIO_MIN = 5;
export const RATIO_MAX = 25;
export const RATIO_STEP = 0.5;

/** Total water a recipe should pour, derived from the authoritative dose × ratio. */
export function targetWaterMl(r: RecipeConfig): number {
  return Math.round(r.doseGrams * r.ratio);
}

export function totalPourMl(r: RecipeConfig): number {
  return r.pours.reduce((sum, p) => sum + (p.volume || 0), 0);
}

const VALID_RPM = new Set([0, 60, 70, 80, 90, 100, 110, 120]);

function inRange(v: unknown, min: number, max: number): boolean {
  return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
}

/**
 * Hard validation of a recipe's numeric ranges (the config UI enforces these, but a
 * hand-edited config.json can bypass the schema). Returns fatal errors; a recipe with
 * any error should be skipped rather than encoded into a frame sent to the machine.
 */
export function recipeErrors(r: RecipeConfig): string[] {
  const errors: string[] = [];
  if (!inRange(r.doseGrams, 5, 40)) errors.push(`doseGrams ${r.doseGrams} out of range (5–40)`);
  if (!inRange(r.grinderSize, 1, 80)) errors.push(`grinderSize ${r.grinderSize} out of range (1–80)`);
  if (!inRange(r.ratio, RATIO_MIN, RATIO_MAX)) errors.push(`ratio ${r.ratio} out of range (${RATIO_MIN}–${RATIO_MAX})`);
  if (!VALID_RPM.has(r.rpm)) errors.push(`rpm ${r.rpm} must be one of 60,70,80,90,100,110,120`);
  r.pours?.forEach((p, i) => {
    if (!inRange(p.volume, 1, 300)) errors.push(`pour ${i + 1} volume ${p.volume} out of range (1–300 ml)`);
    if (!inRange(p.temperature, 40, 100)) errors.push(`pour ${i + 1} temperature ${p.temperature} out of range (40–100 °C)`);
    if (!inRange(p.flowRate, 0.5, 7)) errors.push(`pour ${i + 1} flowRate ${p.flowRate} out of range (0.5–7)`);
    if (![0, 1, 2].includes(p.pattern)) errors.push(`pour ${i + 1} pattern ${p.pattern} must be 0, 1, or 2`);
    if (!inRange(p.pausing, 0, 300)) errors.push(`pour ${i + 1} pausing ${p.pausing} out of range (0–300 s)`);
  });
  return errors;
}

/**
 * Recipe consistency check. Dose and ratio are the source of truth: the pours
 * should add up to dose × ratio. Returns human-readable warnings (non-fatal —
 * the machine still pours the configured volumes).
 */
export function checkRecipe(r: RecipeConfig): string[] {
  const warnings: string[] = [];

  if (r.ratio < RATIO_MIN || r.ratio > RATIO_MAX) {
    warnings.push(`ratio 1:${r.ratio} is outside the supported 1:${RATIO_MIN}–1:${RATIO_MAX} range.`);
  }
  if (Math.abs(r.ratio / RATIO_STEP - Math.round(r.ratio / RATIO_STEP)) > 1e-9) {
    warnings.push(`ratio 1:${r.ratio} should be in ${RATIO_STEP} steps (1:5, 1:5.5, 1:6, …).`);
  }

  const target = targetWaterMl(r);
  const actual = totalPourMl(r);
  if (Math.abs(actual - target) > 1) {
    const actualRatio = r.doseGrams ? (actual / r.doseGrams).toFixed(1) : '?';
    warnings.push(
      `total pour water ${actual} ml ≠ dose × ratio (${r.doseGrams} g × ${r.ratio} = ${target} ml). ` +
      `The machine will pour ${actual} ml — an actual ratio of ~1:${actualRatio}. ` +
      `Adjust the pour volumes to sum to ${target} ml, or change the dose/ratio.`,
    );
  }

  return warnings;
}
