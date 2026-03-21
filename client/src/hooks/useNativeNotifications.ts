import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";

let apnsRegistered = false;

export function useNativeNotifications(enabled: boolean) {
  useEffect(() => {
    if (!enabled || apnsRegistered) return;
    if (!Capacitor.isNativePlatform()) return;

    registerNativePush();
  }, [enabled]);
}

export type PushPermissionResult = "granted" | "denied" | "error";

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
      return "error:" + permission.receive;
    }

    PushNotifications.addListener("registration", async (token) => {
      console.log("[APNs] Device token received:", token.value.substring(0, 10) + "...");
      apnsRegistered = true;
      try {
        await fetch("/api/push/register-apns", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ deviceToken: token.value }),
        });
        console.log("[APNs] Token registered with server");
      } catch (err) {
        console.error("[APNs] Failed to register token with server:", err);
      }
    });

    PushNotifications.addListener("registrationError", (err) => {
      console.error("[APNs] Registration error:", err);
    });

    await PushNotifications.register();
    return "granted";
  } catch (err: any) {
    const msg = String(err?.message || err || "unknown");
    console.error("[APNs] Failed to initialise push notifications:", msg);
    return "error:" + msg;
  }
}

export function openAppSettings() {
  window.open("app-settings:", "_system");
}

export function isNativePlatform(): boolean {
  return Capacitor.isNativePlatform();
}
