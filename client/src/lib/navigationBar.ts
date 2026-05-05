import { registerPlugin } from '@capacitor/core';

export interface NavigationBarPlugin {
  setBackgroundColor(options: { color: string }): Promise<void>;
  setButtonStyle(options: { style: 'DARK' | 'LIGHT' }): Promise<void>;
}

class NavigationBarWeb implements NavigationBarPlugin {
  async setBackgroundColor(_options: { color: string }): Promise<void> {
    // no-op on web — Android native implementation handles this
  }
  async setButtonStyle(_options: { style: 'DARK' | 'LIGHT' }): Promise<void> {
    // no-op on web — Android native implementation handles this
  }
}

const NavigationBar = registerPlugin<NavigationBarPlugin>('NavigationBar', {
  web: () => new NavigationBarWeb(),
});

export { NavigationBar };
