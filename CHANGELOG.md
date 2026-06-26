# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-06-26

### Added
- **Auto-discovery by name.** Leave `deviceAddress` blank and the plugin finds your machine by
  its advertised name (default prefix `XBLOOM `) — no need to look up a MAC address. Set an
  explicit address only if you have more than one machine.

### Fixed
- The config/README previously implied "leave blank to scan by name," but that path wasn't
  implemented (it errored). It now works.

[1.1.0]: https://github.com/aziz66/homebridge-xbloom/releases/tag/v1.1.0

## [1.0.0] - 2026-06-26

First stable release. Verified end-to-end on real hardware — a brew triggered from
HomeKit grinds and brews, with live status (including error reporting) back in Apple Home.

### Added
- Project logo / branding.

No functional changes since 0.1.4; promoted to 1.0.0 to mark a stable first release.

[1.0.0]: https://github.com/aziz66/homebridge-xbloom/releases/tag/v1.0.0

## [0.1.4] - 2026-06-26

### Fixed
- **A D-Bus connection failure no longer crashes the Homebridge child bridge.** The plugin now
  catches the bus `error` event (e.g. AppArmor denials) and reports it as a normal, catchable
  failure instead of an uncaught exception.

### Added
- Friendly error for **AppArmor** denials (common on Dockerized Homebridge), pointing to the
  `security_opt: apparmor=unconfined` fix. README Docker section updated accordingly.

[0.1.4]: https://github.com/aziz66/homebridge-xbloom/releases/tag/v0.1.4

## [0.1.3] - 2026-06-26

### Added
- Recipe consistency check: **dose × ratio = total pour water**. If your pour volumes don't add
  up to `doseGrams × ratio`, the plugin logs a warning at startup (showing the expected ml and
  the actual ratio it will brew). Non-fatal — the machine still pours the configured volumes.

### Changed
- `ratio` is now constrained to **1:5–1:25 in 0.5 steps** in the config schema, with a clearer
  description that dose and ratio are the source of truth for total water.

[0.1.3]: https://github.com/aziz66/homebridge-xbloom/releases/tag/v0.1.3

## [0.1.2] - 2026-06-26

### Fixed
- Corrected the broken docs link in the "Bluetooth not reachable" error message
  (`#docker` → `#docker-homebridge`).

[0.1.2]: https://github.com/aziz66/homebridge-xbloom/releases/tag/v0.1.2

## [0.1.1] - 2026-06-26

### Added
- `dbusAddress` config option to point the plugin's Bluetooth connection at a specific D-Bus
  system bus — needed only for **Dockerized Homebridge** to reach the host's `bluetoothd`.
  It's applied to the plugin's process only, so the container's avahi/HomeKit advertising is
  left untouched (no container-wide environment variables).

### Changed
- Friendlier error when `org.bluez` isn't reachable on the D-Bus, with a direct pointer to the
  Docker setup instructions instead of a raw `DBusError`.
- README Docker section simplified to two one-time steps (mount the host socket + set
  `dbusAddress`); native (non-Docker) installs need nothing.

### Fixed
- Dockerized Homebridge installs failing with
  *"The name org.bluez was not provided by any .service files"*.

[0.1.1]: https://github.com/aziz66/homebridge-xbloom/releases/tag/v0.1.1

## [0.1.0] - 2026-06-26

Initial public release.

### Added
- **One HomeKit switch per recipe** — trigger a brew by name with Siri, scenes, or automations.
- **Recipes defined in the config UI** — dose, grind size, RPM, ratio, and a full pour profile
  (water / temperature / flow rate / pattern / pause / vibration per pour).
- **Native xBloom BLE protocol** in TypeScript (FFE1 write / FFE2 notify), validated
  byte-for-byte against real machine captures.
- **`node-ble` transport** over D-Bus/BlueZ — coexists with `bluetoothd`, no adapter takeover.
- **Connect-on-demand** — no persistent Bluetooth connection; the machine stays free for the
  phone app between brews.
- **Optional `xBloom Bluetooth` switch** — manual hold/release override for the single-device
  limit, with a configurable auto-release timeout.
- **`xBloom Brewing` status sensor** — visible in Apple Home, with fault reporting for
  *no beans*, *tank empty*, and *bad dose*.
- **Optional `Stop Brew` switch.**
- **Live brew telemetry decoding** — cup weight, dispensed millilitres, pour index, and
  grind → brew → complete lifecycle states (logged during a brew).
- **Dry-run mode** — log the exact frames that would be sent without touching Bluetooth.
- Documentation: README (installation, Docker D-Bus setup, troubleshooting, and the
  single-device Bluetooth limit) and a deployment guide.

[0.1.0]: https://github.com/aziz66/homebridge-xbloom/releases/tag/v0.1.0
