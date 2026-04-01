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
export function useNativeNotifications(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    if (!Capacitor.isNativePlatform()) return;
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

    if (permission.receive === "prompt" || permission.receive === "prompt-with-rationale") {
      permission = await PushNotifications.requestPermissions();
      console.log("[APNs] After request:", permission.receive);
    }

    if (permission.receive === "denied") {
      console.log("[APNs] Permission denied — user must enable in iOS Settings");
      return "denied";
    }

    if (permission.receive !== "granted") {
      console.log("[APNs] Permission not granted:", permission.receive);
      return `error:${permission.receive}`;
    }

    PushNotifications.addListener("registration", async (token) => {
      console.log("[APNs] Device token via Capacitor plugin:", token.value.substring(0, 10) + "...");
      await sendTokenToServer(token.value);
    });

    PushNotifications.addListener("registrationError", (err) => {
      console.error("[APNs] Registration error:", err);
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
