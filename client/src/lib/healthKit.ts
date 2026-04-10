import { Capacitor, registerPlugin } from "@capacitor/core";
import { Health } from "capacitor-health";

// Local Capacitor plugin compiled directly into the app target — bypasses SPM caching.
// Handles sleep queries and extended permission checks that the SPM plugin may miss.
interface ExtendedHealthInterface {
  querySleep: (opts: { startDate: string; endDate: string }) => Promise<{ minutes: number }>;
  querySleepQuality: (opts: { startDate: string; endDate: string }) => Promise<{ efficiency: number; minutes: number }>;
}
const ExtendedHealth = registerPlugin<ExtendedHealthInterface>("ExtendedHealth");

export function isNativeIOS(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";
}

// Extended data type strings (matching the enhanced Swift plugin)
type DataType =
  | "steps"
  | "active-calories"
  | "flights-climbed"
  | "walking-distance"
  | "exercise-minutes"
  | "heart-rate"
  | "resting-heart-rate"
  | "hrv"
  | "oxygen-saturation"
  | "body-mass"
  | "body-fat"
  | "respiratory-rate"
  | "sleep"
  | "sleep-quality"
  | "mindfulness";

interface MetricDef {
  dataType: DataType;
  /** Convert the raw HealthKit value to a 0–100 score */
  normalize: (raw: number) => number;
  permission: string;
}

// Map from display name → HealthKit config
const METRIC_MAP: Record<string, MetricDef> = {
  "Steps": {
    dataType: "steps",
    normalize: (v) => Math.round(v), // raw step count
    permission: "READ_STEPS",
  },
  "Active Energy": {
    dataType: "active-calories",
    normalize: (v) => Math.round(v), // raw kcal
    permission: "READ_ACTIVE_CALORIES",
  },
  "Flights Climbed": {
    dataType: "flights-climbed",
    normalize: (v) => Math.round(v), // raw flight count
    permission: "READ_FLIGHTS_CLIMBED",
  },
  "Walking Distance": {
    dataType: "walking-distance",
    normalize: (v) => Math.round(v * 10) / 10, // km, 1 decimal
    permission: "READ_WALKING_DISTANCE",
  },
  "Exercise Minutes": {
    dataType: "exercise-minutes",
    normalize: (v) => Math.round(v), // raw minutes
    permission: "READ_EXERCISE_MINUTES",
  },
  "Sleep Duration": {
    dataType: "sleep",
    normalize: (v) => Math.round(v / 60 * 10) / 10, // minutes → hours, 1 decimal
    permission: "READ_SLEEP",
  },
  "Sleep Quality": {
    dataType: "sleep-quality",
    normalize: (v) => Math.min(100, Math.round(v)), // efficiency % (0–100)
    permission: "READ_SLEEP",
  },
  "Heart Rate": {
    dataType: "heart-rate",
    normalize: (v) => Math.round(v), // bpm
    permission: "READ_HEART_RATE",
  },
  "Resting Heart Rate": {
    dataType: "resting-heart-rate",
    normalize: (v) => Math.round(v), // bpm
    permission: "READ_RESTING_HEART_RATE",
  },
  "HRV": {
    dataType: "hrv",
    normalize: (v) => Math.round(v), // ms
    permission: "READ_HRV",
  },
  "Blood Oxygen": {
    dataType: "oxygen-saturation",
    normalize: (v) => Math.round(v * 10) / 10, // %
    permission: "READ_OXYGEN_SATURATION",
  },
  "Body Weight": {
    dataType: "body-mass",
    normalize: (v) => Math.round(v * 10) / 10, // kg
    permission: "READ_BODY_MASS",
  },
  "Body Fat %": {
    dataType: "body-fat",
    normalize: (v) => Math.round(v * 10) / 10, // %
    permission: "READ_BODY_FAT",
  },
  "Mindful Minutes": {
    dataType: "mindfulness",
    normalize: (v) => Math.round(v), // raw minutes
    permission: "READ_MINDFULNESS",
  },
  "Respiratory Rate": {
    dataType: "respiratory-rate",
    normalize: (v) => Math.round(v * 10) / 10, // breaths/min
    permission: "READ_RESPIRATORY_RATE",
  },
};

// Build permissions list from metric map
const ALL_PERMISSIONS = [
  ...new Set(Object.values(METRIC_MAP).map(m => m.permission)),
  "READ_WORKOUTS",
  "READ_DISTANCE",
];

// localStorage key
const AUTH_KEY = "dbrief_health_authorized";

let _lastHealthError: string | null = null;
export function getLastHealthError(): string | null { return _lastHealthError; }

export function getHealthAuthState(): boolean {
  return localStorage.getItem(AUTH_KEY) === "true";
}

