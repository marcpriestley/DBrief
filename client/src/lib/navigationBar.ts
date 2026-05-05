/**
 * NavigationBar Capacitor plugin
 *
 * Bridges to a native Android NavigationBar plugin via Capacitor's plugin
 * registry using the standard registerPlugin() pattern (Capacitor v3+).
 *
 * Native side requirement:
 *   The Android native build must register a plugin named "NavigationBar"
 *   that exposes setBackgroundColor({ color: string }) and
 *   setButtonStyle({ style: 'DARK' | 'LIGHT' }).  Any plugin that matches
 *   this interface works (e.g. a custom Capacitor Android plugin in the
 *   android/ native project).
 *
 * Web / iOS: NavigationBarWeb no-ops silently — no visible effect needed.
 *
 * Dev warning: a one-time console.warn fires on Android when the first call
 * fails (plugin not yet registered in native build), so the missing wiring
 * is immediately visible during development rather than silently swallowed.
 */
import { Capacitor, registerPlugin } from '@capacitor/core';

export interface NavigationBarPlugin {
  setBackgroundColor(options: { color: string }): Promise<void>;
  setButtonStyle(options: { style: 'DARK' | 'LIGHT' }): Promise<void>;
}

class NavigationBarWeb implements NavigationBarPlugin {
  async setBackgroundColor(_options: { color: string }): Promise<void> {
    // no-op on web and iOS
  }
  async setButtonStyle(_options: { style: 'DARK' | 'LIGHT' }): Promise<void> {
    // no-op on web and iOS
  }
}

const _NavigationBarRaw = registerPlugin<NavigationBarPlugin>('NavigationBar', {
  web: () => new NavigationBarWeb(),
});

let _pluginWarned = false;

function warnIfMissing(err: unknown) {
  if (!_pluginWarned && Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android') {
    _pluginWarned = true;
    if (import.meta.env.DEV) {
      console.warn(
        '[NavigationBar] Plugin not registered in native Android build. ' +
        'Bottom nav bar colour will not be set. ' +
        'Add a Capacitor Android plugin that exposes NavigationBar.setBackgroundColor / setButtonStyle.',
        err,
      );
    }
  }
}

export const NavigationBar: NavigationBarPlugin = {
  setBackgroundColor: (opts) =>
    _NavigationBarRaw.setBackgroundColor(opts).catch((e) => { warnIfMissing(e); }),
  setButtonStyle: (opts) =>
    _NavigationBarRaw.setButtonStyle(opts).catch((e) => { warnIfMissing(e); }),
};
