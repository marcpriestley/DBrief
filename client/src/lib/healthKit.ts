import { Capacitor } from "@capacitor/core";
import { Health } from "capacitor-health";

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
    normalize: (v) => Math.min(100, Math.round(v / 10000 * 100)),
    permission: "READ_STEPS",
  },
  "Active Energy": {
    dataType: "active-calories",
    normalize: (v) => Math.min(100, Math.round(v / 600 * 100)),
    permission: "READ_ACTIVE_CALORIES",
  },
  "Flights Climbed": {
    dataType: "flights-climbed",
    normalize: (v) => Math.min(100, Math.round(v / 20 * 100)),
    permission: "READ_FLIGHTS_CLIMBED",
  },
  "Walking Distance": {
    dataType: "walking-distance",
    normalize: (v) => Math.min(100, Math.round(v / 8 * 100)), // km
    permission: "READ_WALKING_DISTANCE",
  },
  "Exercise Minutes": {
    dataType: "exercise-minutes",
    normalize: (v) => Math.min(100, Math.round(v / 60 * 100)),
    permission: "READ_EXERCISE_MINUTES",
  },
  "Sleep Duration": {
    dataType: "sleep",
    normalize: (v) => Math.min(100, Math.round(v / 480 * 100)), // minutes → 8h = 100
    permission: "READ_SLEEP",
  },
  "Heart Rate": {
    dataType: "heart-rate",
    normalize: (v) => Math.round(v), // bpm stored directly (50–120 range meaningful)
    permission: "READ_HEART_RATE",
  },
  "Resting Heart Rate": {
    dataType: "resting-heart-rate",
    normalize: (v) => Math.round(v), // bpm stored directly
    permission: "READ_RESTING_HEART_RATE",
  },
  "HRV": {
    dataType: "hrv",
    normalize: (v) => Math.min(100, Math.round(v)), // ms, 0–100 range natural
    permission: "READ_HRV",
  },
  "Blood Oxygen": {
    dataType: "oxygen-saturation",
    normalize: (v) => Math.round(v), // % already 0–100
    permission: "READ_OXYGEN_SATURATION",
  },
  "Body Weight": {
    dataType: "body-mass",
    normalize: (v) => Math.round(v * 10) / 10, // kg stored directly
    permission: "READ_BODY_MASS",
  },
  "Body Fat %": {
    dataType: "body-fat",
    normalize: (v) => Math.round(v), // % already 0–100
    permission: "READ_BODY_FAT",
  },
  "Mindful Minutes": {
    dataType: "mindfulness",
    normalize: (v) => Math.min(100, Math.round(v / 30 * 100)), // mins → 30m = 100
    permission: "READ_MINDFULNESS",
  },
  "Respiratory Rate": {
    dataType: "respiratory-rate",
    normalize: (v) => Math.round(v), // breaths/min stored directly
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
    const startDate = `${dateStr}T00:00:00.000Z`;
    const endDate   = `${dateStr}T23:59:59.999Z`;
    const { aggregatedData } = await (Health as any).queryAggregated({
      dataType,
      startDate,
      endDate,
      bucket: "day",
    });
    if (!aggregatedData || aggregatedData.length === 0) return null;
    // For cumulative types, sum; for discrete/sleep, take the last (or only) value
    const total = aggregatedData.reduce((s: number, d: any) => s + d.value, 0);
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

  const syncable = enabledMetricNames.filter(n => METRIC_MAP[n]);
  await Promise.all(
    syncable.map(async (name) => {
      const def = METRIC_MAP[name];
      const raw = await queryRawMetric(def.dataType, dateStr);
      if (raw !== null && raw > 0) {
        const score = def.normalize(raw);
        results.push({ name, value: score });
      }
    })
  );

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
