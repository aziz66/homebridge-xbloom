/**
 * "xBloom Bluetooth" hold/release switch (manual override for the single-central
 * constraint).
 *   ON  → Homebridge connects and HOLDS the link (reserve it / watch status).
 *   OFF → release the link so your phone can connect (force-disconnect if idle).
 * Normal brewing works without touching this (connect-on-demand).
 */

import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';
import type { XBloomPlatform } from './platform.js';

export class ConnectionAccessory {
  private readonly service: Service;

  constructor(
    private readonly platform: XBloomPlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    const { Service, Characteristic } = this.platform;

    this.accessory.getService(Service.AccessoryInformation)!
      .setCharacteristic(Characteristic.Manufacturer, 'xBloom')
      .setCharacteristic(Characteristic.Model, 'BLE Link');

    this.service =
      this.accessory.getService(Service.Switch) ??
      this.accessory.addService(Service.Switch, 'xBloom Bluetooth');
    this.service.setCharacteristic(Characteristic.Name, 'xBloom Bluetooth');

    this.service.getCharacteristic(Characteristic.On)
      .onGet(() => this.platform.isHeld())
      .onSet((v: CharacteristicValue) => this.platform.setHeld(Boolean(v)));
  }

  updateOn(on: boolean): void {
    this.service.updateCharacteristic(this.platform.Characteristic.On, on);
  }
}
