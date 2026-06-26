/**
 * xBloom recipe payload encoder (the body of an 8001/8004 command).
 *
 * Payload layout:
 *   length(1 = body length) | body | footer(2) = [grindSize, ratio*10]
 *
 * Body, per pour (in order):
 *   sub-step(s) 4 bytes each: [volumeChunk, temperature, pattern, vibration]
 *     - volume is chunked at 127 ml max per sub-step.
 *     - pattern: 0=center, 1=circular, 2=spiral.
 *     - vibration bits: bit0=before, bit1=after.
 *   meta 4 bytes: [pauseByte, 0x00, rpm, flow*10]
 *     - pauseByte = (-pausing) & 0xFF (two's complement of pause seconds).
 *     - rpm only on the FIRST pour (grinder speed), else 0.
 *     - flow = flowRate * 10.
 *
 * Footer gotcha: the last byte is the brew RATIO * 10 (e.g. 1:17 -> 0xAA),
 * NOT total millilitres. Per-pour volumes drive actual water.
 *
 * Ported from PyBloom build_recipe_payload (temperatures are Celsius).
 */

export interface PourStep {
  volume: number; // ml
  temperature: number; // °C
  flowRate: number; // e.g. 3.5
  pausing: number; // seconds to pause after this pour
  pattern: 0 | 1 | 2; // 0=center, 1=circular, 2=spiral
  vibBefore?: boolean;
  vibAfter?: boolean;
}

export interface XBloomRecipe {
  grinderSize: number; // 1..80
  ratio: number; // brew ratio (water:coffee), e.g. 17 for 1:17
  rpm: number; // 60,70,80,90,100,110,120
  pours: PourStep[];
}

const MAX_CHUNK = 127;

function pourSubStep(volume: number, p: PourStep): number[] {
  const vib = (p.vibBefore ? 1 : 0) | (p.vibAfter ? 2 : 0);
  return [volume & 0xff, p.temperature & 0xff, p.pattern & 0xff, vib & 0xff];
}

export function encodeRecipe(recipe: XBloomRecipe): Buffer {
  const body: number[] = [];

  recipe.pours.forEach((pour, i) => {
    // Sub-steps: split volume into <=127 ml chunks.
    const remaining = Math.round(pour.volume);
    if (remaining > MAX_CHUNK) {
      const chunks = Math.floor(remaining / MAX_CHUNK);
      const rem = remaining % MAX_CHUNK;
      for (let c = 0; c < chunks; c++) body.push(...pourSubStep(MAX_CHUNK, pour));
      if (rem > 0) body.push(...pourSubStep(rem, pour));
    } else {
      body.push(...pourSubStep(remaining, pour));
    }

    // Meta: [-pause, 0, rpm(first pour only), flow*10]
    const pauseByte = (-Math.round(pour.pausing)) & 0xff;
    const rpmByte = i === 0 ? recipe.rpm & 0xff : 0;
    const flowByte = Math.round(pour.flowRate * 10) & 0xff;
    body.push(pauseByte, 0x00, rpmByte, flowByte);
  });

  const footer = [
    Math.round(recipe.grinderSize) & 0xff,
    Math.round(recipe.ratio * 10) & 0xff,
  ];

  if (body.length > 255) {
    throw new Error(`Recipe body is ${body.length} bytes (max 255). Reduce the number or size of pours.`);
  }
  return Buffer.from([body.length, ...body, ...footer]);
}
