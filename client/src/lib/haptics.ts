import { Capacitor } from "@capacitor/core";

type HapticPattern = "light" | "medium" | "heavy" | "success" | "error" | "select";

// Cache the module after first import so subsequent calls are instant
let hapticsCache: typeof import("@capacitor/haptics") | null = null;
async function getNativeHaptics() {
  if (!hapticsCache) {
    hapticsCache = await import("@capacitor/haptics");
  }
  return hapticsCache;
}

// Pre-load on native so the first haptic fires without delay
if (Capacitor.isNativePlatform()) {
  getNativeHaptics().catch(() => {});
}

const webPatterns: Record<HapticPattern, number[]> = {
  light: [8],
  medium: [20],
  heavy: [40],
  select: [6],
  success: [40, 25, 60],
  error: [40, 40, 40],
};

export function haptic(type: HapticPattern = "light") {
  if (Capacitor.isNativePlatform()) {
    // Fire-and-forget — caller doesn't need to await
    (async () => {
      try {
        const { Haptics, ImpactStyle, NotificationType } = await getNativeHaptics();
        switch (type) {
          case "light":
            await Haptics.impact({ style: ImpactStyle.Light });
            break;
          case "select":
            await Haptics.selectionStart();
            break;
          case "medium":
            await Haptics.impact({ style: ImpactStyle.Medium });
            break;
          case "heavy":
            await Haptics.impact({ style: ImpactStyle.Heavy });
            break;
          case "success":
            await Haptics.notification({ type: NotificationType.Success });
            break;
          case "error":
            await Haptics.notification({ type: NotificationType.Error });
            break;
        }
      } catch {}
    })();
  } else {
    try {
      if (navigator.vibrate) {
        navigator.vibrate(webPatterns[type]);
      }
    } catch {}
  }
}

/**
 * Fire a choreographed sequence of haptic pulses at the given millisecond offsets.
 * Great for celebrations — compose heavier hits with success notifications for drama.
 */
export function hapticSequence(sequence: Array<{ type: HapticPattern; delay: number }>) {
  sequence.forEach(({ type, delay }) => {
    if (delay === 0) {
      haptic(type);
    } else {
      setTimeout(() => haptic(type), delay);
    }
  });
}
