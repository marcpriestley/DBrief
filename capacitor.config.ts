import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.dbrief.app',
  appName: 'DBrief',
  webDir: 'dist/public',
  server: {
    url: 'https://DBrief.replit.app',
    cleartext: false,
  },
  ios: {
    preferredContentMode: 'mobile',
    // Dark background so any WKWebView gap shows the correct colour before
    // web CSS loads or during brief native repaints.
    backgroundColor: '#141414',
    // Do NOT set contentInset:'never'. The default (automatic) lets
    // env(safe-area-inset-*) return real device values (34 px bottom on Face
    // ID, 47–59 px top depending on model).  'never' made env() return 0,
    // forcing fragile JS hacks that could never be 100 % reliable across all
    // iPhone models.  With real env() values, a single CSS rule covers every
    // device perfectly.
  },
  plugins: {
    // Native-layer StatusBar config — applied before any JS runs so keyboard
    // transitions can't catch us in a "not yet overlaid" state.
    StatusBar: {
      style: 'LIGHT',          // white clock/battery icons on dark background
      overlaysWebView: true,   // WKWebView extends behind the status bar
      // Opaque dark background — prevents iOS painting a white slab behind the
      // status bar during keyboard animations or contentInset resets.
      // '#00000000' (transparent) caused white flashes on light-mode iOS devices.
      backgroundColor: '#141414',
    },
    Keyboard: {
      // 'none' stops Capacitor from resizing the WKWebView when the keyboard
      // opens / closes.  The default 'body' resize shrinks then re-expands the
      // WKWebView frame on every keyboard event; that resize animation briefly
      // exposes the native background at the top and bottom of the screen.
      // With 'none' the WKWebView stays full-screen; the keyboard just overlays
      // content.  We use window.visualViewport to scroll inputs into view ourselves.
      resize: 'none',
    },
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: '#1a1a2e',
      showSpinner: false,
    },
  },
};

export default config;
