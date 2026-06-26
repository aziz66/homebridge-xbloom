/** Optional global "Stop Brew" momentary switch → sends BREW_STOP. */

import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';
import type { XBloomPlatform } from './platform.js';

export class StopAccessory {
  private readonly service: Service;

  constructor(
    private readonly platform: XBloomPlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    const { Service, Characteristic } = this.platform;

    this.accessory.getService(Service.AccessoryInformation)!
      .setCharacteristic(Characteristic.Manufacturer, 'xBloom')
      .setCharacteristic(Characteristic.Model, 'Coffee Machine');

    this.service =
      this.accessory.getService(Service.Switch) ??
      this.accessory.addService(Service.Switch, 'Stop Brew');
    this.service.setCharacteristic(Characteristic.Name, 'Stop Brew');

    this.service.getCharacteristic(Characteristic.On)
      .onGet(() => false)
      .onSet(this.handleSet.bind(this));
  }

  private async handleSet(value: CharacteristicValue): Promise<void> {
    const { Characteristic } = this.platform;
    if (!value) return;
    try {
      await this.platform.stopBrew();
    } finally {
      setTimeout(() => this.service.updateCharacteristic(Characteristic.On, false), 500);
    }
  }
}