export function setHealthAuthState(v: boolean): void {
  localStorage.setItem(AUTH_KEY, v ? "true" : "false");
}

/** Returns metric display names that can be auto-synced */
export function getHealthSyncableMetrics(): string[] {
  return Object.keys(METRIC_MAP);
}

export type HealthAvailability = "available" | "not_installed" | "not_ios" | "unavailable";

export async function checkHealthAvailable(): Promise<HealthAvailability> {
  if (!isNativeIOS()) return "not_ios";
  try {
    const { available } = await Health.isHealthAvailable();
    return available ? "available" : "unavailable";
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    _lastHealthError = msg;
    const low = msg.toLowerCase();
    if (low.includes("not implemented") || low.includes("not available") ||
        low.includes("unimplemented") || low.includes("no implementation")) {
      return "not_installed";
    }
    return "unavailable";
  }
}

export type HealthAuthResult = "granted" | "denied" | "not_installed" | "error";

export async function requestHealthPermissions(): Promise<HealthAuthResult> {
  if (!isNativeIOS()) return "not_installed";
  try {
    await (Health as any).requestHealthPermissions({ permissions: ALL_PERMISSIONS });
    setHealthAuthState(true);
    _lastHealthError = null;
    return "granted";
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    _lastHealthError = msg;
    console.error("[HealthKit] Authorization error:", msg);
    const low = msg.toLowerCase();
    if (low.includes("not implemented") || low.includes("not available") ||
        low.includes("unimplemented") || low.includes("no implementation") ||
        low.includes("plugin") || low.includes("not found")) {
      return "not_installed";
    }
    if (low.includes("denied") || low.includes("restricted")) {
      return "denied";
    }
    return "error";
  }
}

/** Query one metric for a date; returns the raw HealthKit value (pre-normalization) */
async function queryRawMetric(dataType: DataType, dateStr: string): Promise<number | null> {
  try {
    let startDate: string;
    let endDate: string;

    if (dataType === "sleep" || dataType === "sleep-quality") {
      // Sleep samples span midnight and can start/end at irregular times.
      // Use a wide 40-hour window (previous day 4 AM → today 8 PM local) to
      // ensure no session is missed regardless of timezone or nap timing.
      const todayLocal = new Date(`${dateStr}T20:00:00`); // no Z → local time
      const prevLocal  = new Date(`${dateStr}T04:00:00`);
      prevLocal.setDate(prevLocal.getDate() - 1);
      startDate = prevLocal.toISOString();
      endDate   = todayLocal.toISOString();
    } else {
      // For all other metrics, a UTC-day window is accurate enough
      startDate = `${dateStr}T00:00:00.000Z`;
      endDate   = `${dateStr}T23:59:59.999Z`;
    }

    // ── Sleep Quality ──────────────────────────────────────────────────────────
    if (dataType === "sleep-quality") {
      // Primary: ExtendedHealth plugin (compiled directly into app — always reliable)
      try {
        const r = await ExtendedHealth.querySleepQuality({ startDate, endDate });
        if (r.efficiency > 0) {
          console.log("[HealthKit] sleep-quality via ExtendedHealth:", r.efficiency);
          return Math.min(100, Math.round(r.efficiency));
        }
        // If efficiency is 0 but we have minutes, compute proxy from duration
        if (r.minutes > 0) {
          return Math.min(100, Math.round((r.minutes / 480) * 100));
        }
      } catch (e) {
        console.warn("[HealthKit] ExtendedHealth.querySleepQuality failed:", e);
      }

      // Fallback: SPM plugin aggregated (may work on some binary versions)
      try {
        const r = await (Health as any).queryAggregated({ dataType: "sleep-quality", startDate, endDate, bucket: "day" });
        const agg: any[] = r?.aggregatedData ?? r?.data ?? [];
        if (agg.length > 0) {
          const best = agg.reduce((best: any, d: any) =>
            (d.value ?? 0) > (best?.value ?? 0) ? d : best, agg[0]);
          const eff = best?.value ?? 0;
          if (eff > 0) return Math.min(100, Math.round(eff));
        }
      } catch (_) {}

      // Last resort: sleep duration proxy via SPM plugin (no native plugin needed)
      try {
        const r = await (Health as any).queryAggregated({ dataType: "sleep", startDate, endDate, bucket: "day" });
        const data: any[] = r?.aggregatedData ?? r?.data ?? [];
        if (data.length > 0) {
          const total = data.reduce((s: number, d: any) => s + (d.value ?? 0), 0);
          if (total > 0) return Math.min(100, Math.round((total / 480) * 100)); // treat as minutes → proxy %
        }
      } catch (_) {}

      // Final proxy: query with no bucket in case bucketless works
      try {
        const r = await (Health as any).queryAggregated({ dataType: "sleep", startDate, endDate });
        const data: any[] = r?.aggregatedData ?? r?.data ?? [];
        if (data.length > 0) {
          const total = data.reduce((s: number, d: any) => s + (d.value ?? 0), 0);
          if (total > 0) return Math.min(100, Math.round((total / 480) * 100));
        }
      } catch (_) {}

      console.warn("[HealthKit] sleep-quality: all approaches returned null — ExtendedHealth.swift likely missing from Xcode project");
      return null;
    }

    // ── Sleep Duration ──────────────────────────────────────────────────────────
    if (dataType === "sleep") {
      // Primary: ExtendedHealth plugin (compiled directly into app — always reliable)
      try {
        const r = await ExtendedHealth.querySleep({ startDate, endDate });
        if (r.minutes > 0) {
          console.log("[HealthKit] sleep via ExtendedHealth:", r.minutes, "min");
          return r.minutes;
        }
      } catch (e) {
        console.warn("[HealthKit] ExtendedHealth.querySleep failed:", e);
      }

      // Fallback: SPM plugin aggregated
      try {
        const { aggregatedData } = await (Health as any).queryAggregated({
          dataType, startDate, endDate, bucket: "day",
        });
        if (aggregatedData?.length > 0) {
          const total = aggregatedData.reduce((s: number, d: any) => s + (d.value ?? 0), 0);
          if (total > 0) return total;
        }
      } catch (_) {}

      try {
        const result = await (Health as any).queryAggregated({ dataType, startDate, endDate });
        const data = result?.aggregatedData ?? result?.data ?? [];
        if (data.length > 0) {
          const total = data.reduce((s: number, d: any) => s + (d.value ?? 0), 0);
          if (total > 0) return total;
        }
      } catch (_) {}

      return null;
    }

    // Standard path for all other data types
    const { aggregatedData } = await (Health as any).queryAggregated({
      dataType,
      startDate,
      endDate,
      bucket: "day",
    });
    if (!aggregatedData || aggregatedData.length === 0) return null;
    // Sum all returned buckets (cumulative) or take the single value (discrete)
    const total = aggregatedData.reduce((s: number, d: any) => s + (d.value ?? 0), 0);
    return total;
  } catch (e) {
    console.error(`[HealthKit] Error reading ${dataType}:`, e);
    return null;
  }
}

