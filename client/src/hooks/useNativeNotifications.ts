import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";

// Track registration state at module level so it survives re-renders
let apnsRegistered = false;
// Token that arrived before the user was logged in — retried after auth
let pendingApnsToken: string | null = null;

async function sendTokenToServer(token: string): Promise<boolean> {
  try {
    const res = await fetch("/api/push/register-apns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ deviceToken: token }),
    });

    if (!res.ok) {
      if (res.status === 401) {
        // Not logged in yet — hold the token so useNativeNotifications can
        // retry it once the user's session is confirmed.
        pendingApnsToken = token;
        console.log("[APNs] Not authenticated yet — token saved for post-login retry");
      } else {
        console.error("[APNs] Server rejected token registration:", res.status);
      }
      return false;
    }

    console.log("[APNs] Token registered with server successfully");
    pendingApnsToken = null;
    apnsRegistered = true;
    return true;
  } catch (err) {
    // Network error — keep the token so we can retry
    console.error("[APNs] Network error registering token:", err);
    pendingApnsToken = token;
    return false;
  }
}

// Listen for APNs token injected directly from Swift ViewController.
// This fires at app launch — possibly before the user has logged in.
if (typeof window !== "undefined") {
  window.addEventListener("apns-token", async (e: any) => {
    const token = e.detail;
    if (!token) return;
    console.log("[APNs] Token received via native bridge:", token.substring(0, 10) + "...");
    // Always attempt to register; sendTokenToServer handles auth failures gracefully
    if (!apnsRegistered) {
      await sendTokenToServer(token);
    }
  });
}

/**
 * Called after the user is confirmed logged in.
 * Retries any token that arrived before authentication completed, or
 * kicks off a fresh Capacitor registration if no token exists yet.
 */
// When the notification tap fires before React mounts, the dbrief:open-mood
// event has no listeners yet. We persist the intent here and let AppLayout
// pick it up via consumePendingMoodOpen() inside its mount useEffect.
let pendingMoodOpen = false;

// Dispatch a custom event to open the mood check-in modal.
// Uses THREE redundant signals so the intent survives any timing gap:
//  1. In-memory flag (fast path, same session)
//  2. sessionStorage (survives module reload / HMR)
//  3. URL param written to history (caught by checkMoodParam on any mount)
function dispatchOpenMood() {
  pendingMoodOpen = true;
  try { sessionStorage.setItem("dbrief:mood-pending", "1"); } catch {}
  try { history.replaceState(null, "", "/?mood=checkin"); } catch {}
  window.dispatchEvent(new CustomEvent("dbrief:open-mood"));
}

/**
 * Called by AuthenticatedRouter on mount. Returns true (and clears all signals)
 * if a notification tap arrived before the listener was registered.
 */
export function consumePendingMoodOpen(): boolean {
  let fromSession = false;
  try { fromSession = sessionStorage.getItem("dbrief:mood-pending") === "1"; } catch {}
  if (pendingMoodOpen || fromSession) {
    pendingMoodOpen = false;
    try { sessionStorage.removeItem("dbrief:mood-pending"); } catch {}
    return true;
  }
  return false;
}

// Handle a notification tap URL
function handleNotificationUrl(url?: string) {
  if (!url) return;
  if (url.includes("mood=checkin")) {
    // Write ?mood=checkin into the browser URL so AppLayout's checkMoodParam()
    // catches it on mount — this survives timing races where the event fires
    // before or during component mounting (cold-start, background resume, etc.)
    // NOTE: do NOT dispatch a synthetic popstate event here — wouter listens for
    // popstate and would treat the URL change as navigation, potentially unmounting
    // components and disrupting in-flight queries.  dispatchOpenMood() handles the
    // "app already open" path via the dbrief:open-mood custom event instead.
    if (typeof history !== "undefined") {
      history.replaceState(null, "", "/?mood=checkin");
    }
    dispatchOpenMood();
  }
}

// Clears the app icon badge via a silent server-side APNs push.
// Throttled so we don't spam the server — at most once every 30 seconds.
let lastBadgeClear = 0;
export function clearBadge() {
  const now = Date.now();
  if (now - lastBadgeClear < 30_000) return;
  lastBadgeClear = now;
  fetch("/api/push/clear-badge", { method: "POST", credentials: "include" }).catch(() => {});
}

