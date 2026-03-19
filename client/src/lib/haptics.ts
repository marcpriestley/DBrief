type HapticPattern = "light" | "medium" | "heavy" | "success" | "error" | "select";

const patterns: Record<HapticPattern, number[]> = {
  light: [8],
  medium: [20],
  heavy: [40],
  select: [6],
  success: [40, 25, 60],
  error: [40, 40, 40],
};

export function haptic(type: HapticPattern = "light") {
  try {
    if (navigator.vibrate) {
      navigator.vibrate(patterns[type]);
    }
  } catch {}
}
