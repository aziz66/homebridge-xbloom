/**
 * Brew orchestration: the authoritative 4-frame sequence captured from the app.
 *   SET_BYPASS(dose) → SET_CUP(bounds) → RECIPE_SEND_AUTO(recipe) → RECIPE_EXECUTE
 */

import type { Logging } from 'homebridge';
import { XBloomCommand } from './protocol/constants.js';
import { buildCommand, buildCommandRaw, floatBits } from './protocol/frame.js';
import { encodeRecipe } from './protocol/recipe.js';
import { cupBounds, toProtocolRecipe, type RecipeConfig } from './config.js';
import type { Transport } from './transport.js';

export interface LabelledFrame {
  label: string;
  buf: Buffer;
}

/** Build (but do not send) the ordered brew frames for a recipe. */
export function buildBrewFrames(recipe: RecipeConfig): LabelledFrame[] {
  const bounds = cupBounds(recipe);
  const dose = Math.round(recipe.doseGrams);
  return [
    {
      label: `SET_BYPASS dose=${dose}g`,
      buf: buildCommand(XBloomCommand.APP_SET_BYPASS, [0, 0, dose]),
    },
    {
      label: `SET_CUP bounds=${bounds.max}/${bounds.min}g`,
      buf: buildCommand(XBloomCommand.APP_SET_CUP, [floatBits(bounds.max), floatBits(bounds.min)]),
    },
    {
      label: 'RECIPE_SEND_AUTO',
      buf: buildCommandRaw(XBloomCommand.APP_RECIPE_SEND_AUTO, encodeRecipe(toProtocolRecipe(recipe))),
    },
    {
      label: 'RECIPE_EXECUTE',
      buf: buildCommand(XBloomCommand.APP_RECIPE_EXECUTE, []),
    },
  ];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Gaps AFTER each frame; longer pause before EXECUTE so SEND_AUTO loads (matches app).
const FRAME_DELAYS = [500, 500, 2000, 0];

/**
 * Send the brew sequence over an ALREADY-OPEN transport. The caller owns the
 * connection lifecycle (connect-on-demand).
 */
export async function sendBrew(
  recipe: RecipeConfig,
  transport: Transport,
  log: Logging,
): Promise<void> {
  const frames = buildBrewFrames(recipe);
  log.info(`Brewing "${recipe.name}" (${frames.length} frames)`);
  for (let i = 0; i < frames.length; i++) {
    log.info(`  → ${frames[i].label}`);
    await transport.send(frames[i].buf);
    if (FRAME_DELAYS[i]) await sleep(FRAME_DELAYS[i]);
  }
  log.info(`"${recipe.name}" brew sequence sent`);
}

/** Build a stand-alone stop frame. */
export function stopFrame(): Buffer {
  return buildCommand(XBloomCommand.BREW_STOP, []);
}
