/**
 * "xBloom Brewing" status sensor — a read-only ContactSensor visible in Apple
 * Home. Open (NOT_DETECTED) while grinding/brewing, Closed (DETECTED) when idle.
 * StatusFault surfaces machine errors (no beans / tank empty / bad dose).
 */

import type { PlatformAccessory, Service } from 'homebridge';
import type { XBloomPlatform } from './platform.js';

export class BrewingSensor {
  private readonly service: Service;

  constructor(
    private readonly platform: XBloomPlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    const { Service, Characteristic } = this.platform;

    this.accessory.getService(Service.AccessoryInformation)!
      .setCharacteristic(Characteristic.Manufacturer, 'xBloom')
      .setCharacteristic(Characteristic.Model, 'Brew Status');

    this.service =
      this.accessory.getService(Service.ContactSensor) ??
      this.accessory.addService(Service.ContactSensor, 'xBloom Brewing');
    this.service.setCharacteristic(Characteristic.Name, 'xBloom Brewing');
    this.setBrewing(false);
    this.setFault(false);
  }

  setBrewing(brewing: boolean): void {
    const { Characteristic } = this.platform;
    this.service.updateCharacteristic(
      Characteristic.ContactSensorState,
      brewing
        ? Characteristic.ContactSensorState.CONTACT_NOT_DETECTED
        : Characteristic.ContactSensorState.CONTACT_DETECTED,
    );
  }

  setFault(fault: boolean): void {
    const { Characteristic } = this.platform;
    this.service.updateCharacteristic(
      Characteristic.StatusFault,
      fault
        ? Characteristic.StatusFault.GENERAL_FAULT
        : Characteristic.StatusFault.NO_FAULT,
    );
  }
}
