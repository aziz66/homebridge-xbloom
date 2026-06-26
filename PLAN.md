# homebridge-xbloom — Implementation Plan

A Homebridge 2.x plugin that brews recipes on an **xBloom** coffee machine over Bluetooth LE.
Recipes are defined by the user in the plugin's config UI; each becomes a HomeKit switch
("Hey Siri, turn on Ethiopia"). Self-contained, all-Node/TypeScript, local-BLE only.

**Status:** Plan finalized (Option A — self-contained plugin). **Not built yet. No command has
ever been sent to the machine.** A live brew happens only after explicit user approval.

---

## 1. Goal

- Trigger a full grind+brew of an arbitrary, user-defined recipe from HomeKit/Siri/automations.
- No dependence on the machine's physical A/B/C buttons (the app cannot press those remotely;
  it can only "open a recipe and brew now" — which is exactly what we replicate).
- Publishable as a generic plugin: any xBloom owner enters their own recipes.

---

## 2. Device & host facts

- **Machine:** `XBLOOM 123456`, BLE address `AA:BB:CC:DD:EE:FF` (public). Model: Original-class
  (`type_code = 0x01`). Brewing still requires a physical pod/grounds + cup loaded — BLE only
  triggers the program.
- **Host (nuc14):** Intel AX211 radio `hci0` (`00:11:22:33:44:55`). BlueZ 5.72 + `bluetooth.service`
  installed/enabled 2026-06-26. Node 20 present today, but **HB2 needs Node 22/24** (see §7).
- **Homebridge** runs in Docker (host network). BLE is reached via the host's bluetoothd over
  D-Bus (see §11) — no separate host daemon.
- **One BLE central at a time:** keep other centrals (the phone app) disconnected while the
  plugin holds the link.

---

## 3. BLE protocol (reverse-engineered + validated)

