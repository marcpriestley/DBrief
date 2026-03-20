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

export async function registerNativePush(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;

  try {
    const { PushNotifications } = await import("@capacitor/push-notifications");

    let permission = await PushNotifications.checkPermissions();

    if (permission.receive === "prompt") {
      permission = await PushNotifications.requestPermissions();
    }

    if (permission.receive !== "granted") {
      console.log("[APNs] Permission not granted:", permission.receive);
      return;
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
  } catch (err) {
    console.error("[APNs] Failed to initialise push notifications:", err);
  }
}

export function isNativePlatform(): boolean {
  return Capacitor.isNativePlatform();
}
