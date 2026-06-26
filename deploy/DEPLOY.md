# Deploying homebridge-xbloom on nuc14 (Dockerized Homebridge)

The Homebridge container (`homebridge/homebridge:latest`, host network) must reach the **host's**
BlueZ (`bluetoothd`) over D-Bus for `node-ble` to work.

## Gotcha: the container already runs its own D-Bus

The compose sets `ENABLE_AVAHI=1`, so the image starts an **internal** avahi + D-Bus for mDNS.
That means `/run/dbus` *inside* the container is the container's own bus — NOT the host's
`bluetoothd`. So we mount the host bus at a **separate path** and point node-ble at it via
`DBUS_SYSTEM_BUS_ADDRESS`, leaving the container's avahi bus untouched.

## compose override (apply at deploy time)

Add to `/home/aziz/homebridge/docker-compose.yml` under `services.homebridge`:

```yaml
    volumes:
      - ./volumes/homebridge:/homebridge
      - /run/dbus/system_bus_socket:/run/host-dbus/system_bus_socket:ro   # host bluetoothd bus
    environment:
      - ENABLE_AVAHI=1
      - DBUS_SYSTEM_BUS_ADDRESS=unix:path=/run/host-dbus/system_bus_socket # node-ble → host bus
```

Then `docker compose up -d` (brief Homebridge restart — drops HomeKit for a few seconds).

## D-Bus permission

- The homebridge image runs the bridge **as root** by default → BlueZ's default policy already
  allows BLE access; no extra policy file needed.
- Only if you run the bridge as a non-root UID (PUID set): install `node-ble-dbus.conf` to
  `/etc/dbus-1/system.d/` with a `<policy user="...">` block for that UID, then
  `sudo systemctl reload dbus`.

## Adapter

`bluetoothd` owns `hci0`; node-ble shares it via D-Bus (no contention). Ensure the adapter is
powered (`bluetoothctl power on`) — it is set to power on with the service.

## Host-only smoke test (no container)

`npm run build && sudo env "PATH=$PATH" node scripts/smoke.mjs` — connects read-only and observes
FFE2. Requires the machine to be **awake/advertising**.
