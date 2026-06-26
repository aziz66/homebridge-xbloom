/**
 * One HomeKit Switch per recipe. Momentary: turning it On starts the brew
 * (connect-on-demand, handled by the platform), and the platform resets it to
 * Off when the brew finishes. → "Hey Siri, turn on Ethiopia".
 */

import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';
import type { XBloomPlatform } from './platform.js';
import type { RecipeConfig } from './config.js';

export class RecipeAccessory {
  private readonly service: Service;

  constructor(
    private readonly platform: XBloomPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly recipe: RecipeConfig,
  ) {
    const { Service, Characteristic } = this.platform;

    this.accessory.getService(Service.AccessoryInformation)!
      .setCharacteristic(Characteristic.Manufacturer, 'xBloom')
      .setCharacteristic(Characteristic.Model, 'Coffee Machine')
      .setCharacteristic(Characteristic.SerialNumber, this.accessory.UUID.slice(0, 12));

    this.service =
      this.accessory.getService(Service.Switch) ??
      this.accessory.addService(Service.Switch, this.recipe.name);
    this.service.setCharacteristic(Characteristic.Name, this.recipe.name);

    this.service.getCharacteristic(Characteristic.On).onSet(this.handleSet.bind(this));
  }

  private async handleSet(value: CharacteristicValue): Promise<void> {
    if (!value) return; // turning off is a no-op (momentary)
    const onChar = {
      updateOn: (v: boolean) =>
        this.service.updateCharacteristic(this.platform.Characteristic.On, v),
    };
    // Fire-and-forget: the platform manages connect → brew → status → reset.
    void this.platform.startBrew(this.recipe, onChar);
  }
}
