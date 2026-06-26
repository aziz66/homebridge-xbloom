/**
 * Parser for xBloom status notifications (FFE2).
 *
 * Inbound frames: 0x58 | device_id=0x07 | type_code=0x02 | command(2,LE) |
 *                 length(4,LE) | 0xC1 | payload | crc16(2,LE)
 * `command` is a status/event code; `payload` is 4-byte little-endian value(s).
 *
 * Decoded from a full Recipe C brew (see data/ffe2-returns.md):
 *   20501 = cup scale weight (grams, float)
 *   40523 = water dispensed (float, x1000 = microlitres) → /1000 = ml
 *   40510 = current pour index (0,1,2,3…)
 *   8023  = machine activity / screen code (int)
 *   lifecycle: 40506→40507 grind_done → pours → 40511 brew_done → 40512 complete
 *   errors: 40517 no-beans, 40522 tank-empty, 8204 bad-dose
 */

export enum BrewState {
  Unknown = 'unknown',
  Idle = 'idle',
  Grinding = 'grinding',
  Brewing = 'brewing',
  Done = 'done',
  Error = 'error',
}

export interface ParsedNotification {
  command: number;
  name: string;
  state: BrewState;
  error?: string;
  /** Cup scale weight in grams (code 20501). */
  weightG?: number;
  /** Water dispensed in ml (code 40523). */
  dispensedMl?: number;
  /** Current pour index, 0-based (code 40510). */
  pourIndex?: number;
  /** Machine activity / screen code (code 8023). */
  activity?: number;
  raw: Buffer;
}

export const COMMAND_NAMES: Record<number, string> = {
  8001: 'RECIPE_SEND_AUTO', 8002: 'RECIPE_EXECUTE', 8004: 'RECIPE_SEND_MANUAL',
  8007: 'RD_BREWER_IN', 8009: 'RD_MachineSleeping', 8011: 'RD_MachineNotSleeping',
  8022: 'RD_BackToHome', 8023: 'RD_MachineActivity', 8102: 'SET_BYPASS', 8104: 'SET_CUP',
  8105: 'RD_GRINDER_SIZE', 8106: 'RD_GRINDER_SPEED', 8107: 'RD_BREWER_MODE',
  8108: 'RD_BREWER_TEMPERATURE', 8204: 'ERR_bad_dose',
  9000: 'at_grinder', 9001: 'at_brewer', 9003: 'grinding', 9005: 'brewing',
  20501: 'weight', 40502: 'init', 40506: 'pre_grind', 40507: 'grind_done',
  40510: 'pour_index', 40511: 'brew_done', 40512: 'complete', 40523: 'water_dispensed',
  40517: 'ERR_no_beans', 40522: 'ERR_tank_empty', 40526: 'RD_CurrentGrinder',
};

const STATE_BY_CODE: Record<number, BrewState> = {
  9000: BrewState.Idle, 9001: BrewState.Idle, 8009: BrewState.Idle,
  9003: BrewState.Grinding, 40506: BrewState.Grinding, 40507: BrewState.Grinding,
  9005: BrewState.Brewing, 40510: BrewState.Brewing, 40511: BrewState.Brewing,
  40512: BrewState.Done,
};

const ERROR_BY_CODE: Record<number, string> = {
  40517: 'no beans detected',
  40522: 'water tank empty',
  8204: 'invalid dose/water',
};

export function parseNotification(data: Buffer): ParsedNotification | null {
  if (data.length < 5 || data.readUInt8(0) !== 0x58) return null;
  const command = data.readUInt16LE(3);
  const payload = data.length > 12 ? data.subarray(10, -2) : Buffer.alloc(0);

  const error = ERROR_BY_CODE[command];
  const out: ParsedNotification = {
    command,
    name: COMMAND_NAMES[command] ?? 'unknown',
    state: error ? BrewState.Error : STATE_BY_CODE[command] ?? BrewState.Unknown,
    error,
    raw: data,
  };

  if (payload.length >= 4) {
    switch (command) {
      case 20501:
        out.weightG = round1(payload.readFloatLE(0));
        break;
      case 40523:
        out.dispensedMl = round1(payload.readFloatLE(0) / 1000);
        break;
      case 40510:
        out.pourIndex = payload.readUInt32LE(0);
        break;
      case 8023:
        out.activity = payload.readUInt32LE(0);
        break;
    }
  }
  return out;
}

function round1(n: number): number {
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : 0;
}