export interface HealthSyncResult {
  synced: number;
  metrics: Array<{ name: string; value: number }>;
}

export async function syncHealthData(dateStr: string, enabledMetricNames: string[]): Promise<HealthSyncResult> {
  const results: Array<{ name: string; value: number }> = [];

  // Ensure Sleep Duration is queried whenever Sleep Quality is requested (needed for fallback)
  const toSync = new Set(enabledMetricNames.filter(n => METRIC_MAP[n]));
  if (toSync.has("Sleep Quality") && !toSync.has("Sleep Duration")) {
    toSync.add("Sleep Duration");
  }

  // Track normalised sleep hours for the Sleep Quality fallback.
  // We use the *normalised* value (hours) rather than the raw HealthKit value
  // because different plugin/OS versions may return sleep duration in seconds,
  // minutes, or hours — the normalize() function already handles the conversion.
  let normalizedSleepHours: number | null = null;

  await Promise.all(
    Array.from(toSync).map(async (name) => {
      const def = METRIC_MAP[name];
      const raw = await queryRawMetric(def.dataType, dateStr);

      if (name === "Sleep Duration" && raw !== null) {
        normalizedSleepHours = def.normalize(raw); // decimal hours, e.g. 7.5
      }

      // Only add to results if it was in the user's requested list
      if (enabledMetricNames.includes(name) && raw !== null && raw > 0) {
        const score = def.normalize(raw);
        results.push({ name, value: score });
      }
    })
  );

  // Sleep Quality fallback: if native "sleep-quality" returned nothing, compute from
  // sleep duration (efficiency proxy: hours / 8 * 100, where 8 h = 100 quality).
  if (
    enabledMetricNames.includes("Sleep Quality") &&
    !results.find(r => r.name === "Sleep Quality") &&
    normalizedSleepHours !== null &&
    normalizedSleepHours > 0
  ) {
    const quality = Math.min(100, Math.round((normalizedSleepHours / 8) * 100));
    if (quality > 0) results.push({ name: "Sleep Quality", value: quality });
  }

  if (results.length === 0) return { synced: 0, metrics: [] };

  try {
    const res = await fetch("/api/health/sync", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: dateStr, metrics: results }),
    });
    if (!res.ok) throw new Error(await res.text());
  } catch (e) {
    console.error("[HealthKit] Sync error:", e);
  }

  return { synced: results.length, metrics: results };
}
