# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
