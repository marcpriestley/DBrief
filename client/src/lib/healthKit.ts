import { Capacitor } from "@capacitor/core";
import { Health } from "capacitor-health";
import type { HealthDataType } from "capacitor-health";

export function isNativeIOS(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";
}

// Mapping from our display metric names → HealthKit data types
type MetricMap = {
  dataType: HealthDataType;
  aggregate: "sum" | "average" | "latest" | "sleepDuration" | "sleepQuality";
  // Transform the raw value to a stored value (unit conversion)
  transform?: (v: number) => number;
};

const METRIC_MAP: Record<string, MetricMap> = {
  "Steps":              { dataType: "steps",                aggregate: "sum" },
  "Active Energy":      { dataType: "calories",             aggregate: "sum" },
  "Exercise Minutes":   { dataType: "exerciseTime",         aggregate: "sum" },
  "Flights Climbed":    { dataType: "flightsClimbed",       aggregate: "sum" },
  "Walking Distance":   { dataType: "distance",             aggregate: "sum",
                          transform: (v) => Math.round((v / 1000) * 10) / 10 }, // meters → km
  "Sleep Duration":     { dataType: "sleep",                aggregate: "sleepDuration" },
  "Sleep Quality":      { dataType: "sleep",                aggregate: "sleepQuality" },
  "Heart Rate":         { dataType: "heartRate",            aggregate: "average" },
  "Resting Heart Rate": { dataType: "restingHeartRate",     aggregate: "average" },
  "HRV":                { dataType: "heartRateVariability", aggregate: "average" },
  "Blood Oxygen":       { dataType: "oxygenSaturation",     aggregate: "average" },
  "Body Weight":        { dataType: "weight",               aggregate: "latest" },
  "Body Fat %":         { dataType: "bodyFat",              aggregate: "average" },
  "Mindful Minutes":    { dataType: "mindfulness",          aggregate: "sum" },
  "Respiratory Rate":   { dataType: "respiratoryRate",      aggregate: "average" },
};

// All HealthKit data types our app can ever request
const ALL_HEALTH_TYPES: HealthDataType[] = [
  "steps", "calories", "exerciseTime", "flightsClimbed", "distance",
  "sleep", "heartRate", "restingHeartRate", "heartRateVariability",
  "oxygenSaturation", "weight", "bodyFat", "mindfulness", "respiratoryRate",
];

// localStorage key to persist authorization state
const AUTH_KEY = "dbrief_health_authorized";

export function getHealthAuthState(): boolean {
  return localStorage.getItem(AUTH_KEY) === "true";
}

export function setHealthAuthState(v: boolean): void {
  localStorage.setItem(AUTH_KEY, v ? "true" : "false");
}

export async function checkHealthAvailable(): Promise<boolean> {
  if (!isNativeIOS()) return false;
  try {
    const { available } = await Health.isAvailable();
    return available;
  } catch {
    return false;
  }
}

export async function requestHealthPermissions(): Promise<boolean> {
  if (!isNativeIOS()) return false;
  try {
    await Health.requestAuthorization({ read: ALL_HEALTH_TYPES, write: [] });
    setHealthAuthState(true);
    return true;
  } catch (e) {
    console.error("[HealthKit] Authorization error:", e);
    return false;
  }
}

// Query samples for a single data type on a given date (full day)
async function querySamples(dataType: HealthDataType, dateStr: string) {
  const startDate = `${dateStr}T00:00:00.000Z`;
  const endDate = `${dateStr}T23:59:59.999Z`;
  try {
    const result = await Health.readSamples({ dataType, startDate, endDate, limit: 1000, ascending: true });
    return result.samples;
  } catch (e) {
    console.error(`[HealthKit] Error reading ${dataType}:`, e);
    return [];
  }
}

// Aggregate samples into a single value for that day
async function aggregateMetric(metricName: string, dateStr: string): Promise<number | null> {
  const map = METRIC_MAP[metricName];
  if (!map) return null;

  const samples = await querySamples(map.dataType, dateStr);
  if (samples.length === 0) return null;

  let result: number | null = null;

  if (map.aggregate === "sum") {
    result = samples.reduce((s, x) => s + x.value, 0);
  } else if (map.aggregate === "average") {
    result = samples.reduce((s, x) => s + x.value, 0) / samples.length;
    result = Math.round(result * 10) / 10;
  } else if (map.aggregate === "latest") {
    result = samples[samples.length - 1].value;
  } else if (map.aggregate === "sleepDuration") {
    // Sum minutes in asleep/rem/deep/light states, convert to hours
    const sleepSamples = samples.filter(s =>
      s.sleepState && ["asleep", "rem", "deep", "light"].includes(s.sleepState)
    );
    if (sleepSamples.length === 0) {
      // Fallback: sum all samples
      const totalMins = samples.reduce((s, x) => s + x.value, 0);
      result = Math.round((totalMins / 60) * 10) / 10;
    } else {
      const totalMins = sleepSamples.reduce((acc, s) => {
        const dur = (new Date(s.endDate).getTime() - new Date(s.startDate).getTime()) / 60000;
        return acc + dur;
      }, 0);
      result = Math.round((totalMins / 60) * 10) / 10;
    }
  } else if (map.aggregate === "sleepQuality") {
    // % of restorative sleep (deep + rem) vs total sleep time → 0-100 score
    const asleepSamples = samples.filter(s =>
      s.sleepState && ["asleep", "rem", "deep", "light"].includes(s.sleepState)
    );
    const restorativeSamples = samples.filter(s =>
      s.sleepState && ["rem", "deep"].includes(s.sleepState)
    );
    if (asleepSamples.length === 0) return null;
    const totalMins = asleepSamples.reduce((acc, s) => {
      return acc + (new Date(s.endDate).getTime() - new Date(s.startDate).getTime()) / 60000;
    }, 0);
    const restorativeMins = restorativeSamples.reduce((acc, s) => {
      return acc + (new Date(s.endDate).getTime() - new Date(s.startDate).getTime()) / 60000;
    }, 0);
    if (totalMins === 0) return null;
    result = Math.round((restorativeMins / totalMins) * 100);
  }

  if (result === null) return null;

  // Apply transform (e.g. meters → km)
  if (map.transform && result !== null) {
    result = map.transform(result);
  }

  return result;
}

export interface HealthSyncResult {
  synced: number;
  metrics: Array<{ name: string; value: number }>;
}

// Sync all provided metric names for a given date to the backend
export async function syncHealthData(dateStr: string, enabledMetricNames: string[]): Promise<HealthSyncResult> {
  const results: Array<{ name: string; value: number }> = [];

  const settable = enabledMetricNames.filter(n => METRIC_MAP[n]);
  await Promise.all(
    settable.map(async (name) => {
      const value = await aggregateMetric(name, dateStr);
      if (value !== null) {
        results.push({ name, value });
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

// Returns the list of metric names that have a HealthKit mapping
export function getHealthSyncableMetrics(): string[] {
  return Object.keys(METRIC_MAP);
}
