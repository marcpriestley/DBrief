import { Capacitor } from "@capacitor/core";
import { Health } from "capacitor-health";
import type { HealthPermission } from "capacitor-health";

export function isNativeIOS(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";
}

// Metrics this plugin can actually aggregate on iOS
// capacitor-health only supports: 'steps' | 'active-calories' | 'mindfulness'
type SupportedDataType = "steps" | "active-calories" | "mindfulness";

const METRIC_MAP: Record<string, SupportedDataType> = {
  "Steps":          "steps",
  "Active Energy":  "active-calories",
  "Mindful Minutes": "mindfulness",
};

// Permissions to request
const ALL_PERMISSIONS: HealthPermission[] = [
  "READ_STEPS",
  "READ_ACTIVE_CALORIES",
  "READ_TOTAL_CALORIES",
  "READ_DISTANCE",
  "READ_HEART_RATE",
  "READ_MINDFULNESS",
  "READ_WORKOUTS",
];

// localStorage key
const AUTH_KEY = "dbrief_health_authorized";

// Last raw error — for diagnostic display
let _lastHealthError: string | null = null;
export function getLastHealthError(): string | null { return _lastHealthError; }

export function getHealthAuthState(): boolean {
  return localStorage.getItem(AUTH_KEY) === "true";
}

export function setHealthAuthState(v: boolean): void {
  localStorage.setItem(AUTH_KEY, v ? "true" : "false");
}

// Returns which metric names can be auto-synced by this plugin
export function getHealthSyncableMetrics(): string[] {
  return Object.keys(METRIC_MAP);
}

export type HealthAvailability =
  | "available"
  | "not_installed"
  | "not_ios"
  | "unavailable";

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
    await Health.requestHealthPermissions({ permissions: ALL_PERMISSIONS });
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

// Query a single aggregated metric for a date (full day, 1-hour bucket)
async function queryMetric(dataType: SupportedDataType, dateStr: string): Promise<number | null> {
  try {
    const startDate = `${dateStr}T00:00:00.000Z`;
    const endDate   = `${dateStr}T23:59:59.999Z`;
    const { aggregatedData } = await Health.queryAggregated({
      dataType,
      startDate,
      endDate,
      bucket: "day",
    });
    if (!aggregatedData || aggregatedData.length === 0) return null;
    const total = aggregatedData.reduce((s, d) => s + d.value, 0);
    return Math.round(total * 10) / 10;
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
      const value = await queryMetric(METRIC_MAP[name], dateStr);
      if (value !== null) results.push({ name, value });
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
