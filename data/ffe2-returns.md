# What the xBloom returns on FFE2 (notifications)

Reference sample captured from XBLOOM 123456 after sending the benign
`RD_BACK_TO_HOME` (8022) command (the machine streams nothing at idle; it must be
nudged, and only replies while awake — e.g. just off the phone, or mid-brew).

## Inbound frame format

Same layout as outbound commands, with three differences:

```
0x58 | device_id=0x07 | type_code=0x02 | command(2,LE) | length(4,LE) | 0xC1 | payload | crc16(2,LE)
```

- `device_id = 0x07` (receive) vs `0x01` on our outbound frames.
- `type_code = 0x02` vs `0x01` outbound.
- the constant byte after length is `0xC1` (inbound) vs `0x01` (outbound).
- `command` = a status/event code; `payload` = 4-byte little-endian value(s).

## Decoded sample (first 10 of ~38 frames)

| raw | code | name | payload value |
|---|---|---|---|
| `580207561f0c000000c17a18` | 8022 | RD_BackToHome | (ack, no payload) |
| `580207155010000000c100004842a65c` | 20501 | telemetry | `00004842` -> 50.0f |
| `5802074b1f0c000000c1fc83` | 8011 | RD_MachineNotSleeping | (flag, no payload) |
| `580207571f10000000c1410000009a25` | 8023 | RD_MachineActivity | `41000000` -> 65 |
| `580207155010000000c10000000016b5` | 20501 | telemetry | `00000000` -> 0.0f |
| `5802074b9e10000000c100000000fd32` | 40523 | RD_grinder? | `00000000` -> 0 |
| `580207155010000000c1...` | 20501 | telemetry | 0.0f (repeats) |
| `5802074b9e10000000c1...` | 40523 | RD_grinder? | 0 (repeats) |

## What this tells us

- 8011 RD_MachineNotSleeping - the machine reports awake/asleep state.
- 8023 RD_MachineActivity = 65 - an activity/screen code.
- 20501 - a telemetry channel carrying a float that changed 50.0 -> 0.0. Likely
  the built-in scale weight (grams) or a transient level; needs a brew capture to
  confirm by correlating with pour volumes.
- 40523 - a grinder-related status (0 when idle).
- During a brew we additionally expect: 9003 grinding, 40507 grind_done,
  9005 brewing, 40511 brew_done, 40512 complete, and errors
  40517 no_beans / 40522 tank_empty / 8204 bad_dose.

## Full brew telemetry (decoded from a complete Recipe C brew)

Captured end-to-end via `scripts/brew-and-capture.mjs` — reached `40512 complete`
at ~237 s, no errors. Raw log: `data/brew-telemetry.log`.

### Live telemetry channels (each streams ~5x/sec during the brew)
- **20501 = scale weight in cup (grams, float).** Climbs monotonically:
  0 -> 26 -> 68 -> 115 -> 175 -> 216 -> 264 -> **276 g** final. The built-in scale.
- **40523 = water dispensed (float, x1000 = microlitres).** Climbs to exactly
  **306000.0 = 306 ml** = Recipe C target. The pump delivered-volume integral.
  (At idle this is 0; constant target only appears once pouring.)

### State / event codes (brew lifecycle, in order)
```
8104 SET_CUP  8001 RECIPE_SEND_AUTO  8002 RECIPE_EXECUTE   (our commands, echoed)
40502  (init burst, values incl -8.0f)
40506  (pre-grind)
40507  grind_done
40510  POUR INDEX -> 0,1,2,3   (one per pour: bloom + 3 pours)
40511  brew_done
40512  complete
8023   RD_MachineActivity = phase/screen code (seen 16,30,31,34,35)
```
Error codes (none fired this run): 40517 no_beans, 40522 tank_empty, 8204 bad_dose.

### For HomeKit status feedback (step-5 polish)
Enrich `parser.ts`:
- map 20501 -> weight(g), 40523/1000 -> dispensed(ml) for a live progress %,
- 40510 -> current pour number,
- 40507/40511/40512 -> grinding/brewing/done states (already partly mapped),
- 8023 -> activity, error codes -> StatusFault.
