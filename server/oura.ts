import type { Request, Response } from "express";

const OURA_BASE_URL = "https://api.ouraring.com/v2/usercollection";

interface OuraSleepScoreData {
  data: Array<{
    day: string;
    score: number;
    contributors: {
      deep_sleep: number;
      efficiency: number;
      latency: number;
      rem_sleep: number;
      restfulness: number;
      timing: number;
      total_sleep: number;
    };
  }>;
}

interface OuraReadinessData {
  data: Array<{
    day: string;
    score: number;
    contributors: {
      activity_balance: number;
      body_temperature: number;
      hrv_balance: number;
      previous_day_activity: number;
      previous_night_sleep: number;
      recovery_index: number;
      resting_heart_rate: number;
      sleep_balance: number;
    };
  }>;
}

interface OuraActivityData {
  data: Array<{
    day: string;
    score: number;
    steps: number;
    active_calories: number;
    total_calories: number;
    target_calories: number;
    met_min_high: number;
    met_min_medium: number;
    met_min_low: number;
    equivalent_walking_distance: number;
  }>;
}

export interface OuraData {
  sleepScore?: number;
  readinessScore?: number;
  steps?: number;
}

async function fetchOuraData(endpoint: string, startDate: string, endDate: string): Promise<any> {
  const accessToken = process.env.OURA_ACCESS_TOKEN;
  
  if (!accessToken) {
    throw new Error("OURA_ACCESS_TOKEN not configured");
  }

  const url = `${OURA_BASE_URL}/${endpoint}?start_date=${startDate}&end_date=${endDate}`;
  
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Oura API error (${response.status}): ${errorText}`);
  }

  return response.json();
}

export async function getOuraDataForDate(date: string): Promise<OuraData> {
  try {
    const [sleepScoreData, readinessData, activityData] = await Promise.all([
      fetchOuraData("daily_sleep", date, date) as Promise<OuraSleepScoreData>,
      fetchOuraData("daily_readiness", date, date) as Promise<OuraReadinessData>,
      fetchOuraData("daily_activity", date, date) as Promise<OuraActivityData>,
    ]);

    const result: OuraData = {};

    if (sleepScoreData.data && sleepScoreData.data.length > 0) {
      const sleep = sleepScoreData.data[0];
      result.sleepScore = sleep.score;
    }

    if (readinessData.data && readinessData.data.length > 0) {
      result.readinessScore = readinessData.data[0].score;
    }

    if (activityData.data && activityData.data.length > 0) {
      result.steps = activityData.data[0].steps;
    }

    return result;
  } catch (error) {
    console.error("Error fetching Oura data:", error);
    throw error;
  }
}
