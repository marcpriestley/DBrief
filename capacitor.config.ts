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
    // Dark background so any WKWebView gap (safe-area or keyboard transition)
    // shows the correct colour before web CSS loads or during contentInset resets.
    backgroundColor: '#141414',
    // 'never' extends the WKWebView behind the home indicator (bottom) and the
    // status bar (top), making env(safe-area-inset-*) return 0. The web layer
    // compensates with the --sai-* CSS variables set in index.html which use
    // max(env(...), 34px) / max(env(...), 47px) as fallbacks for Face ID phones.
    contentInset: 'never',
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
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: '#1a1a2e',
      showSpinner: false,
    },
  },
};

export default config;
