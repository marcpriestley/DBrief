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
      // Primary: Health.querySleepQuality — a top-level method on the SPM plugin
      // (the HealthPlugin is always discovered; ExtendedHealth has registration issues)
      try {
        const r = await (Health as any).querySleepQuality({ startDate, endDate });
        if ((r?.efficiency ?? 0) > 0) {
          console.log("[HealthKit] sleep-quality via Health.querySleepQuality:", r.efficiency);
          return Math.min(100, Math.round(r.efficiency));
        }
        if ((r?.minutes ?? 0) > 0) {
          return Math.min(100, Math.round((r.minutes / 480) * 100));
        }
      } catch (e) {
        console.warn("[HealthKit] Health.querySleepQuality failed:", e);
      }

      // Fallback: ExtendedHealth plugin (works if AppDelegate NSStringFromClass fix is in binary)
      try {
        const r = await ExtendedHealth.querySleepQuality({ startDate, endDate });
        if (r.efficiency > 0) {
          console.log("[HealthKit] sleep-quality via ExtendedHealth:", r.efficiency);
          return Math.min(100, Math.round(r.efficiency));
        }
        if (r.minutes > 0) {
          return Math.min(100, Math.round((r.minutes / 480) * 100));
        }
      } catch (_) {}

      // Fallback: queryAggregated with sleep-quality (patched HealthPlugin path)
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

      // Last resort: sleep duration proxy
      try {
        const r = await (Health as any).queryAggregated({ dataType: "sleep", startDate, endDate, bucket: "day" });
        const data: any[] = r?.aggregatedData ?? r?.data ?? [];
        if (data.length > 0) {
          const total = data.reduce((s: number, d: any) => s + (d.value ?? 0), 0);
          if (total > 0) return Math.min(100, Math.round((total / 480) * 100));
        }
      } catch (_) {}

      console.warn("[HealthKit] sleep-quality: all approaches returned null");
      return null;
    }

    // ── Sleep Duration ──────────────────────────────────────────────────────────
    if (dataType === "sleep") {
      // Primary: Health.querySleepQuality already in the binary — its "minutes" field
      // gives us sleep duration without needing a separate native method.
      try {
        const r = await (Health as any).querySleepQuality({ startDate, endDate });
        if ((r?.minutes ?? 0) > 0) {
          console.log("[HealthKit] sleep duration via Health.querySleepQuality:", r.minutes, "min");
          return r.minutes;
        }
      } catch (e) {
        console.warn("[HealthKit] Health.querySleepQuality (duration) failed:", e);
      }

      // Fallback: ExtendedHealth plugin
      try {
        const r = await ExtendedHealth.querySleep({ startDate, endDate });
        if (r.minutes > 0) {
          console.log("[HealthKit] sleep via ExtendedHealth:", r.minutes, "min");
          return r.minutes;
        }
      } catch (_) {}

      // Fallback: queryAggregated sleep
      try {
        const { aggregatedData } = await (Health as any).queryAggregated({
          dataType, startDate, endDate, bucket: "day",
        });
        if (aggregatedData?.length > 0) {
          const total = aggregatedData.reduce((s: number, d: any) => s + (d.value ?? 0), 0);
          if (total > 0) return total;
        }
      } catch (_) {}

      return null;
    }

    // ── Mindfulness ─────────────────────────────────────────────────────────────
    if (dataType === "mindfulness") {
      // Primary: Health.queryMindfulSession — top-level method added to HealthPlugin
      try {
        const r = await (Health as any).queryMindfulSession({ startDate, endDate });
        if ((r?.minutes ?? 0) > 0) {
          console.log("[HealthKit] mindfulness via Health.queryMindfulSession:", r.minutes, "min");
          return r.minutes;
        }
      } catch (_) {}

      // Fallback: queryAggregated mindfulness (works in patched local binary)
      try {
        const { aggregatedData } = await (Health as any).queryAggregated({
          dataType: "mindfulness", startDate, endDate, bucket: "day",
        });
        if (aggregatedData?.length > 0) {
          const total = aggregatedData.reduce((s: number, d: any) => s + (d.value ?? 0), 0);
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
        // Sleep Quality: require at least 3 hours of sleep (180 min raw) to be valid.
        // When a wearable battery dies mid-night, Apple Health falls back to iPhone
        // motion sensors and often reports 100% efficiency for the brief tracked period.
        // We discard any Sleep Quality score backed by < 3 h of sleep as unreliable.
        if (name === "Sleep Quality") {
          const minSleepMinutes = 180;
          const rawSleepMinutes = (normalizedSleepHours ?? 0) * 60;
          if (rawSleepMinutes < minSleepMinutes && normalizedSleepHours !== null) {
            console.warn(`[HealthKit] Sleep Quality skipped — only ${rawSleepMinutes.toFixed(0)} min of sleep recorded (min 180 min required)`);
          } else if (normalizedSleepHours === null) {
            // Sleep duration not available yet (parallel fetch) — add with guard below
            const score = def.normalize(raw);
            results.push({ name, value: score });
          } else {
            const score = def.normalize(raw);
            results.push({ name, value: score });
          }
        } else {
          const score = def.normalize(raw);
          results.push({ name, value: score });
        }
      }
    })
  );

  // Remove Sleep Quality if sleep duration turned out to be < 3 h
  // (handles the case where Sleep Quality resolved in parallel before Sleep Duration)
  const sleepQualityIdx = results.findIndex(r => r.name === "Sleep Quality");
  if (sleepQualityIdx !== -1 && normalizedSleepHours !== null && normalizedSleepHours < 3) {
    console.warn(`[HealthKit] Sleep Quality removed post-sync — only ${(normalizedSleepHours * 60).toFixed(0)} min of sleep`);
    results.splice(sleepQualityIdx, 1);
  }

  // Sleep Quality fallback: if native "sleep-quality" returned nothing, compute from
  // sleep duration (efficiency proxy: hours / 8 * 100, where 8 h = 100 quality).
  // Only apply if sleep duration is at least 3 hours (reliable data).
  if (
    enabledMetricNames.includes("Sleep Quality") &&
    !results.find(r => r.name === "Sleep Quality") &&
    normalizedSleepHours !== null &&
    normalizedSleepHours >= 3
  ) {
    const quality = Math.min(100, Math.round((normalizedSleepHours / 8) * 100));
    if (quality > 0) results.push({ name: "Sleep Quality", value: quality });
  }

  // Metrics the user has enabled but that produced no result (null from HealthKit or
  // filtered out by a guard, e.g. Sleep Quality blocked because sleep < 3 h).
  // We tell the server to clear any previously auto-synced value so stale data
  // (e.g. a 100% Sleep Quality from an Oura-dead iPhone-sensor reading) is removed.
  const savedNames = new Set(results.map(r => r.name));
  const clearedMetricNames = enabledMetricNames.filter(n => !savedNames.has(n) && METRIC_MAP[n]);

  if (results.length === 0 && clearedMetricNames.length === 0) return { synced: 0, metrics: [] };

  try {
    const res = await fetch("/api/health/sync", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: dateStr, metrics: results, clearedMetricNames }),
    });
    if (!res.ok) throw new Error(await res.text());
  } catch (e) {
    console.error("[HealthKit] Sync error:", e);
  }

  return { synced: results.length, metrics: results };
}