Confirmed by GATT enumeration of the real machine **and** by an Android HCI snoop of the official
app brewing a recipe; cross-validated against two clean-room libraries
([PyBloom](https://github.com/fhenwood/PyBloom), Python; and
[xbloom-ai-brew](https://github.com/Mel0day/xbloom-ai-brew), Node). All six captured frames'
CRCs recomputed and matched; the recipe payload re-encoded byte-for-byte in both libs.

### GATT
- Vendor service: `0000e0ff-3c17-d293-8e48-14fe2e4da212` (serial-over-BLE bridge).
- **FFE1** `0000ffe1-…` ("TXD Port") — `write` / `write-without-response` → **command channel**.
- **FFE2** `0000ffe2-…` ("RXD Port") — `read` / `write` / `notify` → **status notifications** (and writable).
- **FFE3** `0000ffe3-…` — `notify` only.
- Also standard Device Information (0x180a). **No pairing/bonding, no app-layer auth.**

### Frame format (every command written to FFE1)
```
0x58 | device_id(1) | type_code(1) | command(2, LE) | total_length(4, LE) | 0x01 | payload | crc16(2, LE)
```
- `device_id`: `0x01` (send). `type_code`: `0x01` standard (`0x02` = Studio/EasyMode).
- `command`: numeric command id, **decimal**, little-endian (e.g. 8001 → `41 1f`).
- `total_length`: whole frame length = `12 + payload_len`.
- The byte after length is a **constant `0x01`** (NOT a counter) → **frames are deterministic /
  replay-safe; no nonce.**
- `crc16`: poly `0x8408`, init `0`, no final XOR, over all bytes before the CRC.

```js
function crc16(bytes){let c=0;for(const b of bytes){c^=b;for(let i=0;i<8;i++)c=(c&1)?(c>>1)^0x8408:c>>1;}return c;}
```

### Command codes (decimal)
| Code | Name | Notes |
|---|---|---|
| 8102 | APP_SET_BYPASS | bypass water + **dose** (grams to grind). 3 LE ints: bypassVol, bypassTemp, dose. Required even if bypass off. |
| 8104 | APP_SET_CUP | cup weight bounds. 2 LE **float32**: max, min. (xdripper/other 90/40; xpod 80/40) |
| 8001 | APP_RECIPE_SEND_AUTO | send recipe **with grinding** (raw hex payload, see §3 recipe encoding) |
| 8004 | APP_RECIPE_SEND_MANUAL | send recipe **without grinding** |
| 8002 | APP_RECIPE_EXECUTE | start the loaded recipe (no payload) |
| 40519 | BREW_STOP | stop/abort |
| 40518 | BREW_PAUSE | pause |
| 40524 | BREW_RESTART | resume |
| 8017 | APP_RECIPE_START_QUIT | exit recipe-start screen |

### Recipe payload (inside the 8001/8004 frame)
```
length(1 = body length) | body | footer(2) = [grindSize, ratio×10]
```
Body = per pour, in order:
- **Sub-step(s)** 4 bytes each `[volume, temperature°C, pattern, vibration]`
  - volume chunked at 127 ml max per sub-step (split into multiple 4-byte sub-steps if >127).
  - pattern: `0=center, 1=circular, 2=spiral`. vibration bits: `bit0=before, bit1=after`.
- **Meta** 4 bytes `[pauseByte, 0x00, rpm, flow×10]`
  - `pauseByte = (-pause) & 0xFF` (two's complement of pause seconds).
  - `rpm` only on the **first** pour (grinder speed; valid {60,70,80,90,100,110,120}); 0 otherwise.
  - `flow` = flowRate × 10.
- **Footer gotcha:** last byte is **brew ratio × 10** (e.g. 1:17 → `0xaa`), *not* total-ml.
  xbloom-ai-brew encodes total-ml here (a bug); the real app sends ratio. Per-pour volumes are
  authoritative for actual water; the footer is secondary, but set it = ratio×10 to match the app.

### Status notifications (FFE2, opcode 0x1b)
`9000` at-grinder, `9001` at-brewer, `9003` grinding, `40507` grind-done, `9005` brewing,
`40511` brew-done, `40512` complete; errors `40517` no-beans, `40522` tank-empty, `8204` bad-dose.

---

## 4. Decoded Recipe C (worked example / seed recipe)

Captured from the user's machine and re-encoded back to identical bytes (validated).

| Field | Value |
|---|---|
| Bean dose | 18 g (via SET_BYPASS; bypass water off) |
| Grind size | 36 |
| Cup weight bounds | 90–110 g |
| Brew ratio | 1:17 (≈306 ml total) |
| RPM | 60 |

| Pour | Water | Temp | Pattern | Pause after | Flow |
|---|---|---|---|---|---|
| 1 (bloom) | 55 ml | 93 °C | center | 40 s | 3.5 |
| 2 | 95 ml | 93 °C | circular | 20 s | 3.5 |
| 3 | 85 ml | 92 °C | spiral | 20 s | 3.5 |
| 4 | 71 ml | 92 °C | spiral | 5 s | 3.5 |

Captured frames (exact bytes; replaying these brews C):
```
SET_BYPASS  580101a61f18000000010000000000000000120000007eb5
SET_CUP     580101a81f14000000010000dc420000b44221a1
SEND_AUTO   580101411f2f0000000120375d0000d8003c235f5d0100ec000023555c0200ec000023475c0200fb00002324aa527a
EXECUTE     580101421f0c000000017fcf
```

---

## 5. Brew workflow (authoritative 4-frame sequence)

Matches the real app capture (xbloom-ai-brew's 3-frame flow omits the dose step — do not copy it):
```
SET_BYPASS(dose)  →  SET_CUP(max,min)  →  RECIPE_SEND_AUTO(hex)  →  RECIPE_EXECUTE
```
Plus controls: `BREW_STOP` (40519), `BREW_PAUSE` (40518), `BREW_RESTART` (40524).
Gate progress on FFE2 status codes; surface errors (no-beans/tank-empty/bad-dose).

---

## 6. Architecture — Option A (self-contained plugin)

```
HomeKit ──► homebridge-xbloom  (ESM/TS, runs inside the Homebridge Docker container)
            • config.schema.json → user types recipes in the UI
            • Service.Switch per recipe (auto-reset) + ContactSensor + StatusFault
            • ported PyBloom protocol layer (TS): constants / crc / frame / recipe / parser
            • node-ble → BlueZ (system D-Bus) → FFE1 write / FFE2 notify
                         │  (host /run/dbus mounted into the container + D-Bus policy)
                         ▼
                   XBLOOM 123456
```
No host helper daemon, no host-side bridge. PyBloom-grade accuracy (ported logic), single
publishable Node plugin, BLE that coexists with bluetoothd.

---

## 7. Homebridge 2.x constraints (research, 2026-06-26)

Homebridge **2.1.0**, HAP `@homebridge/hap-nodejs` **2.1.7**.
- **ESM-only.** `"type":"module"`, TypeScript → `tsc` → `dist/`, `module/moduleResolution: nodenext`,
  explicit `.js` import suffixes. **Import `Service`/`Characteristic`/types from `homebridge`**, not
  the hap package. Use `import`, never `require`.
- **engines:** `"homebridge": "^1.6.0 || ^2.0.0"`, `"node": "^22.12.0 || ^24.0.0"` (Node 18/20 dropped).
  → The plugin/container must run on **Node 22 or 24**.
- `config.schema.json` unchanged — the config-UI mechanism (required for "verified" status).
- Dynamic platform pattern unchanged: `api.registerPlatform(PLATFORM_NAME, ctor)`, `configureAccessory`,
  `didFinishLaunching`, `api.hap.uuid.generate`, `registerPlatformAccessories` /
  `unregisterPlatformAccessories`, Map-based accessory cache.
- HAP v2 gotchas: `Characteristic.getValue()` removed → use `.value`; enums via
  `api.hap.Units/Formats/Perms`.
- Child bridge = a user toggle (recommend in README), not plugin config.
- Scaffold from `github.com/homebridge/homebridge-plugin-template` (branch `latest`).

---

## 8. HomeKit accessory model

- **One `Service.Switch` per recipe, auto-reset.** In `onSet(On=true)`: kick off the brew, then
  `characteristic.updateValue(false)` after a short delay so it's momentary and re-triggerable.
  Enables "Hey Siri, turn on <recipe name>". **Do NOT use `StatelessProgrammableSwitch`** — that's
  an input/event type Siri cannot command. No coffee/appliance service exists in HomeKit.
- **Status:** a `ContactSensor` (or `OccupancySensor`) for "brewing now" (visible in Apple Home,
  automatable) + `StatusFault` for error states. Optional: a custom read-only enum characteristic
  for full idle/grinding/brewing/done/error (only renders in third-party apps like Eve).
- Optional global **"Stop"** switch → BREW_STOP.
- Set `AccessoryInformation` (Manufacturer xBloom, Model, SerialNumber from device info).

---

## 9. File structure

```
homebridge-xbloom/
├── package.json            # type:module, engines, keywords:["homebridge-plugin"], main:dist/index.js
├── tsconfig.json           # nodenext, ES2022, strict, outDir dist
├── eslint.config.js        # flat config
├── config.schema.json      # recipe UI (see §10)
├── PLAN.md                 # this file
├── README.md               # setup incl. the D-Bus mount step (§11)
└── src/
    ├── index.ts            # api.registerPlatform(PLATFORM_NAME, XBloomPlatform)
    ├── settings.ts         # PLATFORM_NAME, PLUGIN_NAME
    ├── platform.ts         # DynamicPlatformPlugin: build one accessory per configured recipe
    ├── recipeSwitch.ts     # per-recipe Switch + status; calls brew()
    ├── brew.ts             # orchestrates SET_BYPASS→SET_CUP→SEND_AUTO→EXECUTE + stop/pause
    ├── ble.ts              # node-ble transport: connect, subscribe FFE2, write FFE1, reconnect
    └── protocol/           # ported PyBloom protocol layer (pure logic, unit-tested)
        ├── constants.ts    # command codes + crc16
        ├── frame.ts        # buildCommand(cmd, ints[]) / buildCommandRaw(cmd, bytes)
        ├── recipe.ts       # encodeRecipe(recipe) → hex (footer = ratio×10)
        └── parser.ts       # FFE2 notification → status enum
└── test/
    └── protocol.test.ts    # asserts ported encoder reproduces the §4 captured C frames byte-for-byte
```

---

## 10. config.schema.json (the "type a recipe" UI)

`pluginType: platform`, `pluginAlias` = PLATFORM_NAME. Top-level: an array `recipes[]`, each:
- `name` (string, required) — HomeKit switch name / Siri phrase.
- `cupType` (enum: `xdripper` | `xpod` | `other`).
- `doseGrams` (number, 5–40).
- `grinderSize` (int, 1–80).
- `rpm` (enum: 60/70/80/90/100/110/120).
- `ratio` (number) — used for the footer byte (ratio×10).
- `pours[]` — each `{ volume(1–300 ml), temperature(40–100 °C), flowRate(0.5–7.0),
  pattern(0/1/2), pausing(0–300 s), vibBefore(bool), vibAfter(bool) }`.
Validate ranges in-schema so the UI rejects bad input; re-validate in code before encoding.
Seed the schema's default with **Recipe C** (§4) as a ready example.

---

## 11. node-ble transport + Docker deployment

- **Library:** `node-ble` (chrvadala/node-ble, v1.13). D-Bus/BlueZ client — coexists with
  bluetoothd (no contention, unlike noble), pure-JS (no node-gyp), Node 22/24 OK, full
  notify + write.
- **Flow:** get adapter → scan/`waitDevice('AA:BB:CC:DD:EE:FF')` → connect → GATT → service
  `e0ff…` → FFE1 (write, `writeValueWithoutResponse`) + FFE2 (`startNotifications` +
  `valuechanged`). Auto-reconnect on drop.
- **Container changes (the only host-side change for Option A):**
  - Mount the host system D-Bus socket into the Homebridge container:
    `-v /run/dbus:/run/dbus:ro` (or `/var/run/dbus/system_bus_socket`).
  - Add a D-Bus policy (`/etc/dbus-1/system.d/homebridge-xbloom.conf`) granting the container's
    UID access to `org.bluez`.
  - **No** `NET_RAW`/`NET_ADMIN` caps, **no** privileged mode, **no** stopping bluetoothd.
- Ensure the Homebridge container/runtime is on **Node 22/24** (HB2 requirement) before shipping.

---

## 12. Testing plan (offline first, live last & gated)

1. **Offline protocol unit tests** — ported encoder reproduces the §4 captured C frames exactly
   (CRC + full-frame equality). Must pass before any hardware.
2. **Dry-run mode** — a config flag that logs the frames it *would* send without writing to FFE1.
3. **BLE read-only smoke test** — connect via node-ble, subscribe FFE2, read device info; confirm
   transport works with bluetoothd up. No writes.
4. **Single gated live brew of Recipe C** — only after explicit user approval, with a pod/cup
   loaded. Watch FFE2 status to confirm grind→brew→complete.
5. Then enable additional recipes / Siri / automations.

---

## 13. Publishability

Pure-Node, self-contained, local-BLE only → publishable as `homebridge-xbloom` (unofficial; not
affiliated with xBloom). Users enter their own recipes via the config UI. For native (non-Docker)
Homebridge installs, node-ble works with just the BlueZ D-Bus policy; document the Docker D-Bus
mount for containerized installs. Mark tested model(s)/firmware; note firmware updates may change
bytes.

---

## 14. Open items / gotchas

- **Footer = ratio×10** (confirmed from the C capture). If authoring very different recipes, verify
  once against an app-captured recipe (or a gated test) that the machine treats the footer as ratio.
- **Dose is mandatory** via SET_BYPASS even when bypass water is off (PyBloom-documented; matches
  capture). Don't drop it.
- **type_code** is `0x01` for this Original-class machine; Studio/EasyMode uses `0x02` and different
  command ids (out of scope for v1).
- **Node version:** confirm the Homebridge container runs Node 22/24 before building/shipping.
- **Single central:** disconnect other BLE centrals (phone) while the plugin is connected.

---

## 15. Sources / prior art

- xBloom protocol (clean-room): https://github.com/fhenwood/PyBloom (Python; chosen reference)
- xBloom protocol (Node): https://github.com/Mel0day/xbloom-ai-brew
- Homebridge v2 migration: https://github.com/homebridge/homebridge/wiki/Updating-To-Homebridge-v2.0
- Homebridge plugin template: https://github.com/homebridge/homebridge-plugin-template (branch `latest`)
- HAP-NodeJS: https://github.com/homebridge/HAP-NodeJS
- node-ble: https://github.com/chrvadala/node-ble

---

## 16. Build order (when approved)

1. Port + unit-test the protocol layer against the §4 captured C frames (offline).
2. Scaffold the HB2 plugin (ESM/TS) + `config.schema.json` seeded with Recipe C.
3. Wire node-ble; mount D-Bus into the Homebridge container; read-only smoke test.
4. **Explicitly-approved** single live brew of Recipe C.
5. Polish: status sensors, stop switch, README, publish.
