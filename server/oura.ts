export interface HealthData {
  sleepScore?: number;
  readinessScore?: number;
  activityScore?: number;
  steps?: number;
  heartRate?: number;
}

export async function getOuraDataForDate(date: string): Promise<HealthData> {
  return {};
}