/** Diagnostic: calls each sleep query path individually and returns a human-readable report.
 *  Use the "Sleep Diagnostic" button in Settings to run this. No rebuild required. */
export async function diagnoseSleepSync(): Promise<string> {
  const dateStr = new Date().toISOString().split("T")[0];
  const todayLocal = new Date(`${dateStr}T20:00:00`);
  const prevLocal  = new Date(`${dateStr}T04:00:00`);
  prevLocal.setDate(prevLocal.getDate() - 1);
  const startDate = prevLocal.toISOString();
  const endDate   = todayLocal.toISOString();

  const lines: string[] = [`Window: ${startDate.slice(0,16)} → ${endDate.slice(0,16)}`];

  // 1. Health.querySleepQuality (new direct method on HealthPlugin — primary path)
  try {
    const r = await (Health as any).querySleepQuality({ startDate, endDate });
    lines.push(`Health.querySleepQuality: efficiency=${r?.efficiency}, mins=${r?.minutes}`);
  } catch (e: any) {
    lines.push(`Health.querySleepQuality: ERROR — ${String(e?.message ?? e).slice(0,80)}`);
  }

  // 2. ExtendedHealth (secondary — needs AppDelegate fix to register)
  try {
    const r = await ExtendedHealth.querySleepQuality({ startDate, endDate });
    lines.push(`ExtendedHealth: efficiency=${r.efficiency}, mins=${r.minutes}`);
  } catch (e: any) {
    lines.push(`ExtendedHealth: ERROR — ${String(e?.message ?? e).slice(0,80)}`);
  }

  // 3. Health.queryAggregated sleep-quality (patched path)
  try {
    const r = await (Health as any).queryAggregated({ dataType: "sleep-quality", startDate, endDate, bucket: "day" });
    const agg: any[] = r?.aggregatedData ?? r?.data ?? [];
    lines.push(`HealthSPM sleep-quality: ${agg.length} samples — ${JSON.stringify(agg.slice(0,2))}`);
  } catch (e: any) {
    lines.push(`HealthSPM sleep-quality: ERROR — ${String(e?.message ?? e).slice(0,80)}`);
  }

  // 4. Health.queryAggregated sleep
  try {
    const r = await (Health as any).queryAggregated({ dataType: "sleep", startDate, endDate, bucket: "day" });
    const agg: any[] = r?.aggregatedData ?? r?.data ?? [];
    lines.push(`HealthSPM sleep: ${agg.length} samples — ${JSON.stringify(agg.slice(0,2))}`);
  } catch (e: any) {
    lines.push(`HealthSPM sleep: ERROR — ${String(e?.message ?? e).slice(0,80)}`);
  }

  return lines.join("\n");
}
