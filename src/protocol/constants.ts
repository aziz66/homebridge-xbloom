/**
 * xBloom BLE protocol constants.
 *
 * Ported from PyBloom (github.com/fhenwood/PyBloom), cross-checked against
 * xbloom-ai-brew and an HCI capture of the real machine (XBLOOM 123456).
 *
 * Command ids are DECIMAL numbers, written little-endian in the frame.
 */

export const XBloomCommand = {
  // ── Coffee recipe flow ───────────────────────────────────────────────
  APP_SET_BYPASS: 8102, // bypass water + bean dose (3 LE ints: bypassVol, bypassTemp, dose)
  APP_SET_CUP: 8104, // cup weight bounds (2 LE float32: max, min)
  APP_RECIPE_SEND_AUTO: 8001, // send recipe WITH grinding (raw hex payload)
  APP_RECIPE_SEND_MANUAL: 8004, // send recipe WITHOUT grinding
  APP_RECIPE_EXECUTE: 8002, // start the loaded recipe (no payload)
  APP_RECIPE_START_QUIT: 8017, // exit recipe-start screen

  // ── Whole-flow controls ──────────────────────────────────────────────
  BREW_STOP: 40519,
  BREW_PAUSE: 40518,
  BREW_RESTART: 40524,

  // ── Navigation / benign ──────────────────────────────────────────────
  RD_BACK_TO_HOME: 8022, // return to home screen (no grind/pour)
} as const;

export type XBloomCommandId = (typeof XBloomCommand)[keyof typeof XBloomCommand];

/**
 * CRC-16, polynomial 0x8408 (reversed 0x1021), init 0, no final XOR.
 * Covers every frame byte before the 2-byte CRC. Returns a 16-bit number.
 */
export function crc16(data: Uint8Array): number {
  let crc = 0;
  for (const byte of data) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x0001 ? (crc >> 1) ^ 0x8408 : crc >> 1;
    }
  }
  return crc & 0xffff;
}