// Set up notification tap listener (called once after registration)
let tapListenerSetup = false;
export async function setupNotificationTapListener() {
  if (tapListenerSetup || !Capacitor.isNativePlatform()) return;
  tapListenerSetup = true;
  try {
    const { PushNotifications } = await import("@capacitor/push-notifications");

    // Show notification as a system banner even when app is in foreground.
    // Capacitor requires this listener to exist for iOS to present the alert.
    await PushNotifications.addListener("pushNotificationReceived", (notification) => {
      const data: Record<string, any> = notification.data ?? {};
      const type = (data.type ?? data.TYPE ?? data.category) as string | undefined;
      const url  = (data.url  ?? data.URL)  as string | undefined;
      console.log("[APNs] Foreground notification received:", notification.title, "type:", type);
      // Fire a browser-level custom event so UI components can react (e.g. toast)
      window.dispatchEvent(new CustomEvent("dbrief:notification", {
        detail: { title: notification.title, body: notification.body, type, url }
      }));
    });

    await PushNotifications.addListener("notificationActionPerformed", (action) => {
      const data: Record<string, any> = action.notification?.data ?? {};
      const url  = (data.url  ?? data.URL)  as string | undefined;
      const type = (data.type ?? data.TYPE ?? data.category) as string | undefined;
      console.log("[APNs] Notification tapped, url:", url, "type:", type);
      // Mood check-in: detect by type field (preferred) or URL fallback
      if (type === "MOOD_CHECKIN" || url?.includes("mood=checkin")) {
        dispatchOpenMood();
      } else {
        handleNotificationUrl(url);
      }
    });
    // When app comes to foreground: clear notification centre AND reset badge
    clearBadge();
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        PushNotifications.removeAllDeliveredNotifications().catch(() => {});
        clearBadge();
      }
    });
  } catch (err) {
    console.log("[APNs] Tap listener setup skipped:", err);
  }
}

// Also handle taps delivered via native bridge before React mounted
if (typeof window !== "undefined") {
  window.addEventListener("apns-notification-tap", (e: any) => {
    const detail = e.detail ?? {};
    const url  = (detail.url  ?? detail.URL)  as string | undefined;
    const type = (detail.type ?? detail.TYPE ?? detail.category) as string | undefined;
    if (type === "MOOD_CHECKIN" || url?.includes("mood=checkin")) {
      dispatchOpenMood();
    } else {
      handleNotificationUrl(url);
    }
  });
}

// Eagerly register the Capacitor notification-tap listener at module load time.
// On a cold-start from a notification tap, Capacitor fires notificationActionPerformed
// very early — before any React component mounts. If we wait until after auth to call
// setupNotificationTapListener(), the event fires into the void. Calling it here
// ensures the listener exists before the first event can arrive.
if (typeof window !== "undefined" && Capacitor.isNativePlatform()) {
  setupNotificationTapListener();
}

export function useNativeNotifications(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    if (!Capacitor.isNativePlatform()) return;

    setupNotificationTapListener();

    if (apnsRegistered) return;

    // Case 1: token arrived pre-login via native bridge and needs to be re-sent now
    if (pendingApnsToken) {
      console.log("[APNs] Retrying pending token after login...");
      sendTokenToServer(pendingApnsToken);
      return;
    }

    // Case 2: token was injected into window by Swift ViewController before React mounted
    const win = window as any;
    if (win.__apnsToken) {
      console.log("[APNs] Found pre-loaded token from native bridge");
      sendTokenToServer(win.__apnsToken);
      return;
    }

    // Case 3: no token yet — trigger a fresh Capacitor registration flow
    registerNativePush();
  }, [enabled]);
}

export type PushPermissionResult = "granted" | "denied" | "error" | `error:${string}`;

export async function registerNativePush(): Promise<PushPermissionResult> {
  if (!Capacitor.isNativePlatform()) return "error";

  try {
    const { PushNotifications } = await import("@capacitor/push-notifications");

    let permission = await PushNotifications.checkPermissions();
    console.log("[APNs] Current permission state:", permission.receive);

    // Always call requestPermissions — on iOS it returns current state without
    // showing a dialog if already granted or denied. This handles the case where
    // the user manually enabled notifications in iOS Settings after an initial denial.
    permission = await PushNotifications.requestPermissions();
    console.log("[APNs] After requestPermissions:", permission.receive);

    if (permission.receive === "denied") {
      console.log("[APNs] Permission denied — user must enable in iOS Settings");
      return "denied";
    }

    if (permission.receive !== "granted") {
      console.log("[APNs] Permission not granted:", permission.receive);
      return `error:${permission.receive}`;
    }

    // addListener returns a Promise in Capacitor — must await before calling register()
    // so the listener is guaranteed to be set up before the registration event fires.
    await PushNotifications.addListener("registration", async (token) => {
      console.log("[APNs] Device token via Capacitor plugin:", token.value.substring(0, 10) + "...");
      await sendTokenToServer(token.value);
    });

    await PushNotifications.addListener("registrationError", (err) => {
      console.error("[APNs] Registration error:", err.error);
    });

    await PushNotifications.register();
    return "granted";
  } catch (err: any) {
    const msg = String(err?.message || err || "unknown");
    console.log("[APNs] Capacitor plugin unavailable, relying on native bridge:", msg);
    return `error:${msg}`;
  }
}

export function openAppSettings() {
  window.open("app-settings:", "_system");
}

export function isNativePlatform(): boolean {
  return Capacitor.isNativePlatform();
}
