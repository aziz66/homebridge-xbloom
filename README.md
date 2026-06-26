<p align="center">
  <img src="https://raw.githubusercontent.com/homebridge/branding/latest/logos/homebridge-wordmark-logo-vertical.png" width="150">
</p>

# homebridge-xbloom

[![npm](https://img.shields.io/npm/v/homebridge-xbloom.svg)](https://www.npmjs.com/package/homebridge-xbloom)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![ko-fi](https://img.shields.io/badge/support-ko--fi-ff5e5b.svg)](https://ko-fi.com/aziz66)

Brew your saved **xBloom** coffee recipes from **HomeKit / Siri**, over Bluetooth LE.

Each recipe you define becomes a HomeKit switch, so you can say *"Hey Siri, turn on
Ethiopia"* or trigger a brew from any HomeKit automation (alarm, sunrise, presence, …).
The plugin connects to the machine only when needed and frees it again afterwards, so
your phone's xBloom app keeps working normally.

> **Unofficial.** Not affiliated with, endorsed by, or supported by xBloom. It talks to
> the machine locally over Bluetooth (no cloud) using a clean-room understanding of its
> BLE protocol. Use at your own risk.

---

## Features

- 🎯 **One switch per recipe** — trigger by name with Siri, scenes, or automations.
- ☕ **Recipes defined in the config UI** — dose, grind, ratio, and full pour profile
  (water / temperature / flow / pattern / pause per pour). No app or capture required.
- 🔄 **Connect-on-demand** — no permanent Bluetooth connection; the machine stays free
  for your phone between brews (see [Bluetooth & the single-device limit](#bluetooth--the-single-device-limit)).
- 📊 **Live status** — an `xBloom Brewing` sensor in Apple Home, plus fault reporting for
  *no beans / tank empty / bad dose*, and a log of grind → pour → complete with live ml.
- 🛑 Optional **Stop Brew** switch and an optional **manual Bluetooth hold/release** switch.

### Accessories it exposes

| Accessory | Type | Default | Purpose |
|---|---|---|---|
| *(each recipe)* | Switch | — | Turn on to brew that recipe (auto-resets) |
| `xBloom Brewing` | Contact Sensor | on | Open while grinding/brewing; fault on errors |
| `Stop Brew` | Switch | on | Aborts the current brew |
| `xBloom Bluetooth` | Switch | off | Manual hold/release of the BLE link (override) |

---

## Requirements

- **Homebridge v1.8+ or v2.x** running on **Node.js 22 or 24**.
- A Linux host with **BlueZ** (`bluetoothd`) and a working Bluetooth adapter
  (most Raspberry Pi / NUC / mini-PC setups). The plugin talks to BlueZ over D-Bus.
- An **xBloom** machine (tested on the original/Studio-class, `XBLOOM …` BLE name).
- The machine must be **physically loaded** (pod or grounds, cup, water) for a brew —
  Bluetooth only triggers the program; it can't load coffee.

> macOS/Windows Homebridge hosts are not supported for the BLE link (BlueZ is Linux-only).

---

## Installation

### Option A — Homebridge UI (recommended)

1. In the Homebridge UI, go to **Plugins**, search **`homebridge-xbloom`**, and install.
2. Open the plugin settings and add your machine + recipes (see [Configuration](#configuration)).
3. Make sure the host can reach Bluetooth (see [Linux / BlueZ setup](#linux--bluez-setup)).

### Option B — Command line

```bash
sudo npm install -g homebridge-xbloom
```

### Linux / BlueZ setup

The plugin uses [`node-ble`](https://github.com/chrvadala/node-ble), which speaks to the
system Bluetooth daemon over D-Bus (it coexists with `bluetoothd` — no adapter takeover).

1. Install and enable BlueZ:
   ```bash
   sudo apt install bluez
   sudo systemctl enable --now bluetooth
   bluetoothctl power on
   ```
2. **Permissions.** If Homebridge runs as **root**, BlueZ's default policy already allows
   access. If it runs as a **non-root user**, grant that user access to `org.bluez` by
   creating `/etc/dbus-1/system.d/node-ble.conf`:
   ```xml
   <!DOCTYPE busconfig PUBLIC "-//freedesktop//DTD D-BUS Bus Configuration 1.0//EN"
     "http://www.freedesktop.org/standards/dbus/1.0/busconfig.dtd">
   <busconfig>
     <policy user="homebridge">
       <allow send_destination="org.bluez"/>
       <allow send_interface="org.bluez.Adapter1"/>
       <allow send_interface="org.bluez.Device1"/>
       <allow send_interface="org.bluez.GattService1"/>
       <allow send_interface="org.bluez.GattCharacteristic1"/>
       <allow send_interface="org.bluez.GattDescriptor1"/>
       <allow send_interface="org.freedesktop.DBus.ObjectManager"/>
       <allow send_interface="org.freedesktop.DBus.Properties"/>
     </policy>
   </busconfig>
   ```
   Replace `homebridge` with the actual user, then `sudo systemctl reload dbus`.

### Docker Homebridge

> Only needed if your Homebridge runs in Docker. **Native installs (Raspberry Pi, etc.) need
> nothing here** — the plugin uses the system Bluetooth automatically.

A Docker container can't see the host's Bluetooth by default, and the official
`homebridge/homebridge` image (with `ENABLE_AVAHI=1`) runs its **own** internal D-Bus. So you
do **two** small one-time things:

**1. Mount the host's D-Bus socket** into the container — add one line to your Homebridge
`docker-compose.yml`:

```yaml
services:
  homebridge:
    # …existing config…
    volumes:
      - ./volumes/homebridge:/homebridge
      - /run/dbus/system_bus_socket:/run/host-dbus/system_bus_socket:ro   # ← add this
```

Then `docker compose up -d` to recreate the container.

**2. Set `dbusAddress` in the plugin config** to that path:

```
unix:path=/run/host-dbus/system_bus_socket
```

That's it. The plugin points **only its own** Bluetooth connection at the host bus — your
container's avahi / HomeKit advertising is left completely untouched (no container-wide
environment variables). The image runs as root, so BlueZ's default permissions are enough.

### Finding your device's BLE address

```bash
bluetoothctl --timeout 12 scan le | grep -i xbloom
# e.g. [NEW] Device AA:BB:CC:DD:EE:FF XBLOOM 123456
```

The machine only advertises while **awake** and **not connected to another device**
(disconnect the phone app first). Put that `XX:XX:XX:XX:XX:XX` address in the config.

---

## Configuration

Use the Homebridge UI settings, or add a platform block to `config.json`:

```json
{
  "platforms": [
    {
      "platform": "XBloom",
      "name": "xBloom",
      "deviceAddress": "AA:BB:CC:DD:EE:FF",
      "exposeBrewingSensor": true,
      "exposeStopSwitch": true,
      "exposeConnectionSwitch": false,
      "holdTimeoutSec": 300,
      "brewTimeoutSec": 300,
      "dryRun": false,
      "recipes": [
        {
          "name": "Morning Pour Over",
          "cupType": "xdripper",
          "doseGrams": 18,
          "grinderSize": 36,
          "rpm": 60,
          "ratio": 17,
          "pours": [
            { "volume": 55, "temperature": 93, "flowRate": 3.5, "pattern": 0, "pausing": 40 },
            { "volume": 95, "temperature": 93, "flowRate": 3.5, "pattern": 1, "pausing": 20 },
            { "volume": 85, "temperature": 92, "flowRate": 3.5, "pattern": 2, "pausing": 20 },
            { "volume": 71, "temperature": 92, "flowRate": 3.5, "pattern": 2, "pausing": 5 }
          ]
        }
      ]
    }
  ]
}
```

### Platform options

| Option | Default | Description |
|---|---|---|
| `deviceAddress` | — | Machine BLE address (`XX:XX:XX:XX:XX:XX`). Required for real brewing. |
| `recipes` | `[]` | Your recipes (see below). Each becomes a switch. |
| `dryRun` | `false` | Log the frames that *would* be sent without touching Bluetooth. Great for first setup. |
| `exposeBrewingSensor` | `true` | Expose the `xBloom Brewing` status sensor. |
| `exposeStopSwitch` | `true` | Expose the `Stop Brew` switch. |
| `exposeConnectionSwitch` | `false` | Expose the manual `xBloom Bluetooth` hold/release switch. |
| `holdTimeoutSec` | `300` | When manually held on, auto-release after this many seconds (`0` = until turned off). |
| `brewTimeoutSec` | `300` | How long to watch a brew for completion before releasing the link. |

### Recipe options

| Field | Notes |
|---|---|
| `name` | Switch name / Siri phrase. |
| `cupType` | `xdripper`, `xpod`, or `other` (sets the cup weight bounds). |
| `doseGrams` | Beans to grind, 5–40 g. |
| `grinderSize` | Grind setting, 1–80. |
| `rpm` | Grinder speed: 60/70/80/90/100/110/120. |
| `ratio` | Brew ratio (1:N), **1:5–1:25 in 0.5 steps** (e.g. `17` for 1:17). |
| `pours[]` | Ordered pour stages. **Volumes should sum to `doseGrams × ratio`** (see note below). |
| `pours[].volume` | Water for this pour, ml. |
| `pours[].temperature` | °C (40–100). |
| `pours[].flowRate` | e.g. `3.5`. |
| `pours[].pattern` | `0` = center, `1` = circular, `2` = spiral. |
| `pours[].pausing` | Seconds to pause after this pour. |
| `pours[].vibBefore` / `vibAfter` | Optional grounds vibration. |
| `cupMax` / `cupMin` | Advanced: explicit cup weight bounds (g), overrides `cupType`. |

> **Dose & ratio are the source of truth.** The total water = `doseGrams × ratio`
> (e.g. 18 g × 17 = **306 ml**), and your pour volumes should add up to that. If they don't,
> the plugin logs a warning at startup — the machine will still pour exactly the volumes you
> entered, but the actual ratio in the cup won't match what you set. Adjust the pour volumes to
> sum to `dose × ratio`, or change the dose/ratio.

> **Tip:** dial in your recipe in the official xBloom app first, then copy the numbers
> (dose, grind, ratio, and each pour's water/temp/flow/pause/pattern) into the config.

---

## Usage

- **Siri:** *"Hey Siri, turn on Morning Pour Over."*
- **Automations:** trigger a brew from a HomeKit automation (alarm, time of day, a button…).
- The recipe switch turns itself **off automatically** when the brew finishes.
- The `xBloom Brewing` sensor shows **Open** while grinding/brewing and reports a **fault**
  if the machine reports *no beans*, *tank empty*, or *bad dose*.

Remember the machine must be **loaded** (pod/grounds + cup + water) — Bluetooth only starts
the program.

---

## Bluetooth & the single-device limit

The xBloom connects to **only one device at a time**. If your phone's app is connected, the
plugin can't connect, and vice-versa. This plugin is designed around that:

- **Connect-on-demand (automatic).** The plugin holds **no** permanent connection. It connects
  only when you start a brew, streams status until the brew completes, then **disconnects** —
  so the machine is free for your phone the rest of the time. You don't have to do anything.
- **Manual override (optional).** Enable `exposeConnectionSwitch` to get an `xBloom Bluetooth`
  switch:
  - **On** → the plugin connects and *holds* the link (e.g. to reserve it).
  - **Off** → releases it immediately, handing the machine back to your phone (even mid-brew —
    the machine keeps brewing on its own once started).
  - A safety **`holdTimeoutSec`** auto-releases the link so a manual hold never occupies the
    machine indefinitely.

If you try to brew while your phone is connected, the brew will fail to connect — just close
the app (or disconnect it) and try again.

---

## Troubleshooting

**"deviceAddress is required" / brew does nothing**
Set `deviceAddress` in the config. Find it with `bluetoothctl --timeout 12 scan le | grep -i xbloom`.

**Device not found / connect times out**
- The machine only advertises while **awake** and **not connected to your phone**. Wake it and
  disconnect the app, then retry.
- Confirm the adapter is on: `bluetoothctl show` → `Powered: yes` (`bluetoothctl power on`).

**`operation timed out` or `le-connection-abort-by-local`**
Transient BLE hiccups, common right after another connect/disconnect. The plugin retries; if it
persists, toggle the adapter (`bluetoothctl power off && bluetoothctl power on`).

**Permission denied / `org.bluez` access**
Homebridge is running as a non-root user without a D-Bus policy. Add the policy in
[Linux / BlueZ setup](#linux--bluez-setup) and `sudo systemctl reload dbus`.

**Docker: `org.bluez was not provided by any .service files`**
The plugin reached the container's D-Bus, which has no Bluetooth. Mount the host D-Bus socket and
set the `dbusAddress` config option — see [Docker Homebridge](#docker-homebridge). (Two one-time
steps; no container-wide environment variables needed.)

**Wrong Node version**
Homebridge v2 requires Node 22 or 24. Check with `node -v`.

**I just want to test without brewing**
Set `dryRun: true`. The plugin logs the exact frames it would send and never touches Bluetooth.

---

## How it works

xBloom exposes a serial-style BLE service (`0000e0ff-…`) with a write characteristic (FFE1)
and a notify characteristic (FFE2). A brew is the same four-frame sequence the official app
sends — set dose, set cup bounds, send the recipe, execute — and the machine streams status
codes back (grind/pour/complete, plus live weight and dispensed-ml telemetry). This plugin
re-implements that protocol natively in TypeScript and validates it against real captures.

Credit to the reverse-engineering work in
[PyBloom](https://github.com/fhenwood/PyBloom) and
[xbloom-ai-brew](https://github.com/Mel0day/xbloom-ai-brew).

---

## Support

If this saved you a few taps before coffee, you can support development here:

**☕ [ko-fi.com/aziz66](https://ko-fi.com/aziz66)**

Bug reports and PRs welcome on [GitHub](https://github.com/aziz66/homebridge-xbloom/issues).

---

## Disclaimer

This is an unofficial, community project. It is not affiliated with or endorsed by xBloom.
Brewing involves heat, water, and moving parts — only trigger a brew when the machine is
properly loaded and attended. The author is not responsible for any damage, mess, or
under-caffeination resulting from use.

## License

[MIT](LICENSE) © Abdulaziz Alharbi
